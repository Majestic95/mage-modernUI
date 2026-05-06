#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Stop and remove the three Mage Stack Windows Services.

.DESCRIPTION
    Reverses install-service.ps1. Does NOT touch:
      - The Cloudflare Tunnel registration in your CF dashboard
      - The credentials file at config.tunnel.credentialsFile
      - The DNS record on Cloudflare
      - The .secrets/ folder
      - Bundle binaries (bin/cloudflared.exe, bin/nssm.exe)
      - Logs

    Pass -Purge to also remove generated config and rotated logs.
#>
[CmdletBinding()]
param(
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

Write-Host ""
Write-Host "==============================================================="  -ForegroundColor Cyan
Write-Host "  Mage Stack - Uninstall" -ForegroundColor Cyan
Write-Host "==============================================================="  -ForegroundColor Cyan

Write-Section "Stopping and removing services"
# Reverse order: watchdog first (so it does not fight the WebApi stop),
# then tunnel, then webapi.
$services = @(
    $Config.services.watchdog,
    $Config.services.tunnel,
    $Config.services.webapi
)

foreach ($svc in $services) {
    $existing = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Warn "Service $svc not found (already removed?)"
        continue
    }
    Write-Step "Stopping $svc..."
    if ($existing.Status -ne 'Stopped') {
        & $Nssm stop $svc | Out-Null
        Start-Sleep -Seconds 2
    }
    Write-Step "Removing $svc..."
    & $Nssm remove $svc confirm | Out-Null
    Write-Ok "Removed: $svc"
}

if ($Purge) {
    Write-Section "Purge - removing generated files"

    foreach ($f in @($Config.tunnel.configFile, $Config.webapi.classpathFile)) {
        if (Test-Path $f) {
            Remove-Item $f -Force
            Write-Ok "Removed $f"
        }
    }

    if (Test-Path $Config.logs.directory) {
        Get-ChildItem $Config.logs.directory -Filter '*.log*' | Remove-Item -Force
        Write-Ok "Cleared logs in $($Config.logs.directory)"
    }
} else {
    Write-Warn "Generated config + logs preserved. Pass -Purge to remove them."
}

Write-Section "Uninstall complete"
Write-Host "  - Services removed."
Write-Host "  - Cloudflare Tunnel + DNS + credentials JSON: untouched (your assets)."
Write-Host "  - To delete the tunnel itself:"
Write-Host "      $BundleRoot\bin\cloudflared.exe tunnel delete $($Config.tunnel.name)"
Write-Host ""
