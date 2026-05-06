#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the mage-stack runtime as three Windows Services.

.DESCRIPTION
    Bootstraps the WebApi server, the Cloudflare Tunnel connector, and
    the health-check watchdog as NSSM-managed Windows Services. Idempotent:
    re-run safely; existing services are stopped and re-registered.

    Phases:
      0  Pre-flight (admin, JDK, mvn, config.json)
      1  Download NSSM + cloudflared.exe to bin/ (one-time)
      2  Cloudflare Tunnel: login, create, configure, DNS
      3  Build WebApi JAR + generate classpath file
      4  Register MageWebApi / MageTunnel / MageWatchdog with NSSM
      5  Start services + health check

    See docs/decisions/0012-infra-1-self-hosted-bundle.md for design rationale.

.PARAMETER SkipTunnelLogin
    Skip cloudflared login + tunnel creation (use when re-registering
    services without re-creating the tunnel).

.PARAMETER Force
    Skip interactive confirmations (delete-and-recreate prompts).
#>
[CmdletBinding()]
param(
    [switch]$SkipTunnelLogin,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '_helpers.ps1')

# ---------------------------------------------------------------------------
# Phase 0 - Pre-flight
# ---------------------------------------------------------------------------

function Test-Prereqs($Config, $BundleRoot) {
    Write-Section "Phase 0 - Pre-flight"

    $javaExe = Join-Path $Config.webapi.javaHome 'bin\java.exe'
    if (-not (Test-Path $javaExe)) {
        throw "JDK not found at $($Config.webapi.javaHome). Install Eclipse Adoptium JDK 17+ or update config.json."
    }
    Write-Ok "JDK found: $javaExe"

    if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {
        throw "mvn not on PATH. Install Maven 3.9+ and add to PATH."
    }
    Write-Ok "Maven on PATH"

    if (Test-PortInUse $Config.webapi.port) {
        $conn = Get-NetTCPConnection -LocalPort $Config.webapi.port -State Listen
        Write-Warn "Port $($Config.webapi.port) is in use by PID $($conn.OwningProcess) - service will fail to start until that process is stopped."
    } else {
        Write-Ok "Port $($Config.webapi.port) free"
    }

    return @{ JavaExe = $javaExe }
}

# ---------------------------------------------------------------------------
# Phase 1 - Vendored binaries (NSSM + cloudflared)
# ---------------------------------------------------------------------------

function Get-Nssm($BundleRoot) {
    $target = Join-Path $BundleRoot 'bin\nssm.exe'
    if (Test-Path $target) {
        Write-Ok "NSSM already present"
        return $target
    }

    Write-Step "Downloading NSSM 2.24 (~350 KB)..."
    $zipUrl = 'https://nssm.cc/release/nssm-2.24.zip'
    $zipPath = Join-Path $env:TEMP 'nssm-2.24.zip'
    $extractDir = Join-Path $env:TEMP 'nssm-extract'

    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $extracted = Get-ChildItem $extractDir -Recurse -Filter 'nssm.exe' |
                 Where-Object { $_.FullName -like '*\win64\*' } |
                 Select-Object -First 1
    if (-not $extracted) {
        throw "nssm.exe not found in extracted archive at $extractDir"
    }
    Copy-Item $extracted.FullName $target -Force
    Remove-Item $zipPath -Force
    Remove-Item $extractDir -Recurse -Force
    Write-Ok "NSSM installed: $target"
    return $target
}

function Get-Cloudflared($BundleRoot) {
    Write-Section "Phase 1 - Vendored binaries"

    Get-Nssm $BundleRoot | Out-Null

    $target = Join-Path $BundleRoot 'bin\cloudflared.exe'
    if (Test-Path $target) {
        $version = & $target --version 2>&1 | Select-Object -First 1
        Write-Ok "cloudflared already present: $version"
        return $target
    }

    $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Write-Step "Downloading cloudflared from $url (~25 MB)..."
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing

    $version = & $target --version 2>&1 | Select-Object -First 1
    if ($LASTEXITCODE -ne 0) {
        throw "cloudflared.exe downloaded but does not run. Delete $target and retry."
    }
    Write-Ok "cloudflared downloaded + verified: $version"
    return $target
}

# ---------------------------------------------------------------------------
# Phase 2 - Cloudflare Tunnel setup
# ---------------------------------------------------------------------------

function Initialize-Tunnel($Config, $Cloudflared) {
    Write-Section "Phase 2 - Cloudflare Tunnel"

    $cert = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
    if (Test-Path $cert) {
        Write-Ok "cloudflared cert.pem already present (skipping login)"
    } else {
        Write-Step "Opening browser for Cloudflare login. Click 'Authorize', then return here."
        & $Cloudflared tunnel login
        Throw-OnExit 'cloudflared tunnel login'
        if (-not (Test-Path $cert)) {
            throw "cert.pem not created at $cert. Login may have been cancelled."
        }
        Write-Ok "Login complete"
    }

    $tunnelName = $Config.tunnel.name
    $existing = & $Cloudflared tunnel list --output json 2>$null | ConvertFrom-Json
    $existingTunnel = $existing | Where-Object { $_.name -eq $tunnelName }

    if ($existingTunnel) {
        Write-Warn "Tunnel '$tunnelName' already exists (UUID $($existingTunnel.id))."
        if (-not $script:Force) {
            $reply = Read-Host "Delete and recreate? (y/N)"
            if ($reply -ne 'y') {
                throw "Aborted. Pass -Force to skip prompts, or use -SkipTunnelLogin to keep existing tunnel."
            }
        }
        Write-Step "Deleting existing tunnel..."
        & $Cloudflared tunnel delete -f $tunnelName
        Throw-OnExit 'tunnel delete'
        Write-Ok "Old tunnel removed"
    }

    Write-Step "Creating tunnel '$tunnelName'..."
    & $Cloudflared tunnel create $tunnelName 2>&1 | ForEach-Object { Write-Host "    $_" }
    Throw-OnExit 'tunnel create'

    $tunnelInfo = & $Cloudflared tunnel list --output json | ConvertFrom-Json | Where-Object { $_.name -eq $tunnelName }
    if (-not $tunnelInfo) {
        throw "Tunnel created but cannot be located in 'tunnel list'."
    }
    $uuid = $tunnelInfo.id
    $sourceCred = Join-Path $env:USERPROFILE ".cloudflared\$uuid.json"
    $targetCred = $Config.tunnel.credentialsFile

    $credDir = Split-Path -Parent $targetCred
    if (-not (Test-Path $credDir)) {
        New-Item -ItemType Directory -Path $credDir -Force | Out-Null
    }
    Copy-Item $sourceCred $targetCred -Force
    Write-Ok "Credentials file: $targetCred"

    $tplPath = Join-Path (Split-Path -Parent $Config.tunnel.configFile) 'cloudflared-config.yml.template'
    $cfgPath = $Config.tunnel.configFile
    $tpl = Get-Content $tplPath -Raw
    $rendered = $tpl `
        -replace '<TUNNEL_UUID>', $uuid `
        -replace '<CREDENTIALS_FILE>', ($targetCred -replace '\\','\\') `
        -replace '<HOSTNAME>', $Config.tunnel.hostname `
        -replace '<LOCAL_SERVICE>', "http://localhost:$($Config.webapi.port)"
    Set-Content -Path $cfgPath -Value $rendered -Encoding UTF8
    Write-Ok "Ingress config written: $cfgPath"

    Write-Step "Routing DNS: $($Config.tunnel.hostname) -> tunnel (with overwrite)"
    # --overwrite-dns replaces any pre-existing A/AAAA/CNAME at the
    # hostname (e.g. the auto-created apex record Cloudflare adds at
    # domain registration). Without it, registering a fresh tunnel on
    # an existing domain fails with code 1003.
    & $Cloudflared tunnel route dns --overwrite-dns $tunnelName $Config.tunnel.hostname 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "DNS route command returned non-zero. May be already configured."
    }
}

# ---------------------------------------------------------------------------
# Phase 3 - Build WebApi + classpath
# ---------------------------------------------------------------------------

function Build-WebApi($Config, $RepoRoot) {
    Write-Section "Phase 3 - WebApi build"

    # Mage.Server.WebApi is a STANDALONE pom — not registered in the
    # parent reactor (per upstream-rebase-compat decision in its pom).
    # Use -f to invoke it directly, NOT -pl ... -am.
    Write-Step "mvn -f Mage.Server.WebApi/pom.xml package -DskipTests"
    Push-Location $RepoRoot
    try {
        & mvn -f Mage.Server.WebApi/pom.xml package -DskipTests -q
        Throw-OnExit 'mvn package'
    } finally {
        Pop-Location
    }
    Write-Ok "Package built"

    Write-Step "Generating classpath file..."
    $cpFile = $Config.webapi.classpathFile
    Push-Location $RepoRoot
    try {
        & mvn -f Mage.Server.WebApi/pom.xml -q dependency:build-classpath "-Dmdep.outputFile=$cpFile" "-Dmdep.includeScope=runtime"
        Throw-OnExit 'mvn dependency:build-classpath'
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $cpFile)) {
        throw "Classpath file not generated at $cpFile"
    }

    # Prepend WebApi own compiled classes. dependency:build-classpath only
    # emits transitive deps, not the module target/classes.
    $ownClasses = Join-Path $RepoRoot 'Mage.Server.WebApi\target\classes'
    $cp = Get-Content $cpFile -Raw
    Set-Content -Path $cpFile -Value "$ownClasses;$cp" -Encoding ASCII
    Write-Ok "Classpath: $cpFile ($((Get-Item $cpFile).Length) bytes)"
}

# ---------------------------------------------------------------------------
# Phase 4 - NSSM service registration
# ---------------------------------------------------------------------------

function Register-Services($Config, $BundleRoot, $Nssm, $JavaExe) {
    Write-Section "Phase 4 - Register Windows Services"

    # MageWebApi - java.exe with classpath file
    $webApiParams = "`"@$($Config.webapi.jvmArgsFile)`" -cp `"@$($Config.webapi.classpathFile)`" $($Config.webapi.mainClass)"
    Install-NssmService `
        -Nssm $Nssm `
        -Name $Config.services.webapi `
        -Executable $JavaExe `
        -Parameters $webApiParams `
        -WorkingDirectory $Config.webapi.workingDirectory `
        -LogFile (Join-Path $Config.logs.directory 'webapi.log') `
        -RotationBytes $Config.logs.rotationMaxBytes `
        -EnvExtra @(
            "XMAGE_PROFILE=$($Config.webapi.profile)",
            "XMAGE_CORS_ORIGINS=$($Config.webapi.corsOrigins)",
            "XMAGE_WEBAPI_PORT=$($Config.webapi.port)",
            "XMAGE_REGISTRATION_ENABLED=$($Config.webapi.registrationEnabled)",
            "JAVA_HOME=$($Config.webapi.javaHome)"
        )

    # MageTunnel - cloudflared.exe
    $cloudflared = Join-Path $BundleRoot 'bin\cloudflared.exe'
    $tunnelParams = "tunnel --config `"$($Config.tunnel.configFile)`" run $($Config.tunnel.name)"
    Install-NssmService `
        -Nssm $Nssm `
        -Name $Config.services.tunnel `
        -Executable $cloudflared `
        -Parameters $tunnelParams `
        -LogFile (Join-Path $Config.logs.directory 'tunnel.log') `
        -RotationBytes $Config.logs.rotationMaxBytes

    # MageWatchdog - powershell.exe running mage-watchdog.ps1
    $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $watchdogScript = Join-Path $BundleRoot 'scripts\mage-watchdog.ps1'
    $watchdogParams = "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`""
    Install-NssmService `
        -Nssm $Nssm `
        -Name $Config.services.watchdog `
        -Executable $ps `
        -Parameters $watchdogParams `
        -WorkingDirectory $BundleRoot `
        -LogFile (Join-Path $Config.logs.directory 'watchdog.log') `
        -RotationBytes $Config.logs.rotationMaxBytes `
        -RestartDelay 10000
}

# ---------------------------------------------------------------------------
# Phase 5 - Start + health check
# ---------------------------------------------------------------------------

function Start-AndVerify($Config, $Nssm) {
    Write-Section "Phase 5 - Start services + health check"

    foreach ($svc in @($Config.services.webapi, $Config.services.tunnel, $Config.services.watchdog)) {
        Write-Step "Starting $svc..."
        & $Nssm start $svc | Out-Null
    }

    Write-Step "Polling /api/health (up to 60s)..."
    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $Config.watchdog.healthUrl -TimeoutSec 3 -UseBasicParsing
            if ($resp.StatusCode -eq 200) { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }

    if ($healthy) {
        Write-Ok "WebApi healthy at $($Config.watchdog.healthUrl)"
    } else {
        Write-Warn "WebApi did not respond within 60s. Check logs: mage-stack\logs\webapi.log"
    }

    Write-Section "Install complete"
    Write-Host "  Public URL : https://$($Config.tunnel.hostname)" -ForegroundColor Green
    Write-Host "  Health     : $($Config.watchdog.healthUrl)" -ForegroundColor Green
    Write-Host "  Status     : .\scripts\mage-status.ps1" -ForegroundColor Green
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$RepoRoot = Split-Path -Parent $BundleRoot
$Config = Read-BundleConfig $BundleRoot

# Ensure bundle subdirectories exist. The root .gitignore has `**/bin`
# which shadows mage-stack/bin/, so on a fresh clone these directories
# need to be created on demand rather than tracked via .gitkeep.
foreach ($sub in @('bin', 'logs')) {
    $p = Join-Path $BundleRoot $sub
    if (-not (Test-Path $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
}

Write-Host ""
Write-Host "==============================================================="  -ForegroundColor Cyan
Write-Host "  Mage Stack - Install (INFRA-1)" -ForegroundColor Cyan
Write-Host "==============================================================="  -ForegroundColor Cyan
Write-Host "  Bundle    : $BundleRoot"
Write-Host "  Repo      : $RepoRoot"
Write-Host ""

$pre = Test-Prereqs $Config $BundleRoot
$cloudflared = Get-Cloudflared $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

if (-not $SkipTunnelLogin) {
    Initialize-Tunnel $Config $cloudflared
} else {
    Write-Section "Phase 2 - Cloudflare Tunnel (skipped)"
    Write-Warn "-SkipTunnelLogin: keeping existing tunnel + config"
}

Build-WebApi $Config $RepoRoot
Register-Services $Config $BundleRoot $Nssm $pre.JavaExe
Start-AndVerify $Config $Nssm
