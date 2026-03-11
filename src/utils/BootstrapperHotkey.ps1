# BootstrapperHotkey.ps1 — Global hotkey listener for Ctrl+Shift+J
# Starts the Jovi remote bootstrapper when hotkey is pressed
# Usage: powershell -ExecutionPolicy Bypass -NoProfile -File BootstrapperHotkey.ps1

param(
    [string]$ProjectPath = ""
)

# Resolve project path
if (-not $ProjectPath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ProjectPath = Split-Path -Parent (Split-Path -Parent $scriptDir)
}

$script:bootstrapperStarted = $false
$script:projectPath = $ProjectPath

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public class BootstrapperHotkey {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;
    private const int VK_J = 0x4A;

    private static IntPtr hookId = IntPtr.Zero;
    private static HookProc hookProc;
    private static string projectPath;
    private static bool bootstrapperStarted = false;

    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public static void SetProjectPath(string path) {
        projectPath = path;
    }

    public static bool Start() {
        hookProc = new HookProc(HookCallback);
        IntPtr moduleHandle = GetModuleHandle(null);
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, moduleHandle, 0);

        if (hookId == IntPtr.Zero) {
            return false;
        }
        return true;
    }

    public static void Stop() {
        if (hookId != IntPtr.Zero) {
            UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vkCode = Marshal.ReadInt32(lParam);
            int msg = wParam.ToInt32();

            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                // Check if Ctrl+Shift+J is pressed
                bool ctrlPressed = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                bool shiftPressed = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;

                if (vkCode == VK_J && ctrlPressed && shiftPressed) {
                    if (bootstrapperStarted) {
                        Console.WriteLine("HOTKEY_IGNORED: Bootstrapper already running. Press Ctrl+Shift+K to reset.");
                        return CallNextHookEx(hookId, nCode, wParam, lParam);
                    }

                    bootstrapperStarted = true;
                    Console.WriteLine("HOTKEY_TRIGGERED");

                    // Start bootstrapper in a new thread to not block the hook
                    ThreadPool.QueueUserWorkItem(_ => {
                        try {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            psi.FileName = "cmd.exe";
                            psi.Arguments = "/c cd /d \"" + projectPath + "\" && npm run remote-bootstrapper";
                            psi.WorkingDirectory = projectPath;
                            psi.WindowStyle = ProcessWindowStyle.Minimized;
                            psi.UseShellExecute = false;
                            psi.RedirectStandardOutput = false;
                            psi.RedirectStandardError = false;
                            Process proc = Process.Start(psi);

                            // Monitor process in background — reset flag when it exits
                            ThreadPool.QueueUserWorkItem(__ => {
                                try {
                                    if (proc != null) {
                                        proc.WaitForExit();
                                        Console.WriteLine("BOOTSTRAPPER_EXITED: Ready for re-trigger via Ctrl+Shift+J");
                                    }
                                } catch {}
                                bootstrapperStarted = false;
                            });
                        } catch (Exception ex) {
                            Console.WriteLine("ERROR: " + ex.Message);
                            bootstrapperStarted = false;  // Reset on failure so user can retry
                        }
                    });
                }

                // Ctrl+Shift+K = Force reset the bootstrapper flag
                if (vkCode == 0x4B && ctrlPressed && shiftPressed && bootstrapperStarted) {
                    bootstrapperStarted = false;
                    Console.WriteLine("BOOTSTRAPPER_RESET: Flag cleared. Press Ctrl+Shift+J to start again.");
                }
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }
}
"@ -ReferencedAssemblies @()

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MsgPump {
    [DllImport("user32.dll")]
    public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    public static void Run() {
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}
"@ -ReferencedAssemblies @()

# Display banner
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Jovi Bootstrapper Hotkey Listener    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Hotkey: Ctrl+Shift+J" -ForegroundColor Yellow
Write-Host "  Press this to connect your laptop to Jovi" -ForegroundColor Gray
Write-Host ""
Write-Host "  Project: $ProjectPath" -ForegroundColor DarkGray
Write-Host ""

# Set the project path and start the hook
[BootstrapperHotkey]::SetProjectPath($ProjectPath)

if ([BootstrapperHotkey]::Start()) {
    Write-Host "[READY] Listening for Ctrl+Shift+J..." -ForegroundColor Green
    Write-Host ""

    try {
        # Run message pump (blocks until WM_QUIT)
        [MsgPump]::Run()
    } finally {
        [BootstrapperHotkey]::Stop()
        Write-Host "Hotkey listener stopped." -ForegroundColor Yellow
    }
} else {
    Write-Host "[ERROR] Failed to install keyboard hook!" -ForegroundColor Red
    exit 1
}
