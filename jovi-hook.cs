using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Management;
using System.Net;
using System.IO;

class JoviHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_J = 0x4A;
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;

    private static IntPtr _hookID = IntPtr.Zero;
    private static bool _winKeyHeld = false;
    private static LowLevelKeyboardProc _proc = HookCallback;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public static void Main() {
        _hookID = SetHook(_proc);
        Application.Run();
        UnhookWindowsHookEx(_hookID);
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc) {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vkCode = Marshal.ReadInt32(lParam);
            int msg = wParam.ToInt32();

            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                if (vkCode == VK_LWIN || vkCode == VK_RWIN) {
                    _winKeyHeld = true;
                }
                else if (vkCode == VK_J) {
                    if (_winKeyHeld) {
                        _winKeyHeld = false; // reset key hold
                        TriggerJovi();
                        return (IntPtr)1; // block event to prevent standard 'j' firing
                    }

                    bool ctrlPressed = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                    bool shiftPressed = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                    if (ctrlPressed && shiftPressed) {
                        TriggerBootstrapper();
                        return (IntPtr)1; // block event
                    }
                }
            }
            else if (msg == WM_KEYUP || msg == WM_SYSKEYUP) {
                if (vkCode == VK_LWIN || vkCode == VK_RWIN) {
                    _winKeyHeld = false;
                }
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    private static void TriggerJovi() {
        try {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            
            // Duplicate lock check
            using (var searcher = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")) {
                foreach (var obj in searcher.Get()) {
                    string cmd = (string)obj["CommandLine"];
                    if (cmd != null && cmd.Contains("src/index.ts")) {
                        return; // already running!
                    }
                }
            }

            // Extract env credentials securely
            string envPath = Path.Combine(appDir, ".env");
            string botToken = null;
            string targetChatId = null;

            if (File.Exists(envPath)) {
                foreach (string line in File.ReadAllLines(envPath)) {
                    if (line.StartsWith("TELEGRAM_BOT_TOKEN=")) botToken = line.Substring(19).Trim();
                    if (line.StartsWith("ALLOWED_USER_IDS=")) {
                        string users = line.Substring(17).Trim();
                        targetChatId = users.Split(',')[0].Trim();
                    }
                }
            }

            // Push native Telegram notification instantly
            if (!string.IsNullOrEmpty(botToken) && !string.IsNullOrEmpty(targetChatId)) {
                string url = string.Format("https://api.telegram.org/bot{0}/sendMessage", botToken);
                string json = "{\"chat_id\":\"" + targetChatId + "\", \"text\":\"🚀 **Win+J Perfect Trigger!**\\n\\nSystem securely unlocked and Dev Server started locally.\" , \"parse_mode\":\"Markdown\"}";

                using (var client = new WebClient()) {
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    try {
                        client.UploadString(url, "POST", json);
                    } catch { } // Silently drop network errors to prevent crashes
                }
            }

            // Boot node server via minimized command prompt
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = string.Format("/c start \"Jovi AI\" /MIN cmd.exe /c \"cd /d \"{0}\" && npm run dev\"", appDir);
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            Process.Start(psi);

        } catch { } // Global try-catch for silent invisible failure
    }

    private static void TriggerBootstrapper() {
        try {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            
            // Forcefully kill any existing invisible or stuck bootstrapper processes
            using (var searcher = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe' OR Name='cmd.exe'")) {
                foreach (var obj in searcher.Get()) {
                    string cmd = (string)obj["CommandLine"];
                    if (cmd != null && cmd.Contains("remote-bootstrapper")) {
                        try {
                            int pid = Convert.ToInt32(obj["ProcessId"]);
                            Process.GetProcessById(pid).Kill();
                        } catch { }
                    }
                }
            }

            // Bootstrapper via visible but minimized cmd
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = string.Format("/c start \"Jovi Bootstrapper\" /MIN cmd.exe /c \"cd /d \"{0}\" && npm run remote-bootstrapper\"", appDir);
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            Process.Start(psi);

        } catch { } // Global try-catch for silent invisible failure
    }
}
