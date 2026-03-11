# setup.ps1
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location }

Write-Host "Cleaning up old configurations..."
# Kill any existing listeners or failed processes
Get-CimInstance Win32_Process -Filter "name='powershell.exe'" | Where-Object { $_.CommandLine -match "JoviLauncher.ps1" -or $_.CommandLine -match "jovi-listener.ps1" } | Invoke-CimMethod -MethodName Terminate -ErrorAction SilentlyContinue
Get-Process -Name "jovi-listener" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "wscript" -ErrorAction SilentlyContinue | Stop-Process -Force

# Delete old files
Remove-Item (Join-Path $ScriptDir "JoviLauncher.ps1") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ScriptDir "JoviLauncher.vbs") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ScriptDir "install-startup.ps1") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ScriptDir "uninstall-startup.ps1") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ScriptDir "jovi-listener.ps1") -ErrorAction SilentlyContinue
Remove-Item "$([Environment]::GetFolderPath('Startup'))\Jovi AI Boot Listener.lnk" -ErrorAction SilentlyContinue
Remove-Item "$([Environment]::GetFolderPath('Startup'))\Jovi Listener.lnk" -ErrorAction SilentlyContinue
Remove-Item "$([Environment]::GetFolderPath('Startup'))\jovi-win-j.vbs" -ErrorAction SilentlyContinue

Write-Host "Compiling native C# hook..." -ForegroundColor Cyan
& (Join-Path $ScriptDir "compile-hook.ps1")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to compile the Hook. Aborting setup." -ForegroundColor Red
    exit 1
}

Write-Host "Installing new Native C# Win+J Listener to Startup folder..."
$ExePath = Join-Path $ScriptDir "jovi-listener.exe"

if (-not (Test-Path $ExePath)) {
    Write-Host "Error: jovi-listener.exe not found. Please compile it first!" -ForegroundColor Red
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = "$([Environment]::GetFolderPath('Startup'))\Jovi Native Hook.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "Flawless Native Win+J Hook for Jovi AI"
$Shortcut.Save()

Write-Host "Starting the listener natively..."
# Start the listener via the shortcut to ensure it executes seamlessly 
Invoke-Item $ShortcutPath

Write-Host "✅ Setup Complete. C# Native Hook is now active in the background."
Write-Host "✅ Win+J will automatically start Jovi AI with absolute zero delay!"
