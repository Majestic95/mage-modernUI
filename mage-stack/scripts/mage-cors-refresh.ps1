<#
.SYNOPSIS
    Re-apply XMAGE_CORS_ORIGINS (and the rest of the WebApi env-extra)
    from config.json onto the MageWebApi NSSM service, then restart it.

.DESCRIPTION
    Use after editing config.webapi.corsOrigins (or any other webapi.*
    env field) in mage-stack/config/config.json. NSSM stores service
    env vars as part of the service config at install time; changing
    config.json alone does not update the running service. This script
    pushes the current config.json values into NSSM and bounces the
    service.

    Idempotent: safe to run when nothing has changed (the JVM bounces,
    new env is identical, app behaves the same).

    Faster than full mage-redeploy because no JAR rebuild — the running
    code is unchanged; only the JVM env block is.

    Run from elevated PowerShell.

.NOTES
    Why this exists: 2026-05-06, post-INFRA-2, Vercel was 307-redirecting
    modern-mage.com -> www.modern-mage.com (Vercel default when both
    apex and www are configured). The CORS allow-list had the apex but
    not the www variant; preflight returned 200 without an
    Access-Control-Allow-Origin header for the www origin and the
    browser blocked every API call with "Can't reach the server".

    First fix path attempted was a tempfile elevated PS one-shot; the
    user's antivirus correctly flagged that as a malware-loader signature.
    This script is the right shape: checked-in, reviewable, sibling to
    mage-redeploy.ps1, no tempfile.
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

Write-Section "Mage Stack - CORS / env refresh"

# Mirror of install-service.ps1's EnvExtra block. If you add a new
# env var there, add it here too — both must stay in sync.
$envExtra = @(
    "XMAGE_PROFILE=$($Config.webapi.profile)",
    "XMAGE_CORS_ORIGINS=$($Config.webapi.corsOrigins)",
    "XMAGE_WEBAPI_PORT=$($Config.webapi.port)",
    "XMAGE_REGISTRATION_ENABLED=$($Config.webapi.registrationEnabled)",
    "JAVA_HOME=$($Config.webapi.javaHome)"
) -join "`r`n"

$svc = $Config.services.webapi

Write-Step "corsOrigins: $($Config.webapi.corsOrigins)"
Write-Step "Setting AppEnvironmentExtra on $svc"
$null = & $Nssm set $svc AppEnvironmentExtra $envExtra
Throw-OnExit "$Nssm set $svc AppEnvironmentExtra"

Write-Step "Restarting $svc"
$null = & $Nssm restart $svc
Throw-OnExit "$Nssm restart $svc"

Write-Step "Polling /api/health (up to 60s)"
$healthUrl = "http://localhost:$($Config.webapi.port)/api/health"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) {
            Write-Ok "WebApi healthy: $($r.Content)"
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $ready) {
    Write-Err "WebApi did not become healthy within 60s. Check 'mage-stack\logs\webapi.log'."
    exit 1
}

Write-Section "Done"
Write-Ok "CORS / env refresh complete. New origins active."
