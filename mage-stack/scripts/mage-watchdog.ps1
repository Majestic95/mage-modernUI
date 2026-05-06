<#
.SYNOPSIS
    Health-check watchdog for MageWebApi. Runs as the MageWatchdog service.

.DESCRIPTION
    Polls /api/health every config.watchdog.intervalSeconds (default 30s).
    After config.watchdog.consecutiveFailuresBeforeRestart consecutive
    failures (default 3), forces an NSSM restart of MageWebApi.

    Respects the .intentional-down sentinel - if present, skips restart
    logic so mage-down / mage-redeploy do not fight the watchdog.

    Logs every check (debug level) and every restart action (info level)
    to stdout - NSSM redirects to logs/watchdog.log.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # Watchdog must NOT crash on transient errors.
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

$WebApiName = $Config.services.webapi
$HealthUrl = $Config.watchdog.healthUrl
$Interval = [int]$Config.watchdog.intervalSeconds
$Timeout = [int]$Config.watchdog.timeoutSeconds
$Threshold = [int]$Config.watchdog.consecutiveFailuresBeforeRestart
$Sentinel = Join-Path $BundleRoot '.intentional-down'

function Write-Log($Level, $Msg) {
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] [$Level] $Msg"
}

Write-Log INFO "watchdog start: poll=$($Interval)s timeout=$($Timeout)s threshold=$Threshold url=$HealthUrl"

$consecutiveFailures = 0

while ($true) {
    Start-Sleep -Seconds $Interval

    if (Test-Path $Sentinel) {
        # Intentional down - operator stopped the service deliberately.
        # Do not reset the failure counter (it should already be 0; if it
        # is not, we will resume after the operator runs mage-up).
        if ($consecutiveFailures -gt 0) {
            Write-Log INFO "intentional-down sentinel present; pausing health checks"
            $consecutiveFailures = 0
        }
        continue
    }

    $ok = $false
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $Timeout -UseBasicParsing
        if ($resp.StatusCode -eq 200) { $ok = $true }
    } catch {
        # Failure path - invocation threw or returned non-200.
    }

    if ($ok) {
        if ($consecutiveFailures -gt 0) {
            Write-Log INFO "recovered after $consecutiveFailures consecutive failures"
        }
        $consecutiveFailures = 0
        continue
    }

    $consecutiveFailures++
    Write-Log WARN "health check failed ($consecutiveFailures / $Threshold)"

    if ($consecutiveFailures -ge $Threshold) {
        Write-Log INFO "threshold reached - restarting $WebApiName"
        try {
            & $Nssm restart $WebApiName | Out-Null
            Write-Log INFO "restart issued"
        } catch {
            Write-Log ERROR "nssm restart failed: $($_.Exception.Message)"
        }
        # Reset counter so we wait for full threshold of failures again
        # before issuing another restart. Prevents tight-loop restarts
        # if the WebApi is fundamentally broken.
        $consecutiveFailures = 0
    }
}
