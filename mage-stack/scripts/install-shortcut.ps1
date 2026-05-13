<#
.SYNOPSIS
    Drop a "Mage Server" .lnk on the current user's Desktop that launches
    mage-control.ps1 without a visible PowerShell console window.

.DESCRIPTION
    One-shot, idempotent. Re-run to refresh the shortcut if the script
    moves or the working directory changes.

    The shortcut runs:
        powershell.exe -NoProfile -ExecutionPolicy Bypass
                       -WindowStyle Hidden -File mage-control.ps1

    -WindowStyle Hidden keeps a console window from flashing on launch;
    the WinForms window is the only thing the user sees.
#>
[CmdletBinding()]
param(
    [string]$ShortcutName = 'Mage Server'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = $PSScriptRoot
$Target = Join-Path $ScriptDir 'mage-control.ps1'
if (-not (Test-Path $Target)) {
    throw "mage-control.ps1 not found next to this installer: $Target"
}

$DesktopDir = [Environment]::GetFolderPath('Desktop')
$LnkPath = Join-Path $DesktopDir ("$ShortcutName.lnk")

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($LnkPath)
$sc.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$sc.Arguments  = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Target`""
$sc.WorkingDirectory = $ScriptDir
$sc.IconLocation = "$env:WINDIR\System32\shell32.dll,137"
$sc.Description = 'Start / stop the local Mage server stack'
$sc.WindowStyle = 7
$sc.Save()

Write-Host ""
Write-Host "  [OK] Shortcut created:" -ForegroundColor Green
Write-Host "       $LnkPath"
Write-Host ""
Write-Host "  Double-click it to open the Mage Server control panel."
Write-Host ""
