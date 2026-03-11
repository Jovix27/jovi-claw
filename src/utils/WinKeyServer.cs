using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace WinKeyServer
{
    class Program
    {
        // ─── Win32 Low-Level Keyboard Hook ──────────────────────
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        
        // Virtual key codes
        private const int VK_LWIN = 0x5B;
        private const int VK_RWIN = 0x5C;
        private const int VK_J = 0x4A;

        private static IntPtr hookId = IntPtr.Zero;
        private static bool winKeyDown = false;
        private static LowLevelKeyboardProc hookProc;

        // Delegate for the hook callback
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        static void Main(string[] args)
        {
            // Keep a reference to prevent GC
            hookProc = HookCallback;

            using (var curProcess = Process.GetCurrentProcess())
            using (var curModule = curProcess.MainModule)
            {
                hookId = SetWindowsHookEx(
                    WH_KEYBOARD_LL,
                    hookProc,
                    GetModuleHandle(curModule.ModuleName),
                    0
                );
            }

            if (hookId == IntPtr.Zero)
            {
                Console.WriteLine("ERROR: Could not install keyboard hook");
                Console.Out.Flush();
                return;
            }

            Console.WriteLine("READY");
            Console.Out.Flush();

            // Message pump — required to keep the hook alive
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookWindowsHookEx(hookId);
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = (int)wParam;
                if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                {
                    var hookStruct = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                    int vkCode = (int)hookStruct.vkCode;

                    // Track Win key state
                    if (vkCode == VK_LWIN || vkCode == VK_RWIN)
                    {
                        winKeyDown = true;
                    }
                    // Check for J while Win is held
                    else if (vkCode == VK_J && winKeyDown)
                    {
                        Console.WriteLine("HOTKEY_TRIGGERED");
                        Console.Out.Flush();
                    }
                }
                else // Key up
                {
                    var hookStruct = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                    int vkCode = (int)hookStruct.vkCode;
                    if (vkCode == VK_LWIN || vkCode == VK_RWIN)
                    {
                        winKeyDown = false;
                    }
                }
            }
            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }
    }
}
