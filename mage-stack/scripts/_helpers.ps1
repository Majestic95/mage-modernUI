<#
Shared helpers for all mage-stack scripts.

Dot-sourced by install-service / uninstall / mage-up / mage-down /
mage-status / mage-watchdog / mage-redeploy / mage-logs.

Underscore prefix = not meant to be invoked directly.

ASCII-only: PowerShell 5.1 reads UTF-8-without-BOM files as Windows-1252
by default, mangling unicode characters and breaking the parser.
#>

function Write-Section($Msg) {
    Write-Host ""
    Write-Host "=== $Msg ===" -ForegroundColor Cyan
}

function Write-Step($Msg) { Write-Host "  -> $Msg" -ForegroundColor White }
function Write-Ok($Msg)   { Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn($Msg) { Write-Host "  [!] $Msg" -ForegroundColor Yellow }
function Write-Err($Msg)  { Write-Host "  [X] $Msg" -ForegroundColor Red }

function Throw-OnExit($Cmd) {
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit ${LASTEXITCODE} for: $Cmd"
    }
}

function Get-BundleRootFromScript($CallerScriptPath) {
    Split-Path -Parent (Split-Path -Parent $CallerScriptPath)
}

function Read-Config($Path) {
    if (-not (Test-Path $Path)) {
        throw "config.json not found at $Path. Copy config.json.template first."
    }
    Get-Content $Path -Raw | ConvertFrom-Json
}

function Read-BundleConfig($BundleRoot) {
    Read-Config (Join-Path $BundleRoot 'config\config.json')
}

function Test-PortInUse($Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Get-ServiceState($Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return 'NotFound' }
    return $svc.Status.ToString()
}

function Format-Uptime($StartTime) {
    if (-not $StartTime) { return '?' }
    $ts = (Get-Date) - $StartTime
    if ($ts.TotalDays -ge 1)    { return "{0:N1}d" -f $ts.TotalDays }
    if ($ts.TotalHours -ge 1)   { return "{0:N1}h" -f $ts.TotalHours }
    if ($ts.TotalMinutes -ge 1) { return "{0:N0}m" -f $ts.TotalMinutes }
    return "{0:N0}s" -f $ts.TotalSeconds
}

function Resolve-JavaHome {
    <#
    .SYNOPSIS
        Find a JDK 17+ JAVA_HOME with javac.exe present.

    .DESCRIPTION
        Resolution order:
          1. Existing $env:JAVA_HOME if it points to a real JDK (has javac).
          2. The optional $ConfigJavaHome (typically $Config.webapi.javaHome
             from config.json) when the caller passes it.
          3. Newest jdk-17* under C:\Program Files\Eclipse Adoptium\.
          4. javac on PATH (parent of parent).
          5. Throw with a clear message.

        Callers that have the bundle config in scope (mage-redeploy,
        install-service, mage-ship) should pass $Config.webapi.javaHome
        so the bundle-pinned JDK wins over an Adoptium auto-detect.
        Callers that don't have config in scope can omit the parameter.
    #>
    param(
        [string]$ConfigJavaHome
    )

    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
        return $env:JAVA_HOME
    }

    if ($ConfigJavaHome -and (Test-Path (Join-Path $ConfigJavaHome 'bin\javac.exe'))) {
        return $ConfigJavaHome
    }

    $adoptiumRoot = 'C:\Program Files\Eclipse Adoptium'
    if (Test-Path $adoptiumRoot) {
        $candidate = Get-ChildItem -Path $adoptiumRoot -Directory -Filter 'jdk-17*' |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($candidate -and (Test-Path (Join-Path $candidate.FullName 'bin\javac.exe'))) {
            return $candidate.FullName
        }
    }

    $javac = Get-Command javac -ErrorAction SilentlyContinue
    if ($javac) {
        return Split-Path -Parent (Split-Path -Parent $javac.Source)
    }

    throw "Could not locate a JDK 17+ JAVA_HOME with javac.exe. Set JAVA_HOME, fix config.webapi.javaHome, or install Eclipse Adoptium JDK 17."
}

function Use-ResolvedJavaHome {
    <#
    .SYNOPSIS
        Resolve a JDK and inject it into $env:JAVA_HOME + $env:PATH for
        the current PowerShell session. Returns the resolved path.

    .DESCRIPTION
        Convenience wrapper for the common "I'm about to call mvn"
        pattern in ops scripts. Mutates session env so subsequent
        mvn / java calls in the same script see the right JDK without
        the caller having to manage env state.

        Idempotent — repeated calls with the same config are no-ops
        beyond the same result.
    #>
    param(
        [string]$ConfigJavaHome
    )
    $resolved = Resolve-JavaHome -ConfigJavaHome $ConfigJavaHome
    $env:JAVA_HOME = $resolved
    $binDir = Join-Path $resolved 'bin'
    if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $binDir })) {
        $env:PATH = "$binDir;$env:PATH"
    }
    return $resolved
}

function Install-NssmService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Nssm,
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string]$Parameters,
        [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string]$LogFile,
        [int]$RotationBytes = 10485760,
        [int]$RestartDelay = 5000,
        [string[]]$EnvExtra = @()
    )

    # Remove existing service if present (idempotent).
    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Step "Removing existing service: $Name"
        if ($existing.Status -ne 'Stopped') {
            & $Nssm stop $Name | Out-Null
            Start-Sleep -Seconds 2
        }
        & $Nssm remove $Name confirm | Out-Null
        Start-Sleep -Seconds 1
    }

    & $Nssm install $Name $Executable | Out-Null
    & $Nssm set $Name AppParameters $Parameters | Out-Null
    if ($WorkingDirectory) {
        & $Nssm set $Name AppDirectory $WorkingDirectory | Out-Null
    }
    & $Nssm set $Name AppStdout $LogFile | Out-Null
    & $Nssm set $Name AppStderr $LogFile | Out-Null
    & $Nssm set $Name AppRotateFiles 1 | Out-Null
    & $Nssm set $Name AppRotateOnline 1 | Out-Null
    & $Nssm set $Name AppRotateBytes $RotationBytes | Out-Null
    & $Nssm set $Name AppExit Default Restart | Out-Null
    & $Nssm set $Name AppRestartDelay $RestartDelay | Out-Null
    & $Nssm set $Name Start SERVICE_AUTO_START | Out-Null
    if ($EnvExtra.Count -gt 0) {
        & $Nssm set $Name AppEnvironmentExtra $EnvExtra | Out-Null
    }
    Write-Ok "Service registered: $Name"
}
