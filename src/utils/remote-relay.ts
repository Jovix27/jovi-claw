import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import crypto from "node:crypto";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger.js";
import { audit } from "../security/audit-logger.js";
import { filterOutput } from "../security/output-filter.js";
import { setWebBridgeIO, broadcastActionLog } from "../bot/web-bridge.js";

// ─── Types ──────────────────────────────────────────────
interface PendingRequest {
    resolve: (result: RemoteResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export type RemoteCommandType =
    | "execute" | "screenshot" | "keyboard" | "mouse" | "camera"
    | "clipboard_get" | "clipboard_set"
    | "file_read" | "file_write" | "file_list"
    | "process_list" | "process_kill"
    | "notify" | "open" | "system_info"
    // Computer Use additions
    | "scroll" | "window_list" | "window_focus"
    | "browser_navigate" | "browser_screenshot"
    | "browser_click" | "browser_type" | "browser_scroll"
    | "browser_back" | "browser_eval";

interface RemoteRequest {
    type: RemoteCommandType;
    id: string;
    [key: string]: unknown;
}

interface RemoteResult {
    type: "result";
    id: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error?: string;
    imageData?: string; // base64 PNG
}

// ─── State ──────────────────────────────────────────────
let wss: WebSocketServer | null = null;
let io: SocketIOServer | null = null;
let httpServer: any | null = null;
let agentSocket: WebSocket | null = null;
let bootstrapperSocket: WebSocket | null = null;
const pending = new Map<string, PendingRequest>();
const DEFAULT_TIMEOUT_MS = 30_000;
let agentConnectedCallback: (() => Promise<void>) | null = null;

/**
 * Register a callback that fires whenever the remote agent (PC) connects.
 * Used by index.ts to auto-enable agent mode and notify Boss on Telegram.
 */
export function setAgentConnectedCallback(fn: () => Promise<void>): void {
    agentConnectedCallback = fn;
}

// ─── Public API ─────────────────────────────────────────

export function isRemoteAgentConnected(): boolean {
    return agentSocket !== null && agentSocket.readyState === WebSocket.OPEN;
}

export function isRemoteBootstrapperConnected(): boolean {
    return bootstrapperSocket !== null && bootstrapperSocket.readyState === WebSocket.OPEN;
}

/**
 * Sends a trigger signal to the bootstrapper to start the remote agent.
 */
export async function triggerBootstrapper(): Promise<boolean> {
    if (!isRemoteBootstrapperConnected()) {
        logger.warn("Attempted to trigger bootstrapper but it's not connected.");
        return false;
    }
    logger.info("🚀 Sending BOOTSTRAP_START trigger to remote machine...");
    bootstrapperSocket!.send(JSON.stringify({ type: "BOOTSTRAP_START" }));
    return true;
}

/**
 * Send any typed request to the remote agent and wait for the result.
 * For execute: { command, shell, cwd }
 * For screenshot: {} (no params)
 * For keyboard: { keys?, text? }
 * For mouse: { x, y, button? }
 * For camera: {} (no params)
 */
export function sendRemoteRequest(
    requestType: RemoteCommandType,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RemoteResult> {
    return new Promise((resolve, reject) => {
        if (!isRemoteAgentConnected()) {
            return reject(new Error(
                "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first."
            ));
        }

        const id = crypto.randomUUID();
        const payload: RemoteRequest = { type: requestType, id, ...params };

        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Remote command timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });

        agentSocket!.send(JSON.stringify(payload), (err) => {
            if (err) {
                clearTimeout(timer);
                pending.delete(id);
                reject(new Error(`Failed to send to remote agent: ${err.message}`));
            }
        });

        logger.info(`📡 Sent remote [${requestType}] [${id.slice(0, 8)}]`);
    });
}

/**
 * Convenience wrapper — send a shell command (backward-compatible).
 */
export function sendRemoteCommand(
    command: string,
    shell: "powershell" | "cmd" = "powershell",
    cwd?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RemoteResult> {
    return sendRemoteRequest("execute", { command, shell, cwd }, timeoutMs);
}

/**
 * Save base64 imageData from a remote result to a temp file.
 * Returns the file path, or null if no image data.
 */
export function saveImageFromResult(result: RemoteResult, prefix: string = "jovi_remote"): string | null {
    if (!result.imageData) return null;

    const tmpDir = os.tmpdir();
    const ext = prefix.includes("camera") ? ".jpg" : ".png";
    const filePath = path.join(tmpDir, `${prefix}_${Date.now()}${ext}`);

    try {
        const buf = Buffer.from(result.imageData, "base64");
        fs.writeFileSync(filePath, buf);
        logger.info(`💾 Saved remote image to ${filePath} (${Math.round(buf.length / 1024)}KB)`);
        return filePath;
    } catch (err) {
        logger.error("Failed to save remote image.", {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * Start the Unified Relay & Dashboard Server.
 */
export function startRelayServer(secret: string, port: number): void {
    if (httpServer) {
        logger.warn("Relay server already running.");
        return;
    }

    const app = express();
    app.use(express.json());

    // ─── Middleware: CORS ─────────────────────────────────
    app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));

    // ─── Middleware: Simple Bearer Auth (for REST) ────────
    const authMiddleware = (_req: any, res: any, next: any) => {
        const authHeader = _req.headers.authorization;
        const urlToken = _req.query.token as string;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : urlToken;

        if (token !== secret && secret !== "") {
            logger.warn(`🚫 Unauthorized API access attempt from ${_req.ip}`);
            return res.status(401).json({ error: "Unauthorized" });
        }
        next();
    };

    // ─── Image Proxy: Serve local images to Web App ────────
    const imageHandler = (req: any, res: any) => {
        const imagePath = req.query.path as string;
        if (!imagePath) return res.status(400).json({ error: "No path provided" });

        // Security check: Only allow paths within typical temp/project dirs
        if (!imagePath.includes("temp") && !imagePath.includes("Jovi Claw")) {
            return res.status(403).json({ error: "Access denied" });
        }

        res.sendFile(imagePath);
    };
    app.get("/api/image", authMiddleware, imageHandler);
    app.get("/api/proxy-image", authMiddleware, imageHandler); // Dashboard alias

    // ─── EXISTING: Remote Tool Relay (POST) ───────────────
    app.post("/relay", authMiddleware, async (req, res) => {
        try {
            const { tool, args, userId } = req.body;
            if (!tool) return res.status(400).json({ error: "Missing tool name" });

            const { executeTool } = await import("../tools/index.js");
            const result = await executeTool(tool, args || {}, userId || 0);

            res.json({ status: "ok", result });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── NEW: Dashboard API Status ────────────────────────
    app.get("/api/status", (_req, res) => {
        res.json({
            status: "online",
            agent_connected: isRemoteAgentConnected(),
            bootstrapper_connected: isRemoteBootstrapperConnected(),
            version: "1.0.0"
        });
    });

    // ─── NEW: History API ─────────────────────────────
    app.get("/api/history", authMiddleware, async (req, res) => {
        try {
            const { getHistoryThreads } = await import("./memory.js");
            // Default to the first allowed user ID if no specific user requested
            let userId = Number(req.query.userId);
            if (!userId && process.env.ALLOWED_USER_IDS) {
                userId = parseInt(process.env.ALLOWED_USER_IDS.split(",")[0], 10);
            }
            if (!userId) userId = 0;
            
            const threads = await getHistoryThreads(userId);
            res.json({ status: "ok", threads });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── NEW: Settings / Memory API ────────────────────────
    app.get("/api/settings", authMiddleware, async (req, res) => {
        try {
            const { getCoreMemory } = await import("./memory.js");
            let userId = Number(req.query.userId) || 0;
            if (userId === 0 && process.env.ALLOWED_USER_IDS) {
                userId = parseInt(process.env.ALLOWED_USER_IDS.split(",")[0], 10);
            }
            const memory = await getCoreMemory(userId);
            const customInstructions = memory.find((m: any) => m.fact_key === "custom_instructions")?.fact_value || "";
            res.json({ status: "ok", customInstructions });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post("/api/settings", authMiddleware, async (req, res) => {
        try {
            const { setCoreMemory } = await import("./memory.js");
            const { customInstructions } = req.body;
            let userId = Number(req.body.userId) || 0;
            if (userId === 0 && process.env.ALLOWED_USER_IDS) {
                userId = parseInt(process.env.ALLOWED_USER_IDS.split(",")[0], 10);
            }
            await setCoreMemory(userId, "custom_instructions", customInstructions || "");
            res.json({ status: "ok" });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get("/api/history/:threadId", authMiddleware, async (req, res) => {
        try {
            const { getRecentBuffer } = await import("./memory.js");
            let userId = Number(req.query.userId);
            if (!userId && process.env.ALLOWED_USER_IDS) {
                userId = parseInt(process.env.ALLOWED_USER_IDS.split(",")[0], 10);
            }
            if (!userId) userId = 0;
            
            const threadId = req.params.threadId;
            const messages = await getRecentBuffer(userId, 50, threadId); 
            // the web side will need it chronological, getRecentBuffer already does this
            res.json({ status: "ok", messages });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── NEW: Dashboard Chat API (Socket.io bridge) ───────
    // Handled via Socket.io below, but we can also add a REST endpoint
    app.post("/api/chat", authMiddleware, async (req, res) => {
        try {
            const { text, userId } = req.body;
            const { runAgentLoop } = await import("../agent/loop.js");
            const result = await runAgentLoop(text, userId || 0);
            const filtered = filterOutput(result.text, userId || 0);
            res.json({ ...result, text: filtered.filtered });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    httpServer = createServer(app);

    // ─── Socket.io (for Dashboard real-time events) ───────
    io = new SocketIOServer(httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });
    setWebBridgeIO(io);

    io.on("connection", (socket) => {
        // Authenticate Socket.io connection
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (token !== secret && secret !== "") {
            logger.warn("🚫 Unauthorized Dashboard Socket connection rejected.");
            socket.disconnect();
            return;
        }

        logger.info("✅ Jovi Dashboard connected!", { id: socket.id });

        socket.on("message", async (data: { text: string; userId?: number; threadId?: string; files?: any[] }) => {
            try {
                const { runAgentLoop } = await import("../agent/loop.js");
                socket.emit("status", { type: "thinking" });
                
                let userId = data.userId;
                if (!userId && process.env.ALLOWED_USER_IDS) {
                    userId = parseInt(process.env.ALLOWED_USER_IDS.split(",")[0], 10);
                }
                if (!userId) userId = 0;

                const result = await runAgentLoop(data.text, userId, 0, (event) => {
                    // Pipe tool results and vision updates to the Dashboard live
                    socket.emit("progress", event);
                }, data.threadId || "default", data.files);
                const filtered = filterOutput(result.text, userId);
                socket.emit("message", { ...result, text: filtered.filtered, role: "assistant" });
                socket.emit("status", { type: "idle" });
            } catch (err) {
                socket.emit("error", { message: "Agent loop failed" });
            }
        });
    });

    // ─── EXISTING: Remote PC Agent WebSocket (ws) ──────────
    wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (request: any, socket: any, head: any) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
        const pathname = url.pathname;

        // Route to WS if it's the agent connection
        if (pathname === "/" || pathname === "/ws") {
            wss!.handleUpgrade(request, socket, head, (ws) => {
                wss!.emit("connection", ws, request);
            });
        }
    });

    wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const clientIp = req.socket.remoteAddress ?? "unknown";

        const urlToken = url.searchParams.get("token");
        const authHeader = req.headers.authorization;
        const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const token = headerToken ?? urlToken;

        const type = url.searchParams.get("type") || "agent";

        if (token !== secret && secret !== "") {
            logger.warn(`🚫 Remote ${type} connection rejected — invalid token.`, { ip: clientIp });
            audit.record({ action: "auth_blocked", detail: { type, ip: clientIp, reason: "invalid_token" } });
            ws.close(4001, "Unauthorized");
            return;
        }

        if (type === "bootstrapper") {
            if (bootstrapperSocket && bootstrapperSocket.readyState === WebSocket.OPEN) {
                bootstrapperSocket.close(4002, "Replaced");
            }
            bootstrapperSocket = ws;
            logger.info("✅ Remote Bootstrapper connected!", { ip: clientIp });
        } else {
            if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
                agentSocket.close(4002, "Replaced by new connection");
            }
            agentSocket = ws;
            logger.info("✅ Remote PC agent connected!", { ip: clientIp });
            audit.remoteAgentConnected(clientIp);
            broadcastActionLog("Agent Connected", `PC agent online from ${clientIp}`);
            if (agentConnectedCallback) {
                agentConnectedCallback().catch((err) =>
                    logger.error("Agent-connected callback failed.", { error: err instanceof Error ? err.message : String(err) })
                );
            }
        }

        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString()) as RemoteResult;
                if (msg.type === "result" && msg.id) {
                    const req = pending.get(msg.id);
                    if (req) {
                        clearTimeout(req.timer);
                        pending.delete(msg.id);
                        req.resolve(msg);
                    }
                }
            } catch { }
        });

        ws.on("close", (code, reason) => {
            const reasonStr = reason.toString() || "unknown";
            logger.warn(`🔌 Remote ${type} disconnected. code=${code} reason=${reasonStr}`);
            if (ws === agentSocket) {
                agentSocket = null;
                audit.remoteAgentDisconnected(`code=${code} reason=${reasonStr}`);
            }
            if (ws === bootstrapperSocket) bootstrapperSocket = null;
        });

        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
            else clearInterval(pingInterval);
        }, 25_000);
        ws.on("close", () => clearInterval(pingInterval));
    });

    httpServer.listen(port, () => {
        logger.info(`📡 Unified Jovi Server (Relay + Dashboard) live on port ${port}`);
    });
}

/**
 * Gracefully shut down the relay server.
 */
export async function stopRelayServer(): Promise<void> {
    for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new Error("Relay server shutting down."));
        pending.delete(id);
    }

    if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
        agentSocket.close(1001, "Server shutting down");
    }
    if (bootstrapperSocket && bootstrapperSocket.readyState === WebSocket.OPEN) {
        bootstrapperSocket.close(1001, "Server shutting down");
    }

    if (wss) {
        wss.close();
        wss = null;
    }

    if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
        httpServer = null;
    }

    logger.info("Remote control relay server stopped.");
}

/**
 * Wait for the remote agent to connect (e.g. after triggering bootstrapper).
 * Resolves with true if agent connects within timeout, false otherwise.
 */
export function waitForAgentConnection(timeoutMs: number = 15_000): Promise<boolean> {
    return new Promise((resolve) => {
        // Already connected
        if (isRemoteAgentConnected()) {
            resolve(true);
            return;
        }

        const checkInterval = setInterval(() => {
            if (isRemoteAgentConnected()) {
                clearInterval(checkInterval);
                clearTimeout(timeout);
                resolve(true);
            }
        }, 500);

        const timeout = setTimeout(() => {
            clearInterval(checkInterval);
            resolve(false);
        }, timeoutMs);
    });
}
