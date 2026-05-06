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
