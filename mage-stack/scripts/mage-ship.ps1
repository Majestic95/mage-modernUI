<#
.SYNOPSIS
    Push current branch to origin, then redeploy WebApi and/or webclient.

.DESCRIPTION
    The "I just finished a slice, make it live" wrapper. Combines the
    three steps you'd otherwise run by hand:

      1. git push origin <current-branch>
      2. mage-redeploy.ps1               (if -Webapi)
      3. pnpm build + vercel deploy      (if -Webclient)

    No flags = print usage and exit. You always say what's shipping;
    the script never assumes.

.PARAMETER Webapi
    Redeploy the local WebApi service via mage-redeploy.ps1. Requires
    admin (mage-redeploy itself does). If you run this from a non-admin
    shell, the underlying script will fail loudly.

.PARAMETER Webclient
    Build the Vercel bundle locally with the API URL + REDESIGN flag
    baked in (per feedback_vercel_env_redesign_empty.md), then upload
    the prebuilt artifact to production. Reuses the existing Vercel
    project link in webclient/.vercel/.

.PARAMETER NoPush
    Skip the git push step (use when origin/main already has the commit
    you want shipped, e.g. someone else pushed, or you're re-running
    after a deploy hiccup).

.PARAMETER Force
    Allow shipping from a branch other than 'main'. Without this, the
    script aborts on a non-main branch to prevent accidental "ship a
    feature branch's WIP commit to live" footguns.

.PARAMETER DryRun
    Print every command that would run without executing any of them.
    Doesn't call git, Restart-Service, pnpm, or vercel.

.EXAMPLE
    .\mage-ship.ps1 -Webapi
        Webapi-only ship: push current branch, then mage-redeploy.

.EXAMPLE
    .\mage-ship.ps1 -Webclient
        Webclient-only ship: push, then pnpm build + vercel deploy.

.EXAMPLE
    .\mage-ship.ps1 -Webapi -Webclient
        Full-stack ship for slices that touch both surfaces.

.EXAMPLE
    .\mage-ship.ps1 -Webapi -Webclient -DryRun
        Show the command graph without doing anything.

.NOTES
    pnpm, not npm, per CLAUDE.md rule #6.

    The Vercel env vars are shell-overridden on every build because the
    Vercel project stores VITE_FEATURE_REDESIGN as "" (empty string),
    which Vite resolves as false; without the override the bundle
    silently falls back to the legacy layout. See memory
    feedback_vercel_env_redesign_empty.md.

    VITE_XMAGE_WEBAPI_URL is hardcoded to the post-INFRA-2 hostname.
    If that ever changes, update the constant below AND the Vercel
    project setting in lockstep.
#>
[CmdletBinding()]
param(
    [switch]$Webapi,
    [switch]$Webclient,
    [switch]$NoPush,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

# Source of truth for the Vercel-side env vars. Mirrors what the Vercel
# project settings have stored, but shell-overridden on every build to
# survive the empty-string footgun.
$Script:WebapiUrl       = 'https://api.modern-mage.com'
$Script:FeatureRedesign = 'true'

# JDK 17 bin path. Mirrored from mage-redeploy.ps1's environment expectation.
# mage-redeploy itself reads JAVA_HOME from the calling shell, so we set it
# here for the case where the user runs mage-ship from a vanilla PS prompt.
$Script:JavaHome = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.12.7-hotspot'

# ---------- usage gate ----------

if (-not $Webapi -and -not $Webclient) {
    Write-Host @"
mage-ship: push origin + (optional) redeploy WebApi + (optional) deploy webclient

Usage:
    .\mage-ship.ps1 [-Webapi] [-Webclient] [-NoPush] [-Force] [-DryRun]

At least one of -Webapi or -Webclient is required. Without flags this
script is a no-op (so a typo doesn't ship something unintended).

See: Get-Help .\mage-ship.ps1 -Full
"@
    exit 0
}

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$RepoRoot   = Split-Path -Parent $BundleRoot

# ---------- step 0: branch sanity ----------

Push-Location $RepoRoot
try {
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
} finally {
    Pop-Location
}

if ($branch -ne 'main' -and -not $Force) {
    Write-Err "Current branch is '$branch', not 'main'. Use -Force to ship anyway."
    exit 2
}

$dirty = $false
Push-Location $RepoRoot
try {
    $dirty = [bool](git status --porcelain)
} finally {
    Pop-Location
}

if ($dirty) {
    Write-Err "Working tree has uncommitted changes. Commit first so production matches an auditable git revision."
    exit 5
}

Write-Section "Mage Stack - ship"
Write-Step "Branch: $branch"
Write-Step ("Targets: " + (@(
    if ($Webapi)    { 'WebApi' }
    if ($Webclient) { 'webclient (Vercel)' }
) -join ', '))
if ($DryRun) { Write-Warn "DRY RUN - no commands will execute." }

# ---------- step 1: git push ----------

if ($NoPush) {
    Write-Step "Skipping git push (-NoPush)"
} else {
    Write-Step "git push origin $branch"
    if (-not $DryRun) {
        Push-Location $RepoRoot
        try {
            git push origin $branch
            if ($LASTEXITCODE -ne 0) { throw "git push failed (exit $LASTEXITCODE)." }
        } finally {
            Pop-Location
        }
    }
    Write-Ok "Pushed."
}

# ---------- step 2: WebApi redeploy ----------

if ($Webapi) {
    Write-Step "Redeploying WebApi via mage-redeploy.ps1"
    if (-not $DryRun) {
        $env:JAVA_HOME = $Script:JavaHome
        $env:PATH      = "$Script:JavaHome\bin;" + $env:PATH
        & (Join-Path $PSScriptRoot 'mage-redeploy.ps1')
        if ($LASTEXITCODE -ne 0) { throw "mage-redeploy failed (exit $LASTEXITCODE)." }
    }
    Write-Ok "WebApi live."
}

# ---------- step 3: webclient build + Vercel deploy ----------

if ($Webclient) {
    $WebclientDir = Join-Path $RepoRoot 'webclient'
    if (-not (Test-Path $WebclientDir)) {
        Write-Err "webclient/ not found at $WebclientDir"
        exit 3
    }

    # CLI presence check. pnpm + vercel are user-PATH installs; they
    # vanish under sudo / Run-as-Administrator unless explicitly added.
    foreach ($tool in @('pnpm', 'vercel')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Write-Err "$tool not on PATH. Run mage-ship from a shell where '$tool --version' works."
            exit 4
        }
    }

    Write-Step "pnpm build (with VITE_XMAGE_WEBAPI_URL + VITE_FEATURE_REDESIGN baked in)"
    if (-not $DryRun) {
        Push-Location $WebclientDir
        try {
            $env:VITE_XMAGE_WEBAPI_URL = $Script:WebapiUrl
            $env:VITE_FEATURE_REDESIGN = $Script:FeatureRedesign
            & pnpm build
            if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)." }

            Write-Step "vercel build --prod --yes"
            & vercel build --prod --yes
            if ($LASTEXITCODE -ne 0) { throw "vercel build failed (exit $LASTEXITCODE)." }

            Write-Step "vercel deploy --prebuilt --prod --yes"
            & vercel deploy --prebuilt --prod --yes
            if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed (exit $LASTEXITCODE)." }
        } finally {
            Pop-Location
        }
    }
    Write-Ok "Vercel bundle live at https://modern-mage.com/"
}

Write-Section "Done"
Write-Ok ("Shipped: " + (@(
    if ($Webapi)    { 'WebApi' }
    if ($Webclient) { 'webclient' }
) -join ' + '))
