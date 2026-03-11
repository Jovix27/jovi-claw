import { spawn, ChildProcess } from "node:child_process";
import { Bot } from "grammy";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import path from "node:path";
import fs from "node:fs";

let watcherProcess: ChildProcess | null = null;

/** Cooldown in ms to prevent rapid repeated triggers */
const COOLDOWN_MS = 2000;
let lastTriggerTime = 0;

/**
 * Resolves the absolute path to the WinKeyServer script/executable.
 * Tries the PowerShell script first (more reliable, no compilation needed),
 * then falls back to the compiled C# exe.
 */
function resolveServerPath(): { type: "ps1" | "exe"; path: string } {
    const projectRoot = process.cwd();

    // Strategy 1: PowerShell script (preferred — no compilation needed, uses LL keyboard hook)
    const ps1Path = path.resolve(projectRoot, "src", "utils", "WinKeyServer.ps1");
    if (fs.existsSync(ps1Path)) {
        return { type: "ps1", path: ps1Path };
    }

    // Strategy 2: Compiled C# executable
    const exePath = path.resolve(projectRoot, "src", "utils", "WinKeyServer.exe");
    if (fs.existsSync(exePath)) {
        return { type: "exe", path: exePath };
    }

    // Strategy 3: Resolve relative to this module
    const moduleDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
    const modulePsPath = path.join(moduleDir, "WinKeyServer.ps1");
    if (fs.existsSync(modulePsPath)) {
        return { type: "ps1", path: modulePsPath };
    }
    const moduleExePath = path.join(moduleDir, "WinKeyServer.exe");
    if (fs.existsSync(moduleExePath)) {
        return { type: "exe", path: moduleExePath };
    }

    throw new Error(
        `WinKeyServer not found. Searched:\n  ${ps1Path}\n  ${exePath}\n  ${modulePsPath}\n  ${moduleExePath}`
    );
}

/**
 * Initializes a background child process that triggers the bot when "Win + J" is pressed.
 * Uses either a PowerShell script (preferred) or compiled C# exe that implements a
 * low-level keyboard hook (WH_KEYBOARD_LL) via Win32 SetWindowsHookEx.
 */
export async function setupHotkey(bot: Bot): Promise<void> {
    logger.info("Initializing native Windows hotkey listener (Win+J)...");

    try {
        const server = resolveServerPath();
        logger.info(`Using ${server.type} server`, { path: server.path });

        // Spawn the appropriate process
        if (server.type === "ps1") {
            watcherProcess = spawn("powershell.exe", [
                "-ExecutionPolicy", "Bypass",
                "-NoProfile",
                "-File", server.path,
            ], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
        } else {
            watcherProcess = spawn(server.path, [], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
        }

        // Promise that resolves once the process reports READY (or times out)
        const readyPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("WinKeyServer did not report READY within 10 seconds"));
            }, 10000);

            const onData = (data: Buffer) => {
                const output = data.toString().trim();
                if (output.includes("READY")) {
                    clearTimeout(timeout);
                    resolve();
                } else if (output.startsWith("ERROR:")) {
                    clearTimeout(timeout);
                    reject(new Error(output));
                }
            };

            // Listen on stdout for the READY signal
            watcherProcess!.stdout!.on("data", onData);

            watcherProcess!.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            watcherProcess!.on("close", (code) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    reject(new Error(`WinKeyServer exited early with code ${code}`));
                }
            });
        });

        // Set up ongoing stdout handler for hotkey events
        watcherProcess.stdout!.on("data", (data) => {
            const lines = data.toString().trim().split(/\r?\n/);
            for (const line of lines) {
                const output = line.trim();
                if (output === "HOTKEY_TRIGGERED") {
                    const now = Date.now();
                    if (now - lastTriggerTime < COOLDOWN_MS) {
                        logger.debug("Win+J cooldown active, ignoring.");
                        continue;
                    }
                    lastTriggerTime = now;

                    logger.info("HotKey 'Win + J' detected! Activating bot...");

                    const targetUserId = config.security.allowedUserIds[0];
                    if (targetUserId) {
                        bot.api
                            .sendMessage(
                                targetUserId,
                                "🤖 **Jovi AI Activated via Hotkey!**\n\nI am listening. How can I help you? (You can reply with text or a voice message.)",
                                { parse_mode: "Markdown" }
                            )
                            .catch((err) => {
                                logger.error("Failed to send hotkey activation message.", {
                                    error: err instanceof Error ? err.message : String(err),
                                });
                            });
                    } else {
                        logger.warn("No allowed users configured to receive the hotkey activation message.");
                    }
                } else if (output === "READY") {
                    logger.debug("WinKeyServer reported READY.");
                } else if (output.startsWith("ERROR:")) {
                    logger.error("WinKeyServer error", { message: output });
                }
            }
        });

        watcherProcess.stderr!.on("data", (data) => {
            logger.error("WinKeyServer stderr", { error: data.toString().trim() });
        });

        watcherProcess.on("close", (code) => {
            logger.warn("WinKeyServer process exited.", { code });
            watcherProcess = null;
        });

        // Wait for the READY signal
        await readyPromise;
        logger.info("WinKeyServer started successfully — listening for Win+J.");

    } catch (error) {
        logger.error("Failed to initialize WinKeyServer hotkey listener.", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Stops the WinKeyServer process and cleans up resources.
 */
export function stopHotkey(): void {
    if (watcherProcess) {
        logger.info("Stopping WinKeyServer process...");
        watcherProcess.kill();
        watcherProcess = null;
    }
}
