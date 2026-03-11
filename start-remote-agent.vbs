' ─── Jovi Remote Agent — Silent Launcher ──────────────
' This VBS script starts the remote agent hidden (no visible window).
' Placed in Windows Startup folder for auto-launch on login.

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Company\Green Build AI\R&D\Jovi Claw"
WshShell.Run "cmd /c node --import tsx remote-bootstrapper.ts", 0, False
