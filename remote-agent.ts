/**
 * ╦╔═╗╦  ╦╦  ╔═╗╦   Remote Agent v2
 * ║║ ║╚╗╔╝║  ╠═╣║   Runs on YOUR PC
 * ╚╝╚═╝ ╚╝ ╩  ╩ ╩╩   Bridges cloud bot ↔ local machine
 *
 * Usage:  npm run remote-agent
 *
 * Capabilities:
 *   - Shell command execution (powershell/cmd)
 *   - Screenshot capture
 *   - Keyboard input (SendKeys)
 *   - Mouse click at coordinates
 *   - Webcam photo capture (requires ffmpeg)
 *
 * Required env vars:
 *   REMOTE_CONTROL_URL     — wss://your-app.railway.app  (or ws://localhost:3001)
 *   REMOTE_CONTROL_SECRET  — shared secret token
 */

import "dotenv/config";
import WebSocket from "ws";
import { exec } from "node:child_process";

// ─── Config ─────────────────────────────────────────────
const REMOTE_URL = process.env.REMOTE_CONTROL_URL;
const SECRET = process.env.REMOTE_CONTROL_SECRET;

if (!REMOTE_URL || !SECRET) {
    console.error("❌ Missing required env vars: REMOTE_CONTROL_URL & REMOTE_CONTROL_SECRET");
    console.error("   Set them in .env or pass as environment variables.");
    process.exit(1);
}

// ─── Reconnection state ─────────────────────────────────
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

// ─── Types ──────────────────────────────────────────────
interface RemoteCommand {
    type: "execute" | "screenshot" | "keyboard" | "mouse" | "camera"
        | "clipboard_get" | "clipboard_set"
        | "file_read" | "file_write" | "file_list"
        | "process_list" | "process_kill"
        | "notify" | "open" | "system_info"
        // Computer Use additions
        | "scroll" | "window_list" | "window_focus"
        | "browser_navigate" | "browser_screenshot"
        | "browser_click" | "browser_type" | "browser_scroll"
        | "browser_back" | "browser_eval";
    id: string;
    // execute
    command?: string;
    shell?: "powershell" | "cmd";
    cwd?: string;
    // keyboard
    keys?: string;
    text?: string;
    // mouse
    x?: number;
    y?: number;
    button?: "left" | "right" | "double";
    // file ops
    path?: string;
    content_b64?: string;
    // process_kill
    name?: string;
    pid?: number;
    // notify
    title?: string;
    message?: string;
    // open / browser
    target?: string;
    url?: string;
    selector?: string;
    script?: string;
    // scroll
    direction?: "up" | "down";
    amount?: number;
    delta?: number;
    // window_focus
    window_title?: string;
}

interface RemoteResult {
    type: "result";
    id: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error?: string;
    imageData?: string; // base64 PNG for screenshots/camera
}

// ─── Logging helper ─────────────────────────────────────
const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] ${msg}`);
};

// ─── PowerShell Scripts ─────────────────────────────────

const SCREENSHOT_PS = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$bounds = [System.Drawing.Rectangle]::Empty
foreach ($s in $screens) { $bounds = [System.Drawing.Rectangle]::Union($bounds, $s.Bounds) }
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
$g.Dispose()
$tmpFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'jovi_screenshot.png')
$bmp.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$bytes = [System.IO.File]::ReadAllBytes($tmpFile)
[System.Convert]::ToBase64String($bytes)
`;

function getKeyboardPS(keys?: string, text?: string): string {
    if (text) {
        // Type literal text — escape special SendKeys characters
        const escaped = text
            .replace(/\+/g, "{+}")
            .replace(/\^/g, "{^}")
            .replace(/%/g, "{%}")
            .replace(/~/g, "{~}")
            .replace(/\(/g, "{(}")
            .replace(/\)/g, "{)}")
            .replace(/\{/g, "{{}")
            .replace(/\}/g, "{}}");
        return `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
Write-Output "Typed text successfully"
`;
    }
    // Send key combo (already in SendKeys format like {ENTER}, ^s, %{F4})
    return `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('${keys}')
Write-Output "Key combo sent successfully"
`;
}

function getMousePS(x: number, y: number, button: string = "left"): string {
    const clickCode = button === "right" ? `
[Win32]::mouse_event(0x0008, 0, 0, 0, 0)  # Right down
[Win32]::mouse_event(0x0010, 0, 0, 0, 0)  # Right up` : button === "double" ? `
[Win32]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
Start-Sleep -Milliseconds 50
[Win32]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up` : `
[Win32]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up`;

    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
[Win32]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 50
${clickCode}
Write-Output "Mouse clicked at (${x}, ${y}) with ${button} button"
`;
}

const CAMERA_PS = `
$ErrorActionPreference = 'Stop'
$tmpFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'jovi_camera.jpg')

# ─── Method 1: Try ffmpeg if available ───────────────────
$ffmpeg = $null
foreach ($p in @('ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe', "$env:USERPROFILE\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe")) {
    try { $null = Get-Command $p -ErrorAction Stop; $ffmpeg = $p; break } catch {}
}

if ($ffmpeg) {
    try {
        # Try common camera device names
        $deviceNames = @('Integrated Camera', 'USB Camera', 'HD Webcam', 'Webcam', 'USB Video Device', 'HP Wide Vision HD Camera', 'Lenovo EasyCamera')
        $captured = $false
        foreach ($devName in $deviceNames) {
            & $ffmpeg -f dshow -i video="$devName" -frames:v 1 -y $tmpFile 2>$null
            if (Test-Path $tmpFile) { $captured = $true; break }
        }
        if (-not $captured) {
            # Auto-detect: list devices and find first video device
            $devOutput = & $ffmpeg -list_devices true -f dshow -i dummy 2>&1 | Out-String
            $lines = $devOutput -split '\\n' | Where-Object { $_ -match '".*"' -and $_ -notmatch 'audio|Alternative' }
            foreach ($line in $lines) {
                if ($line -match '"([^"]+)"') {
                    $cam = $matches[1]
                    & $ffmpeg -f dshow -i video="$cam" -frames:v 1 -y $tmpFile 2>$null
                    if (Test-Path $tmpFile) { $captured = $true; break }
                }
            }
        }
        if ($captured -and (Test-Path $tmpFile)) {
            $bytes = [System.IO.File]::ReadAllBytes($tmpFile)
            [System.Convert]::ToBase64String($bytes)
            exit 0
        }
    } catch {}
}

# ─── Method 2: Open Camera app, wait, then screenshot ────
try {
    # Open Windows Camera app
    Start-Process "microsoft.windows.camera:" -ErrorAction Stop
    Start-Sleep -Seconds 3

    # Take a screenshot of whatever is on screen (Camera preview)
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $bounds = [System.Drawing.Rectangle]::Empty
    foreach ($s in $screens) { $bounds = [System.Drawing.Rectangle]::Union($bounds, $s.Bounds) }
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
    $g.Dispose()
    $bmp.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()

    # Close the Camera app
    Start-Sleep -Milliseconds 500
    Get-Process -Name 'WindowsCamera' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    if (Test-Path $tmpFile) {
        $bytes = [System.IO.File]::ReadAllBytes($tmpFile)
        [System.Convert]::ToBase64String($bytes)
    } else {
        "ERROR: Failed to capture camera screenshot"
    }
} catch {
    "ERROR: Camera capture failed: $($_.Exception.Message). Install ffmpeg (winget install ffmpeg) for best results."
}
`;

// ─── Command Handlers ───────────────────────────────────

async function handleExecute(msg: RemoteCommand): Promise<RemoteResult> {
    const shellExe = msg.shell === "cmd" ? "cmd.exe" : "powershell.exe";

    return new Promise((resolve) => {
        exec(
            msg.command!,
            {
                shell: shellExe,
                cwd: msg.cwd ?? undefined,
                timeout: 60_000,
                maxBuffer: 1024 * 1024,
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                resolve({
                    type: "result",
                    id: msg.id,
                    stdout: truncate(stdout?.toString() ?? "", 8000),
                    stderr: truncate(stderr?.toString() ?? "", 2000),
                    exitCode: error ? error.code ?? 1 : 0,
                });
            }
        );
    });
}

async function handleScreenshot(msg: RemoteCommand): Promise<RemoteResult> {
    return new Promise((resolve) => {
        exec(
            SCREENSHOT_PS,
            { shell: "powershell.exe", timeout: 15_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
                if (error || !stdout.trim()) {
                    resolve({
                        type: "result", id: msg.id,
                        stdout: "", stderr: stderr?.toString() ?? error?.message ?? "Screenshot failed",
                        exitCode: 1,
                    });
                } else {
                    resolve({
                        type: "result", id: msg.id,
                        stdout: "Screenshot captured successfully",
                        stderr: "", exitCode: 0,
                        imageData: stdout.trim(),
                    });
                }
            }
        );
    });
}

async function handleKeyboard(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = getKeyboardPS(msg.keys, msg.text);
    return new Promise((resolve) => {
        exec(
            ps,
            { shell: "powershell.exe", timeout: 10_000, windowsHide: true },
            (error, stdout, stderr) => {
                resolve({
                    type: "result", id: msg.id,
                    stdout: stdout?.toString() ?? "",
                    stderr: stderr?.toString() ?? "",
                    exitCode: error ? 1 : 0,
                });
            }
        );
    });
}

async function handleMouse(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = getMousePS(msg.x ?? 0, msg.y ?? 0, msg.button ?? "left");
    return new Promise((resolve) => {
        exec(
            ps,
            { shell: "powershell.exe", timeout: 10_000, windowsHide: true },
            (error, stdout, stderr) => {
                resolve({
                    type: "result", id: msg.id,
                    stdout: stdout?.toString() ?? "",
                    stderr: stderr?.toString() ?? "",
                    exitCode: error ? 1 : 0,
                });
            }
        );
    });
}

async function handleCamera(msg: RemoteCommand): Promise<RemoteResult> {
    return new Promise((resolve) => {
        exec(
            CAMERA_PS,
            { shell: "powershell.exe", timeout: 30_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
                const output = stdout?.toString().trim() ?? "";
                if (error || output.startsWith("ERROR:")) {
                    resolve({
                        type: "result", id: msg.id,
                        stdout: output, stderr: stderr?.toString() ?? "",
                        exitCode: 1, error: output.startsWith("ERROR:") ? output : error?.message,
                    });
                } else {
                    resolve({
                        type: "result", id: msg.id,
                        stdout: "Photo captured successfully",
                        stderr: "", exitCode: 0,
                        imageData: output,
                    });
                }
            }
        );
    });
}

// ─── New handlers ───────────────────────────────────────

async function handleClipboardGet(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 10_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleClipboardSet(msg: RemoteCommand): Promise<RemoteResult> {
    const escaped = (msg.text ?? "").replace(/'/g, "''");
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText('${escaped}'); Write-Output "Clipboard updated"`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 10_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleFileRead(msg: RemoteCommand): Promise<RemoteResult> {
    const p = (msg.path ?? "").replace(/'/g, "''");
    const ps = `Get-Content -Path '${p}' -Raw -Encoding UTF8`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: truncate(stdout?.toString() ?? "", 50_000), stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleFileWrite(msg: RemoteCommand): Promise<RemoteResult> {
    const p = (msg.path ?? "").replace(/'/g, "''");
    const b64 = msg.content_b64 ?? "";
    const ps = `
$bytes = [System.Convert]::FromBase64String('${b64}')
$content = [System.Text.Encoding]::UTF8.GetString($bytes)
$dir = Split-Path '${p}' -Parent
if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
Set-Content -Path '${p}' -Value $content -Encoding UTF8
Write-Output "Written: ${p}"
`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 15_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleFileList(msg: RemoteCommand): Promise<RemoteResult> {
    const p = (msg.path ?? "").replace(/'/g, "''");
    const ps = `Get-ChildItem -Path '${p}' | Select-Object Name, @{N='Size';E={if($_.PSIsContainer){'<DIR>'}else{$_.Length}}}, LastWriteTime, @{N='Type';E={if($_.PSIsContainer){'Directory'}else{'File'}}} | ConvertTo-Json -Depth 2`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleProcessList(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = `Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}}, @{N='Responding';E={$_.Responding}} | ConvertTo-Json -Depth 2`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleProcessKill(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = msg.pid
        ? `Stop-Process -Id ${msg.pid} -Force -ErrorAction SilentlyContinue; Write-Output "PID ${msg.pid} terminated"`
        : `Stop-Process -Name '${(msg.name ?? "").replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue; Write-Output "Process '${msg.name}' terminated"`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 10_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleNotify(msg: RemoteCommand): Promise<RemoteResult> {
    const title = (msg.title ?? "Jovi").replace(/'/g, "''");
    const message = (msg.message ?? "").replace(/'/g, "''");
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = '${title}'
$n.BalloonTipText = '${message}'
$n.Visible = $true
$n.ShowBalloonTip(5000)
Start-Sleep -Seconds 2
$n.Dispose()
Write-Output "Notification sent"
`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 15_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleOpen(msg: RemoteCommand): Promise<RemoteResult> {
    const target = (msg.target ?? "").replace(/'/g, "''");
    const ps = `Start-Process '${target}'; Write-Output "Opened: ${target}"`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 10_000 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

async function handleSystemInfo(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = `
$cpu = Get-WmiObject Win32_Processor | Select-Object -First 1 Name, LoadPercentage
$os = Get-WmiObject Win32_OperatingSystem
$ramTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$ramFreeGB  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$ramUsedGB  = [math]::Round($ramTotalGB - $ramFreeGB, 1)
$disk = Get-PSDrive C
$bat = Get-WmiObject Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus
$uptime = (Get-Date) - $os.ConvertToDateTime($os.LastBootUpTime)
@{
    cpu     = @{ name = $cpu.Name; load_pct = $cpu.LoadPercentage }
    ram     = @{ total_gb = $ramTotalGB; used_gb = $ramUsedGB; free_gb = $ramFreeGB }
    disk_c  = @{ used_gb = [math]::Round($disk.Used/1GB,1); free_gb = [math]::Round($disk.Free/1GB,1) }
    battery = if ($bat) { @{ charge_pct = $bat.EstimatedChargeRemaining; status = $bat.BatteryStatus } } else { $null }
    uptime  = "$([math]::Floor($uptime.TotalHours))h $($uptime.Minutes)m"
    host    = $env:COMPUTERNAME
    user    = $env:USERNAME
} | ConvertTo-Json -Depth 3
`;
    return new Promise((resolve) => {
        exec(ps, { shell: "powershell.exe", timeout: 20_000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            resolve({ type: "result", id: msg.id, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: error ? 1 : 0 });
        });
    });
}

// ─── Connect ────────────────────────────────────────────
function connect(): void {
    // Use Authorization header instead of URL parameter for security
    // (prevents token from appearing in logs and browser history)
    const ws = new WebSocket(REMOTE_URL!, {
        headers: {
            "Authorization": `Bearer ${SECRET}`,
        },
    });

    ws.on("open", () => {
        reconnectAttempt = 0;
        log("✅ Connected to Jovi bot relay server!");
        log(`   URL: ${REMOTE_URL}`);
        log("   Capabilities: execute | screenshot | keyboard | mouse | camera");
        log("   Waiting for commands...");
    });

    ws.on("message", async (data) => {
        let msg: RemoteCommand;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            log("⚠️ Received invalid JSON from server.");
            return;
        }

        log(`📥 [${msg.type}] [${msg.id.slice(0, 8)}]: ${JSON.stringify(msg).slice(0, 120)}`);

        let result: RemoteResult;
        try {
            switch (msg.type) {
                case "execute":
                    result = await handleExecute(msg);
                    break;
                case "screenshot":
                    result = await handleScreenshot(msg);
                    break;
                case "keyboard":
                    result = await handleKeyboard(msg);
                    break;
                case "mouse":
                    result = await handleMouse(msg);
                    break;
                case "camera":
                    result = await handleCamera(msg);
                    break;
                case "clipboard_get":
                    result = await handleClipboardGet(msg);
                    break;
                case "clipboard_set":
                    result = await handleClipboardSet(msg);
                    break;
                case "file_read":
                    result = await handleFileRead(msg);
                    break;
                case "file_write":
                    result = await handleFileWrite(msg);
                    break;
                case "file_list":
                    result = await handleFileList(msg);
                    break;
                case "process_list":
                    result = await handleProcessList(msg);
                    break;
                case "process_kill":
                    result = await handleProcessKill(msg);
                    break;
                case "notify":
                    result = await handleNotify(msg);
                    break;
                case "open":
                    result = await handleOpen(msg);
                    break;
                case "system_info":
                    result = await handleSystemInfo(msg);
                    break;
                // ── Computer Use ──────────────────────────
                case "scroll":
                    result = await handleScroll(msg);
                    break;
                case "window_list":
                    result = await handleWindowList(msg);
                    break;
                case "window_focus":
                    result = await handleWindowFocus(msg);
                    break;
                case "browser_navigate":
                    result = await handleBrowserNavigate(msg);
                    break;
                case "browser_screenshot":
                    result = await handleBrowserScreenshot(msg);
                    break;
                case "browser_click":
                    result = await handleBrowserClick(msg);
                    break;
                case "browser_type":
                    result = await handleBrowserType(msg);
                    break;
                case "browser_scroll":
                    result = await handleBrowserScroll(msg);
                    break;
                case "browser_back":
                    result = await handleBrowserBack(msg);
                    break;
                case "browser_eval":
                    result = await handleBrowserEval(msg);
                    break;
                default:
                    result = {
                        type: "result", id: msg.id,
                        stdout: "", stderr: `Unknown command type: ${msg.type}`,
                        exitCode: 1,
                    };
            }
        } catch (err: any) {
            result = {
                type: "result", id: msg.id,
                stdout: "", stderr: "",
                exitCode: 1, error: err.message ?? String(err),
            };
        }

        ws.send(JSON.stringify(result));
        const hasImage = result.imageData ? ` [image: ${Math.round((result.imageData?.length ?? 0) / 1024)}KB]` : "";
        log(`📤 Result [${msg.id.slice(0, 8)}] exitCode=${result.exitCode}${hasImage}`);
    });

    ws.on("close", (code, reason) => {
        log(`🔌 Disconnected from relay. code=${code} reason=${reason.toString()}`);
        scheduleReconnect();
    });

    ws.on("error", (err) => {
        log(`❌ WebSocket error: ${err.message}`);
    });

    ws.on("ping", () => ws.pong());
}

// ─── Playwright Browser Singleton ───────────────────────
// Dynamic import so Railway never loads the Playwright binary
// (remote-agent.ts only runs on Boss's PC)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _page: any = null;

async function getBrowserPage(): Promise<any> {
    // Dynamic import — deferred until first use on PC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = await import("playwright") as any;
    if (!_browser || !_browser.isConnected()) {
        _browser = await chromium.launch({ headless: false });
    }
    if (!_page || _page.isClosed()) {
        _page = await _browser.newPage();
        await _page.setViewportSize({ width: 1280, height: 800 });
    }
    return _page;
}

// ─── New Computer-Use Handlers ───────────────────────────

async function handleScroll(msg: RemoteCommand): Promise<RemoteResult> {
    const { x = 0, y = 0, direction = "down", amount = 3 } = msg;
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JoviWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
[JoviWin32]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
$delta = ${direction === "down" ? -1 : 1} * ${amount} * 120
[JoviWin32]::mouse_event(0x0800, 0, 0, [uint]$delta, 0)
Write-Output "Scrolled ${direction} ${amount} notches at (${x}, ${y})"
`;
    return runPS(msg.id, ps);
}

async function handleWindowList(msg: RemoteCommand): Promise<RemoteResult> {
    const ps = `
Get-Process | Where-Object { $_.MainWindowTitle -ne "" } |
    Select-Object @{N="Name";E={$_.Name}}, @{N="PID";E={$_.Id}}, @{N="Title";E={$_.MainWindowTitle}} |
    ConvertTo-Json -Compress
`;
    return runPS(msg.id, ps);
}

async function handleWindowFocus(msg: RemoteCommand): Promise<RemoteResult> {
    const title = msg.window_title ?? "";
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JoviWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${title}*" } | Select-Object -First 1
if ($proc) {
    [JoviWindow]::ShowWindow($proc.MainWindowHandle, 9)
    [JoviWindow]::SetForegroundWindow($proc.MainWindowHandle)
    Write-Output "Focused: $($proc.MainWindowTitle)"
} else {
    Write-Output "Window not found: ${title}"
}
`;
    return runPS(msg.id, ps);
}

async function handleBrowserNavigate(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        const response = await page.goto(msg.url ?? "about:blank", {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
        });
        const title = await page.title();
        return ok(msg.id, `Navigated to: ${msg.url}\nTitle: ${title}\nStatus: ${response?.status() ?? "unknown"}`);
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserScreenshot(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        const buf = await page.screenshot({ type: "png", fullPage: false });
        return { type: "result", id: msg.id, stdout: "Browser screenshot taken", stderr: "", exitCode: 0, imageData: buf.toString("base64") };
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserClick(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        if (msg.selector) {
            await page.click(msg.selector, { timeout: 10_000 });
            return ok(msg.id, `Clicked selector: ${msg.selector}`);
        } else {
            await page.mouse.click(msg.x ?? 0, msg.y ?? 0);
            return ok(msg.id, `Clicked at (${msg.x}, ${msg.y})`);
        }
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserType(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        const text = msg.text ?? "";
        if (msg.selector) {
            await page.fill(msg.selector, text);
        } else {
            await page.keyboard.type(text, { delay: 40 });
        }
        return ok(msg.id, `Typed: "${text.slice(0, 60)}"`);
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserScroll(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        const deltaY = (msg.direction === "up" ? -1 : 1) * (msg.delta ?? 300);
        await page.mouse.wheel(0, deltaY);
        return ok(msg.id, `Scrolled browser ${msg.direction ?? "down"} by ${Math.abs(deltaY)}px`);
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserBack(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        await page.goBack({ timeout: 10_000 });
        return ok(msg.id, `Navigated back. Current URL: ${page.url()}`);
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

async function handleBrowserEval(msg: RemoteCommand): Promise<RemoteResult> {
    try {
        const page = await getBrowserPage();
        const result = await page.evaluate(msg.script ?? "null");
        return ok(msg.id, JSON.stringify(result));
    } catch (err: any) {
        return fail(msg.id, err.message);
    }
}

// ─── Small result helpers ────────────────────────────────
function ok(id: string, stdout: string): RemoteResult {
    return { type: "result", id, stdout, stderr: "", exitCode: 0 };
}
function fail(id: string, stderr: string): RemoteResult {
    return { type: "result", id, stdout: "", stderr, exitCode: 1 };
}
function runPS(id: string, script: string): Promise<RemoteResult> {
    return new Promise((resolve) => {
        const escaped = script.replace(/"/g, '\\"');
        exec(`powershell -NoProfile -NonInteractive -Command "${escaped}"`,
            { timeout: 15_000 },
            (err, stdout, stderr) => {
                resolve({ type: "result", id, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: err?.code ?? 0 });
            }
        );
    });
}

// ─── Reconnect with exponential backoff ─────────────────
function scheduleReconnect(): void {
    const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY_MS
    );
    reconnectAttempt++;
    log(`🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempt})...`);
    setTimeout(connect, delay);
}

// ─── Helpers ────────────────────────────────────────────
function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max) + `\n... [truncated, ${str.length - max} more bytes]`;
}

// ─── Start ──────────────────────────────────────────────
console.log(`
╦╔═╗╦  ╦╦  ╔═╗╦   Remote Agent v2
║║ ║╚╗╔╝║  ╠═╣║   Running on your PC
╚╝╚═╝ ╚╝ ╩  ╩ ╩╩   Connecting to cloud bot...
`);

connect();

process.on("SIGINT", async () => {
    console.log("\n👋 Remote agent stopped.");
    if (_browser) { try { await _browser.close(); } catch { /* ignore */ } }
    process.exit(0);
});
