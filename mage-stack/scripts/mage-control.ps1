<#
.SYNOPSIS
    Tiny WinForms GUI to start / stop / inspect the Mage Stack services.

.DESCRIPTION
    Two buttons + a status light. Wraps mage-up.ps1 / mage-down.ps1 so the
    day-to-day "is the server up?" + "stop it / start it" flow is a single
    click instead of opening a terminal.

    Launch directly:
        powershell -NoProfile -ExecutionPolicy Bypass -File mage-control.ps1
    Or run install-shortcut.ps1 once to drop a Desktop launcher.

    Requires either admin elevation OR the Tier 2 service-ACL grant
    (see grant-service-acl.ps1). If neither is in place the form opens but
    the buttons are disabled and the status bar explains how to fix it.

    ASCII-only source per the mage-stack convention; form labels rendered
    at runtime by .NET are safe to be unicode.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_helpers.ps1')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$BundleRoot = Get-BundleRootFromScript $PSCommandPath
$Config = Read-BundleConfig $BundleRoot
$Services = @($Config.services.webapi, $Config.services.tunnel, $Config.services.watchdog)
$MageUp   = Join-Path $PSScriptRoot 'mage-up.ps1'
$MageDown = Join-Path $PSScriptRoot 'mage-down.ps1'

# ---------- State derivation ----------------------------------------------

function Get-StackState {
    $states = foreach ($svc in $Services) { Get-ServiceState $svc }
    # @(...) forces an array. Sort-Object -Unique on 3 identical values
    # returns a SCALAR string, and $unique[0] on a string yields the first
    # character ('S' for 'Stopped'), which would silently fall through to
    # the default Mixed branch.
    $unique = @($states | Sort-Object -Unique)

    if ($unique -contains 'NotFound') {
        return [pscustomobject]@{ Kind='NotInstalled'; Detail=($states -join ' / ') }
    }
    if ($unique.Count -eq 1) {
        switch ($unique[0]) {
            'Running'      { return [pscustomobject]@{ Kind='Running';   Detail='All services up' } }
            'Stopped'      { return [pscustomobject]@{ Kind='Stopped';   Detail='All services down' } }
            'StartPending' { return [pscustomobject]@{ Kind='Starting';  Detail='Services starting' } }
            'StopPending'  { return [pscustomobject]@{ Kind='Stopping';  Detail='Services stopping' } }
            default        { return [pscustomobject]@{ Kind='Mixed';     Detail=$unique[0] } }
        }
    }
    $breakdown = for ($i = 0; $i -lt $Services.Count; $i++) {
        "{0}={1}" -f $Services[$i], $states[$i]
    }
    return [pscustomobject]@{ Kind='Mixed'; Detail=($breakdown -join ', ') }
}

function Get-StyleFor($kind) {
    switch ($kind) {
        'Running'      { return @{ Color=[System.Drawing.Color]::FromArgb(40,180,80);   Label='RUNNING' } }
        'Stopped'      { return @{ Color=[System.Drawing.Color]::FromArgb(200,60,60);   Label='STOPPED' } }
        'Starting'     { return @{ Color=[System.Drawing.Color]::FromArgb(220,160,40);  Label='STARTING...' } }
        'Stopping'     { return @{ Color=[System.Drawing.Color]::FromArgb(220,160,40);  Label='STOPPING...' } }
        'Mixed'        { return @{ Color=[System.Drawing.Color]::FromArgb(220,160,40);  Label='MIXED' } }
        'NotInstalled' { return @{ Color=[System.Drawing.Color]::FromArgb(140,140,140); Label='NOT INSTALLED' } }
        default        { return @{ Color=[System.Drawing.Color]::FromArgb(140,140,140); Label='UNKNOWN' } }
    }
}

# ---------- Form ----------------------------------------------------------

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Mage Server'
$form.Size = New-Object System.Drawing.Size(400, 220)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 32)
$form.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

# Status dot (colored circle)
$dot = New-Object System.Windows.Forms.Panel
$dot.Size = New-Object System.Drawing.Size(18, 18)
$dot.Location = New-Object System.Drawing.Point(20, 22)
$dot.BackColor = [System.Drawing.Color]::FromArgb(140, 140, 140)
$dotRadius = 9
$dot.Add_Paint({
    param($sender, $e)
    $brush = New-Object System.Drawing.SolidBrush($sender.BackColor)
    $e.Graphics.SmoothingMode = 'AntiAlias'
    $e.Graphics.FillEllipse($brush, 0, 0, 17, 17)
    $brush.Dispose()
})
$form.Controls.Add($dot)

# Status label (big)
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(48, 18)
$lblStatus.Size = New-Object System.Drawing.Size(320, 26)
$lblStatus.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$lblStatus.Text = 'CHECKING...'
$form.Controls.Add($lblStatus)

# Detail label
$lblDetail = New-Object System.Windows.Forms.Label
$lblDetail.Location = New-Object System.Drawing.Point(22, 50)
$lblDetail.Size = New-Object System.Drawing.Size(350, 18)
$lblDetail.ForeColor = [System.Drawing.Color]::FromArgb(170, 170, 170)
$lblDetail.Text = ''
$form.Controls.Add($lblDetail)

# Start button
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = 'Start'
$btnStart.Size = New-Object System.Drawing.Size(110, 38)
$btnStart.Location = New-Object System.Drawing.Point(22, 86)
$btnStart.FlatStyle = 'Flat'
$btnStart.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 70)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(40, 110, 60)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStart)

# Stop button
$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = 'Stop'
$btnStop.Size = New-Object System.Drawing.Size(110, 38)
$btnStop.Location = New-Object System.Drawing.Point(140, 86)
$btnStop.FlatStyle = 'Flat'
$btnStop.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 70)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(150, 50, 50)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStop)

# Refresh button
$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = 'Refresh'
$btnRefresh.Size = New-Object System.Drawing.Size(110, 38)
$btnRefresh.Location = New-Object System.Drawing.Point(258, 86)
$btnRefresh.FlatStyle = 'Flat'
$btnRefresh.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 70)
$btnRefresh.BackColor = [System.Drawing.Color]::FromArgb(55, 60, 75)
$btnRefresh.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Controls.Add($btnRefresh)

# Footer / last-action line
$lblFooter = New-Object System.Windows.Forms.Label
$lblFooter.Location = New-Object System.Drawing.Point(22, 142)
$lblFooter.Size = New-Object System.Drawing.Size(350, 36)
$lblFooter.ForeColor = [System.Drawing.Color]::FromArgb(140, 140, 150)
$lblFooter.Text = ''
$form.Controls.Add($lblFooter)

# ---------- Behavior ------------------------------------------------------

$hasGrant = Test-AdminOrAclGrant -ServiceName $Config.services.webapi

function Update-Status {
    $state = Get-StackState
    $style = Get-StyleFor $state.Kind
    $lblStatus.Text = $style.Label
    $lblStatus.ForeColor = $style.Color
    $dot.BackColor = $style.Color
    $dot.Invalidate()
    $lblDetail.Text = $state.Detail

    $running = ($state.Kind -eq 'Running' -or $state.Kind -eq 'Mixed')
    $stopped = ($state.Kind -eq 'Stopped')
    $pending = ($state.Kind -eq 'Starting' -or $state.Kind -eq 'Stopping')
    $available = $hasGrant -and ($state.Kind -ne 'NotInstalled') -and (-not $pending)

    $btnStart.Enabled = $available -and (-not $running)
    $btnStop.Enabled  = $available -and (-not $stopped)
    $btnRefresh.Enabled = $true

    if (-not $hasGrant) {
        $lblFooter.Text = "No ACL grant. Run grant-service-acl.ps1 from elevated PowerShell once, then reopen this window."
    } elseif ($state.Kind -eq 'NotInstalled') {
        $lblFooter.Text = "Services not registered. Run install-service.ps1 first."
    }
}

function Invoke-StackScript($scriptPath, $verb) {
    $btnStart.Enabled = $false
    $btnStop.Enabled = $false
    $btnRefresh.Enabled = $false
    $lblFooter.Text = "Running $verb..."
    [System.Windows.Forms.Application]::DoEvents()

    $start = Get-Date
    try {
        $proc = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptPath) `
            -WindowStyle Hidden -PassThru
        while (-not $proc.HasExited) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 150
        }
        $elapsed = (Get-Date) - $start
        $stamp = (Get-Date).ToString('HH:mm:ss')
        if ($proc.ExitCode -eq 0) {
            $lblFooter.Text = "$stamp  $verb OK  ({0:N1}s)" -f $elapsed.TotalSeconds
        } else {
            $lblFooter.Text = "$stamp  $verb FAILED  exit=$($proc.ExitCode)"
        }
    } catch {
        $stamp = (Get-Date).ToString('HH:mm:ss')
        $lblFooter.Text = "$stamp  $verb ERROR  $($_.Exception.Message)"
    }
    Update-Status
}

$btnStart.Add_Click({ Invoke-StackScript $MageUp 'start' })
$btnStop.Add_Click({ Invoke-StackScript $MageDown 'stop' })
$btnRefresh.Add_Click({ Update-Status })

# Auto-refresh every 5s so external state changes (mage-redeploy from a
# terminal, watchdog kick) show up without the user clicking Refresh.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-Status })
$timer.Start()

$form.Add_Shown({ Update-Status })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })

[void] $form.ShowDialog()
