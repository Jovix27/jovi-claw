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
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
    type: "execute" | "screenshot" | "keyboard" | "mouse" | "camera";
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

process.on("SIGINT", () => {
    console.log("\n👋 Remote agent stopped.");
    process.exit(0);
});
