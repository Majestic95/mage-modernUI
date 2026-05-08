<#
.SYNOPSIS
    Rebuild WebApi + restart MageWebApi service. Tunnel + Watchdog stay up.

.DESCRIPTION
    The standard "I just pulled new code" flow. Stops MageWebApi,
    rebuilds the JAR, regenerates the classpath file, restarts.
    Tunnel and Watchdog are unaffected - Tunnel reconnects automatically
    once WebApi is back up; Watchdog respects the intentional-down
    sentinel during the restart window.

    Run from elevated PowerShell, or from any PowerShell after the
    one-time `grant-service-acl.ps1` setup (Tier 2; see README).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$RepoRoot = Split-Path -Parent $BundleRoot
$Config = Read-BundleConfig $BundleRoot
$Nssm = Join-Path $BundleRoot 'bin\nssm.exe'

Assert-AdminOrAclGrant -ServiceName $Config.services.webapi

# Inject the bundle's pinned JDK into the session BEFORE any mvn call.
# Admin shells without JAVA_HOME pre-set otherwise fall through to a
# JRE and fail with "No compiler is provided in this environment."
$jdkHome = Use-ResolvedJavaHome -ConfigJavaHome $Config.webapi.javaHome

Write-Section "Mage Stack - redeploy"
Write-Step "JDK: $jdkHome"

# Sentinel suppresses watchdog restarts during build window.
$sentinel = Join-Path $BundleRoot '.intentional-down'
$payload = @{
    timestamp = (Get-Date).ToString('o')
    reason    = 'redeploy'
} | ConvertTo-Json -Compress
Set-Content -Path $sentinel -Value $payload -Encoding UTF8

try {
    Write-Step "Stopping $($Config.services.webapi)..."
    & $Nssm stop $Config.services.webapi | Out-Null
    Start-Sleep -Seconds 2

    Write-Step "mvn package (WebApi standalone pom)..."
    Push-Location $RepoRoot
    try {
        & mvn -f Mage.Server.WebApi/pom.xml package -DskipTests -q
        Throw-OnExit 'mvn package'
    } finally {
        Pop-Location
    }

    Write-Step "Regenerating classpath..."
    $cpFile = $Config.webapi.classpathFile
    Push-Location $RepoRoot
    try {
        & mvn -f Mage.Server.WebApi/pom.xml -q dependency:build-classpath "-Dmdep.outputFile=$cpFile" "-Dmdep.includeScope=runtime"
        Throw-OnExit 'mvn dependency:build-classpath'
    } finally {
        Pop-Location
    }
    $ownClasses = Join-Path $RepoRoot 'Mage.Server.WebApi\target\classes'
    $cp = Get-Content $cpFile -Raw
    Set-Content -Path $cpFile -Value "$ownClasses;$cp" -Encoding ASCII
    Write-Ok "Build artifacts updated"

    Write-Step "Starting $($Config.services.webapi)..."
    & $Nssm start $Config.services.webapi | Out-Null

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
        Write-Ok "Redeploy complete. WebApi healthy."
    } else {
        Write-Err "WebApi did not respond within 60s. Check: .\scripts\mage-logs.ps1 webapi"
    }
} finally {
    if (Test-Path $sentinel) {
        Remove-Item $sentinel -Force
    }
}
Write-Host ""
