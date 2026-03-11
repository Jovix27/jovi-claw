import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger.js";
import { audit } from "../security/audit-logger.js";

// ─── Types ──────────────────────────────────────────────
interface PendingRequest {
    resolve: (result: RemoteResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface RemoteRequest {
    type: "execute" | "screenshot" | "keyboard" | "mouse" | "camera";
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
let httpServer: http.Server | null = null;
let agentSocket: WebSocket | null = null;
let bootstrapperSocket: WebSocket | null = null;
const pending = new Map<string, PendingRequest>();
const DEFAULT_TIMEOUT_MS = 30_000;

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
    requestType: RemoteRequest["type"],
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
 * Start the WebSocket relay server.
 */
export function startRelayServer(secret: string, port: number): void {
    if (wss) {
        logger.warn("Relay server already running.");
        return;
    }

    httpServer = http.createServer(async (req, res) => {
        // Handle tool relay via POST
        if (req.method === "POST" && req.url === "/relay") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    if (data.secret !== secret && secret !== "") {
                        res.writeHead(401);
                        return res.end(JSON.stringify({ error: "Unauthorized" }));
                    }

                    const { tool, args, userId } = data;
                    if (!tool) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ error: "Missing tool name" }));
                    }

                    // Import tools dynamically to avoid circular deps if needed
                    const { executeTool } = await import("../tools/index.js");
                    const result = await executeTool(tool, args || {}, userId || 0);
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "ok", result }));
                } catch (e: any) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            agent_connected: isRemoteAgentConnected(),
        }));
    });

    wss = new WebSocketServer({ server: httpServer, maxPayload: 20 * 1024 * 1024 }); // 20MB for screenshots

    wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const clientIp = req.socket.remoteAddress ?? "unknown";

        // Support both URL token and Authorization header (header preferred for security)
        const urlToken = url.searchParams.get("token");
        const authHeader = req.headers.authorization;
        const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const token = headerToken ?? urlToken;

        const type = url.searchParams.get("type") || "agent"; // 'agent' or 'bootstrapper'

        if (token !== secret) {
            logger.warn(`🚫 Remote ${type} connection rejected — invalid token.`, { ip: clientIp });
            audit.record({ action: "auth_blocked", detail: { type, ip: clientIp, reason: "invalid_token" } });
            ws.close(4001, "Unauthorized");
            return;
        }

        if (type === "bootstrapper") {
            if (bootstrapperSocket && bootstrapperSocket.readyState === WebSocket.OPEN) {
                logger.warn("⚠️ Replacing existing bootstrapper connection.");
                bootstrapperSocket.close(4002, "Replaced");
            }
            bootstrapperSocket = ws;
            logger.info("✅ Remote Bootstrapper connected!", { ip: clientIp });
        } else {
            if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
                logger.warn("⚠️ Replacing existing remote agent connection.");
                agentSocket.close(4002, "Replaced by new connection");
            }
            agentSocket = ws;
            logger.info("✅ Remote PC agent connected!", { ip: clientIp });
            audit.remoteAgentConnected(clientIp);
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
                        const hasImg = msg.imageData ? " [+image]" : "";
                        logger.debug(`📥 Remote result [${msg.id.slice(0, 8)}] exitCode=${msg.exitCode}${hasImg}`);
                    }
                }
            } catch (err) {
                logger.warn("Failed to parse message from remote agent.", {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
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

        ws.on("error", (err) => {
            logger.error("Remote agent WebSocket error.", { error: err.message });
        });

        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
            else clearInterval(pingInterval);
        }, 25_000);

        ws.on("close", () => clearInterval(pingInterval));
    });

    httpServer.listen(port, () => {
        logger.info(`📡 Remote control relay server listening on port ${port}`);
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
