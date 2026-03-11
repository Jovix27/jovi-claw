/**
 * Structured audit trail.
 *
 * Every security-relevant action is written to:
 *   - stdout (so it flows into whatever log aggregator is used)
 *   - the in-process audit buffer (last 1000 entries, for introspection)
 *
 * Each entry is a single-line JSON object — easy to ingest by Datadog,
 * Loki, CloudWatch, etc.
 */

import { maskSecrets } from "./secret-masker.js";

export type AuditAction =
    | "auth_blocked"          // unauthorized user blocked
    | "rate_limited"          // user hit rate limit
    | "input_rejected"        // input failed validation
    | "injection_attempt"     // prompt injection detected
    | "agent_loop_started"
    | "agent_loop_completed"
    | "tool_called"
    | "tool_failed"
    | "mcp_connected"
    | "mcp_disconnected"
    | "secret_in_log_blocked" // secret masker fired
    | "heartbeat_started"     // daily heartbeat initiated
    | "heartbeat_completed"   // heartbeat sent successfully
    | "heartbeat_failed"      // heartbeat failed
    | "command_blocked"       // dangerous remote command blocked
    | "command_executed"      // remote command executed
    | "remote_agent_connected"    // remote PC agent connected
    | "remote_agent_disconnected" // remote PC agent disconnected
    | "startup"
    | "shutdown";

export interface AuditEntry {
    ts: string;          // ISO-8601 timestamp
    action: AuditAction;
    userId?: number;
    detail?: Record<string, unknown>;
}

// ─── In-process ring buffer ─────────────────────────────
const BUFFER_SIZE = 1_000;
const buffer: AuditEntry[] = [];

function record(entry: AuditEntry): void {
    // Mask before writing — last safety net
    const safe: AuditEntry = {
        ...entry,
        detail: entry.detail
            ? JSON.parse(maskSecrets(JSON.stringify(entry.detail)))
            : undefined,
    };

    if (buffer.length >= BUFFER_SIZE) buffer.shift();
    buffer.push(safe);

    // Write as single-line JSON to stdout
    process.stdout.write(JSON.stringify({ audit: true, ...safe }) + "\n");
}

// ─── Public API ─────────────────────────────────────────

export const audit = {
    authBlocked(userId: number) {
        record({ ts: now(), action: "auth_blocked", userId });
    },

    rateLimited(userId: number, retryAfter?: number) {
        record({ ts: now(), action: "rate_limited", userId, detail: retryAfter ? { retryAfter } : undefined });
    },

    inputRejected(userId: number, reason: string) {
        record({ ts: now(), action: "input_rejected", userId, detail: { reason } });
    },

    injectionAttempt(userId: number) {
        record({ ts: now(), action: "injection_attempt", userId });
    },

    agentLoopStarted(userId: number) {
        record({ ts: now(), action: "agent_loop_started", userId });
    },

    agentLoopCompleted(userId: number, iterations: number) {
        record({ ts: now(), action: "agent_loop_completed", userId, detail: { iterations } });
    },

    toolCalled(userId: number, toolName: string) {
        record({ ts: now(), action: "tool_called", userId, detail: { tool: toolName } });
    },

    toolFailed(userId: number, toolName: string, error: string) {
        record({ ts: now(), action: "tool_failed", userId, detail: { tool: toolName, error } });
    },

    mcpConnected(serverName: string, toolCount: number) {
        record({ ts: now(), action: "mcp_connected", detail: { server: serverName, toolCount } });
    },

    startup() {
        record({ ts: now(), action: "startup" });
    },

    shutdown() {
        record({ ts: now(), action: "shutdown" });
    },

    heartbeatStarted(userId: number) {
        record({ ts: now(), action: "heartbeat_started", userId });
    },

    heartbeatCompleted(userId: number) {
        record({ ts: now(), action: "heartbeat_completed", userId });
    },

    heartbeatFailed(userId: number, error: string) {
        record({ ts: now(), action: "heartbeat_failed", userId, detail: { error } });
    },

    /** Returns a copy of the recent audit buffer for inspection. */
    recent(n = 100): AuditEntry[] {
        return buffer.slice(-n);
    },

    /** Generic record function for extended audit events */
    record(entry: Omit<AuditEntry, "ts"> & { ts?: string }) {
        record({ ts: entry.ts ?? now(), ...entry } as AuditEntry);
    },

    /** Log remote command execution */
    commandExecuted(userId: number, command: string, exitCode: number) {
        record({
            ts: now(),
            action: "command_executed",
            userId,
            detail: { command: command.slice(0, 100), exitCode }
        });
    },

    /** Log remote agent connection */
    remoteAgentConnected(ip: string) {
        record({ ts: now(), action: "remote_agent_connected", detail: { ip } });
    },

    /** Log remote agent disconnection */
    remoteAgentDisconnected(reason: string) {
        record({ ts: now(), action: "remote_agent_disconnected", detail: { reason } });
    },
};

function now(): string {
    return new Date().toISOString();
}
