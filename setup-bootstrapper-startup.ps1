# Jovi Remote Bootstrapper - Windows Startup Setup
# Run this script as Administrator to add the bootstrapper to Windows startup

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupFolder = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupFolder "jovi-bootstrapper.vbs"

# Create a VBS wrapper that runs the bootstrapper silently (no visible window)
$vbsContent = @"
' Jovi Remote Bootstrapper - Silent Startup
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$scriptPath"
WshShell.Run "cmd /c npm run remote-bootstrapper", 0, False
"@

# Write the VBS file to the Startup folder
$vbsContent | Out-File -FilePath $vbsPath -Encoding ASCII -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Jovi Bootstrapper Startup Configured! " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Created: $vbsPath" -ForegroundColor Green
Write-Host ""
Write-Host "The bootstrapper will now:"
Write-Host "  1. Start automatically when Windows boots"
Write-Host "  2. Stay connected to Jovi in the cloud"
Write-Host "  3. Launch the remote agent when you ask Jovi to 'turn on agent mode'"
Write-Host ""
Write-Host "To test it now, run: npm run remote-bootstrapper" -ForegroundColor Yellow
Write-Host ""
