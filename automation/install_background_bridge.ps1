# Register the existing local bridge to run silently when the user signs in.
$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path (Join-Path $PSScriptRoot 'start_bridge_hidden.vbs')).Path
$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup) { throw 'Windows Startup folder unavailable' }
$shortcutPath = Join-Path $startup 'PredioAI IRM Bridge.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = Split-Path $launcher
$shortcut.Description = 'PredioAI local Playwright bridge'
$shortcut.Save()
Write-Host "Startup shortcut installed: $shortcutPath"
# Launch now without opening a console. If already running, the second instance
# will fail to bind and exit; the existing bridge remains available.
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + $launcher + '"') -WindowStyle Hidden
Write-Host 'PredioAI bridge background launch requested.'
