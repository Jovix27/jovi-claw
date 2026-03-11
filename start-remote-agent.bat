@echo off
:: ─── Jovi Remote Agent — Auto-Start Script ──────────────
:: This script is placed in the Windows Startup folder.
:: It starts the remote agent in the background when you log in.
:: The agent window is minimized to the taskbar.

title Jovi Remote Agent
cd /d "E:\Company\Green Build AI\R&D\Jovi Claw"

:: Wait a few seconds for network to be ready after boot
timeout /t 10 /nobreak >nul

:: Start the remote bootstrapper
echo Starting Jovi Remote Bootstrapper...
node --import tsx remote-bootstrapper.ts
