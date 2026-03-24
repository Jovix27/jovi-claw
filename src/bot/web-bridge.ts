/**
 * Web Bridge — Dashboard ↔ Agent Loop integration layer.
 *
 * Exposes helpers to:
 *   - Broadcast agent progress events to all connected dashboard clients
 *   - Push screenshot/vision previews to the dashboard in real time
 *   - Signal computer-use mode activation
 *
 * The actual Socket.io server lives in remote-relay.ts.
 * This module holds a reference to the `io` instance and provides
 * typed broadcast helpers that the agent loop and tools can call.
 */

import type { Server as SocketIOServer } from "socket.io";
import { logger } from "../utils/logger.js";

// ─── Shared io reference (set by remote-relay.ts) ────────
let _io: SocketIOServer | null = null;

export function setWebBridgeIO(io: SocketIOServer): void {
    _io = io;
}

// ─── Broadcast helpers ───────────────────────────────────

/** Broadcast a tool progress event to all dashboard clients. */
export function broadcastProgress(event: { type: string; tool?: string; [key: string]: unknown }): void {
    if (!_io) return;
    _io.emit("progress", event);
}

/** Push a real-time status update (thinking / idle) to all clients. */
export function broadcastStatus(type: "thinking" | "idle"): void {
    if (!_io) return;
    _io.emit("status", { type });
}

/** Push a vision screenshot preview to the dashboard for live display. */
export function broadcastVisionPreview(imagePath: string, label: string): void {
    if (!_io) return;
    _io.emit("vision_preview", { imagePath, label, timestamp: Date.now() });
    logger.info(`📸 Vision preview broadcast: ${label}`);
}

/** Push an action log entry to the dashboard action feed. */
export function broadcastActionLog(action: string, detail: string): void {
    if (!_io) return;
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    _io.emit("action_log", { time, action, detail });
}

/** Push live system telemetry to the dashboard. */
export function broadcastTelemetry(data: {
    cpu?: string;
    ram?: string;
    disk?: string;
    temp?: string;
    agentConnected?: boolean;
}): void {
    if (!_io) return;
    _io.emit("telemetry", data);
}

/** Check if any dashboard clients are connected. */
export function isDashboardConnected(): boolean {
    if (!_io) return false;
    return _io.engine.clientsCount > 0;
}
