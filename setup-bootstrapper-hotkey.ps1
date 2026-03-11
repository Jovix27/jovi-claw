# Jovi Bootstrapper Hotkey Setup
# Run this to start the Ctrl+Shift+J hotkey listener

$scriptPath = Join-Path $PSScriptRoot "src\utils\BootstrapperHotkey.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: BootstrapperHotkey.ps1 not found at: $scriptPath" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starting Jovi Bootstrapper Hotkey Listener..." -ForegroundColor Cyan
Write-Host ""

# Run the hotkey listener
powershell -ExecutionPolicy Bypass -NoProfile -File $scriptPath -ProjectPath $PSScriptRoot
