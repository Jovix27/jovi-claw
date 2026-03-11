# WinKeyServer.ps1 — Low-level keyboard hook for Win+J detection
# Outputs "READY" when initialized, "HOTKEY_TRIGGERED" when Win+J is pressed

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class KeyboardHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_J = 0x4A;

    private static IntPtr hookId = IntPtr.Zero;
    private static bool winKeyHeld = false;
    private static HookProc hookProc;

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

    public static void Start() {
        hookProc = new HookProc(HookCallback);
        IntPtr moduleHandle = GetModuleHandle(null);
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, moduleHandle, 0);
        
        if (hookId == IntPtr.Zero) {
            Console.WriteLine("ERROR: Failed to install keyboard hook");
            Console.Out.Flush();
            return;
        }

        Console.WriteLine("READY");
        Console.Out.Flush();
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
                if (vkCode == VK_LWIN || vkCode == VK_RWIN) {
                    winKeyHeld = true;
                } else if (vkCode == VK_J && winKeyHeld) {
                    Console.WriteLine("HOTKEY_TRIGGERED");
                    Console.Out.Flush();
                }
            } else if (msg == WM_KEYUP || msg == WM_SYSKEYUP) {
                if (vkCode == VK_LWIN || vkCode == VK_RWIN) {
                    winKeyHeld = false;
                }
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }
}
"@ -ReferencedAssemblies @()

# Install the hook
[KeyboardHook]::Start()

# Message pump — required to keep the LL keyboard hook alive
try {
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
    
    [MsgPump]::Run()
} finally {
    [KeyboardHook]::Stop()
}
