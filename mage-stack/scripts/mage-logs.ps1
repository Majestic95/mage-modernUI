<#
.SYNOPSIS
    Tail one of the Mage Stack service logs.

.DESCRIPTION
    Default: tail the WebApi log. Pass 'tunnel' or 'watchdog' to tail
    those instead. Press Ctrl-C to stop.

.PARAMETER Service
    Which log to tail. One of: webapi, tunnel, watchdog. Default: webapi.

.PARAMETER Tail
    Number of recent lines to print before following. Default: 50.
#>
[CmdletBinding()]
param(
    [ValidateSet('webapi', 'tunnel', 'watchdog')]
    [string]$Service = 'webapi',

    [int]$Tail = 50
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot

$logFile = Join-Path $Config.logs.directory "$Service.log"
if (-not (Test-Path $logFile)) {
    Write-Err "Log file not found: $logFile"
    Write-Host "Available logs:"
    Get-ChildItem $Config.logs.directory -Filter '*.log' | ForEach-Object {
        Write-Host "  $($_.Name)"
    }
    exit 1
}

Write-Host "Tailing $logFile (Ctrl-C to stop)" -ForegroundColor Cyan
Write-Host ""
Get-Content -Path $logFile -Tail $Tail -Wait
