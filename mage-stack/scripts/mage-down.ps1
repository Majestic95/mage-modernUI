<#
.SYNOPSIS
    Stop the three Mage Stack services.

.DESCRIPTION
    Writes .intentional-down so the watchdog stops trying to restart
    MageWebApi, then stops services in reverse-dependency order:
    Watchdog -> Tunnel -> WebApi.

    Run from elevated PowerShell, or from any PowerShell after the
    one-time `grant-service-acl.ps1` setup (Tier 2; see README).
#>
[CmdletBinding()]
param(
    [string]$Reason = 'manual'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

Assert-AdminOrAclGrant -ServiceName $Config.services.webapi

Write-Section "Mage Stack - stop"

# Sentinel BEFORE stopping the watchdog so it does not try one
# last restart between our stop call and its tick.
$sentinel = Join-Path $BundleRoot '.intentional-down'
$payload = @{
    timestamp = (Get-Date).ToString('o')
    reason    = $Reason
} | ConvertTo-Json -Compress
Set-Content -Path $sentinel -Value $payload -Encoding UTF8
Write-Ok "Wrote intentional-down sentinel"

foreach ($svc in @($Config.services.watchdog, $Config.services.tunnel, $Config.services.webapi)) {
    $state = Get-ServiceState $svc
    if ($state -eq 'Stopped') {
        Write-Ok "$svc already stopped"
        continue
    }
    if ($state -eq 'NotFound') {
        Write-Warn "$svc not registered (skip)"
        continue
    }
    Write-Step "Stopping $svc..."
    & $Nssm stop $svc | Out-Null
    Start-Sleep -Seconds 1
}

Write-Ok "All services stopped. Run mage-up.ps1 to bring them back."
Write-Host ""
