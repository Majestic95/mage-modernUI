<#
.SYNOPSIS
    Start the three Mage Stack services. Idempotent.

.DESCRIPTION
    Removes the .intentional-down sentinel (so the watchdog stops
    suppressing restarts), then starts the services in dependency order:
    WebApi -> Tunnel -> Watchdog. Polls /api/health for up to 60s and
    prints the result.

    Run from elevated PowerShell, or from any PowerShell after the
    one-time `grant-service-acl.ps1` setup (Tier 2; see README).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

Assert-AdminOrAclGrant -ServiceName $Config.services.webapi

Write-Section "Mage Stack - start"

$sentinel = Join-Path $BundleRoot '.intentional-down'
if (Test-Path $sentinel) {
    Remove-Item $sentinel -Force
    Write-Ok "Cleared intentional-down sentinel"
}

foreach ($svc in @($Config.services.webapi, $Config.services.tunnel, $Config.services.watchdog)) {
    $state = Get-ServiceState $svc
    if ($state -eq 'Running') {
        Write-Ok "$svc already running"
        continue
    }
    Write-Step "Starting $svc..."
    & $Nssm start $svc | Out-Null
}

Write-Step "Polling $($Config.watchdog.healthUrl) (up to 60s)..."
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
    Write-Ok "WebApi healthy"
    Write-Host ""
    Write-Host "  Public URL : https://$($Config.tunnel.hostname)" -ForegroundColor Green
} else {
    Write-Warn "WebApi did not respond within 60s. Check: .\scripts\mage-logs.ps1 webapi"
}
Write-Host ""
