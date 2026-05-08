<#
.SYNOPSIS
    Grant the running user start/stop rights on the mage-stack services
    so day-to-day ops scripts (mage-up / mage-down / mage-redeploy) work
    from any PowerShell window without admin elevation.

.DESCRIPTION
    Tier 2 of the ops-automation ladder. One-time admin work; idempotent.

    Edits each service's DACL via `sc.exe sdset` to add a Allow ACE for
    the running user account with the bundle:
        RP = SERVICE_START
        WP = SERVICE_STOP
        DT = SERVICE_PAUSE_CONTINUE
        LO = SERVICE_INTERROGATE

    No other admin powers are granted. After this runs once,
    `Test-AdminOrAclGrant` (see `_helpers.ps1`) returns true for
    non-admin sessions and the day-to-day scripts proceed.

    Re-runs are safe: if the user SID is already present in a service's
    DACL, that service is skipped with a [SKIP] log line.

    Run from elevated PowerShell. The script aborts fast if not.

.PARAMETER Services
    Names of services to grant rights on. Defaults to the three
    mage-stack services. Override only if you've renamed them in
    config.json.

.EXAMPLE
    # Standard: grant rights on the three default services.
    .\grant-service-acl.ps1
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string[]]$Services = @('MageWebApi', 'MageTunnel', 'MageWatchdog')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

# Resolve current user (the admin who launched this PowerShell -- typically
# the same daily-driver account; the grant goes to whoever runs the script).
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$userName = $identity.Name

# Permission bundle. ASCII-safe SDDL token; no separators inside.
$rights = 'RPWPDTLO'
$newAce = "(A;;$rights;;;$userSid)"

Write-Section "Grant service-control ACL"
Write-Step "User    : $userName"
Write-Step "User SID: $userSid"
Write-Step "ACE     : $newAce"
Write-Host ""

$grantedCount = 0
$skippedCount = 0
$errorCount = 0

foreach ($svc in $Services) {
    Write-Host "--- $svc ---"

    # Confirm the service exists. `sc query` is readable without admin.
    & sc.exe query $svc | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Service '$svc' not found; skipping."
        $errorCount++
        Write-Host ""
        continue
    }

    # Read the current security descriptor in SDDL form. Output is
    # multi-line; we want the substantive lines (start with D: or S:)
    # joined and whitespace-stripped.
    $sdRaw = & sc.exe sdshow $svc
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "sdshow failed for '$svc' (exit $LASTEXITCODE); skipping."
        $errorCount++
        Write-Host ""
        continue
    }
    $oldSd = ($sdRaw | Where-Object { $_ -match '^\s*[DS]:' }) -join ''
    $oldSd = $oldSd -replace '\s', ''
    if (-not $oldSd) {
        Write-Warn "Could not parse SDDL for '$svc'. Raw output: $sdRaw"
        $errorCount++
        Write-Host ""
        continue
    }
    Write-Step "before: $oldSd"

    # Idempotency: skip if user SID is already in the DACL.
    if ($oldSd -match [regex]::Escape($userSid)) {
        Write-Ok "[SKIP] User SID already present in DACL."
        $skippedCount++
        Write-Host ""
        continue
    }

    # Insert the new ACE at the end of the DACL portion (before the
    # optional SACL `S:` portion if present). Both shapes occur in
    # practice: non-admin `sdshow` may hide the SACL while admin shows
    # both. Split on `)S:` rather than regex with `[^S]` because the
    # DACL rights mask routinely contains literal `S` characters
    # (e.g. `SW` = SERVICE_ENUMERATE_DEPENDENTS, `SY` = NT AUTHORITY\SYSTEM).
    $splitIdx = $oldSd.LastIndexOf(')S:')
    if ($splitIdx -ge 0) {
        # `)S:` boundary: include the `)` in the DACL portion.
        $daclPart = $oldSd.Substring(0, $splitIdx + 1)
        $saclPart = $oldSd.Substring($splitIdx + 1)
    } elseif ($oldSd.StartsWith('D:') -and $oldSd.EndsWith(')')) {
        # DACL only, no SACL.
        $daclPart = $oldSd
        $saclPart = ''
    } else {
        Write-Warn "Unexpected SDDL shape for '$svc': $oldSd"
        $errorCount++
        Write-Host ""
        continue
    }
    $newSd = "$daclPart$newAce$saclPart"

    # Apply via sdset. sc.exe takes the SDDL as a single argument;
    # PowerShell quotes it correctly across the parens / semicolons.
    & sc.exe sdset $svc $newSd | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "sdset failed for '$svc' (exit $LASTEXITCODE). Original SDDL preserved."
        Write-Err "Recover with: sc.exe sdset $svc `"$oldSd`""
        $errorCount++
        Write-Host ""
        continue
    }

    # Verify by reading back. If the new SDDL doesn't contain the SID,
    # something went wrong and we want to know loudly.
    $verifyRaw = & sc.exe sdshow $svc
    $verifySd = ($verifyRaw | Where-Object { $_ -match '^\s*[DS]:' }) -join ''
    $verifySd = $verifySd -replace '\s', ''
    Write-Step "after : $verifySd"
    if ($verifySd -notmatch [regex]::Escape($userSid)) {
        Write-Err "Verification FAILED for '$svc' -- new SDDL does not contain user SID."
        Write-Err "Recover with: sc.exe sdset $svc `"$oldSd`""
        $errorCount++
        Write-Host ""
        continue
    }
    Write-Ok "Grant applied."
    $grantedCount++
    Write-Host ""
}

Write-Section "Summary"
Write-Step "Granted: $grantedCount"
Write-Step "Skipped: $skippedCount (already had grant)"
Write-Step "Errors : $errorCount"
Write-Host ""

if ($errorCount -eq 0) {
    Write-Ok "Tier 2 setup complete."
    Write-Host ""
    Write-Host "Verify by opening a NEW non-admin PowerShell and running:"
    Write-Host "  .\mage-stack\scripts\mage-redeploy.ps1"
    Write-Host ""
    Write-Host "It should complete without a UAC prompt. If it asks for elevation,"
    Write-Host "the grant didn't take -- re-run this script and check the output."
} else {
    Write-Err "Tier 2 setup completed with errors. Review the log above."
    exit 1
}
