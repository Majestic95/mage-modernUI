<#
.SYNOPSIS
    Print Mage Stack health dashboard.

.DESCRIPTION
    Three-line service summary (state + PID + uptime), public URL,
    /api/health response, intentional-down sentinel state if present.
    Read-only; safe to run unprivileged.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot

function Format-ServiceRow($Label, $Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) {
        return "{0,-10} ({1,-15}) : {2}" -f $Label, $Name, "* not registered"
    }
    if ($svc.Status -ne 'Running') {
        return "{0,-10} ({1,-15}) : {2,-7} {3}" -f $Label, $Name, "[down]", $svc.Status
    }
    # Get the underlying process via WMI/CIM for PID + start time.
    $cim = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if ($cim -and $cim.ProcessId -gt 0) {
        $proc = Get-Process -Id $cim.ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            $up = Format-Uptime $proc.StartTime
            return "{0,-10} ({1,-15}) : {2,-7} PID {3,-7} uptime {4}" -f $Label, $Name, "[up]", $proc.Id, $up
        }
    }
    return "{0,-10} ({1,-15}) : {2}" -f $Label, $Name, "[up]"
}

Write-Host ""
Write-Host "=== Mage Stack Status ====================================" -ForegroundColor Cyan
Write-Host (Format-ServiceRow 'WebApi'   $Config.services.webapi)
Write-Host (Format-ServiceRow 'Tunnel'   $Config.services.tunnel)
Write-Host (Format-ServiceRow 'Watchdog' $Config.services.watchdog)
Write-Host ""

Write-Host ("  Public URL : https://{0} -> http://localhost:{1}" -f $Config.tunnel.hostname, $Config.webapi.port)

# Health probe.
try {
    $resp = Invoke-WebRequest -Uri $Config.watchdog.healthUrl -TimeoutSec 3 -UseBasicParsing
    Write-Host ("  Health     : {0} OK ({1})" -f $resp.StatusCode, $resp.Content.Trim()) -ForegroundColor Green
} catch {
    Write-Host ("  Health     : unreachable ({0})" -f $_.Exception.Message) -ForegroundColor Red
}

# Intentional-down sentinel.
$sentinel = Join-Path $BundleRoot '.intentional-down'
if (Test-Path $sentinel) {
    $info = Get-Content $sentinel -Raw | ConvertFrom-Json
    Write-Host ("  Down since : {0} (reason: {1})" -f $info.timestamp, $info.reason) -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Logs : $($Config.logs.directory)"
Write-Host ""
