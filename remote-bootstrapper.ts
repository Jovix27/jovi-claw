/**
 * ╦╔═╗╦  ╦╦  ╔═╗╦   Remote Bootstrapper v2
 * ║║ ║╚╗╔╝║  ╠═╣║   Passive Listener
 * ╚╝╚═╝ ╚╝ ╩  ╩ ╩╩   Bridges cloud bot → local machine
 *
 * Usage:  node --import tsx remote-bootstrapper.ts
 */

import "dotenv/config";
import WebSocket from "ws";
import { spawn, exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always use the directory where this script lives as the project root
const PROJECT_ROOT = __dirname;

const REMOTE_URL = process.env.REMOTE_CONTROL_URL;
const SECRET = process.env.REMOTE_CONTROL_SECRET;

if (!REMOTE_URL || !SECRET) {
    console.error("❌ Missing required env vars.");
    process.exit(1);
}

// Build URL with type parameter (no token in URL for security)
const url = new URL(REMOTE_URL);
url.searchParams.set("type", "bootstrapper");

let reconnectAttempt = 0;
let agentRunning = false;

function connect() {
    console.log(`📡 Connecting bootstrapper to ${url.origin}...`);
    // Use Authorization header instead of URL parameter for security
    const ws = new WebSocket(url.toString(), {
        headers: {
            "Authorization": `Bearer ${SECRET}`,
        },
    });

    ws.on("open", () => {
        console.log("✅ Bootstrapper ONLINE (Passive mode)");
        console.log(`   Project root: ${PROJECT_ROOT}`);
        reconnectAttempt = 0;
    });

    ws.on("message", (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "BOOTSTRAP_START") {
                if (agentRunning) {
                    console.log("⚠️ Agent already running, ignoring duplicate START signal.");
                    ws.send(JSON.stringify({ type: "BOOTSTRAP_STATUS", status: "already_running" }));
                    return;
                }

                console.log("🚀 Received START signal! Booting remote-agent...");
                agentRunning = true;

                // Use spawn with explicit cwd for reliable process creation
                const child = spawn("node", ["--import", "tsx", "remote-agent.ts"], {
                    cwd: PROJECT_ROOT,
                    stdio: "ignore",
                    detached: true,
                    shell: true,
                });

                child.unref();

                // Monitor if the child process exits (crash/stop)
                child.on("exit", (code) => {
                    console.log(`📴 Remote agent exited with code ${code}. Ready for re-launch.`);
                    agentRunning = false;
                });

                child.on("error", (err) => {
                    console.error("❌ Failed to start remote agent:", err.message);
                    agentRunning = false;
                });

                // Send status back to cloud relay
                ws.send(JSON.stringify({ type: "BOOTSTRAP_STATUS", status: "started" }));
                console.log("✅ Remote agent process spawned successfully.");
            }
        } catch (err) {
            console.error("Failed to parse message.");
        }
    });

    ws.on("close", () => {
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt++));
        console.log(`🔌 Connection lost. Retrying in ${delay / 1000}s...`);
        setTimeout(connect, delay);
    });

    ws.on("error", (err) => {
        console.error("WS Error:", err.message);
    });

    // Keepalive ping
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
        else clearInterval(pingInterval);
    }, 25000);
}

connect();

