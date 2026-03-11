/**
 * Tool Execution Metrics — Track tool usage, performance, and errors
 *
 * Provides insights into:
 * - Which tools are most used
 * - Success/failure rates
 * - Average latency per tool
 * - Recent errors for debugging
 */

import { logger } from "./logger.js";

// ─── Types ──────────────────────────────────────────────
interface ToolMetric {
    name: string;
    totalCalls: number;
    successCount: number;
    failureCount: number;
    totalLatencyMs: number;
    lastUsed: Date;
    lastError?: {
        message: string;
        timestamp: Date;
    };
}

interface MetricsSummary {
    totalToolCalls: number;
    successRate: string;
    topTools: Array<{ name: string; calls: number; successRate: string; avgLatencyMs: number }>;
    recentErrors: Array<{ tool: string; error: string; when: string }>;
}

// ─── State ──────────────────────────────────────────────
const metrics = new Map<string, ToolMetric>();
const recentErrors: Array<{ tool: string; error: string; timestamp: Date }> = [];
const MAX_RECENT_ERRORS = 20;

// ─── Public API ─────────────────────────────────────────

/**
 * Record the start of a tool execution (returns a function to call on completion)
 */
export function startToolExecution(toolName: string): () => void {
    const startTime = Date.now();

    return () => {
        const latency = Date.now() - startTime;
        recordSuccess(toolName, latency);
    };
}

/**
 * Record a successful tool execution
 */
export function recordSuccess(toolName: string, latencyMs: number): void {
    const metric = getOrCreateMetric(toolName);
    metric.totalCalls++;
    metric.successCount++;
    metric.totalLatencyMs += latencyMs;
    metric.lastUsed = new Date();

    logger.debug("Tool execution success", {
        tool: toolName,
        latencyMs,
        totalCalls: metric.totalCalls,
    });
}

/**
 * Record a failed tool execution
 */
export function recordFailure(toolName: string, error: string, latencyMs?: number): void {
    const metric = getOrCreateMetric(toolName);
    metric.totalCalls++;
    metric.failureCount++;
    if (latencyMs) metric.totalLatencyMs += latencyMs;
    metric.lastUsed = new Date();
    metric.lastError = {
        message: error.slice(0, 200),
        timestamp: new Date(),
    };

    // Track recent errors
    recentErrors.push({
        tool: toolName,
        error: error.slice(0, 200),
        timestamp: new Date(),
    });
    if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.shift();
    }

    logger.debug("Tool execution failed", {
        tool: toolName,
        error: error.slice(0, 100),
    });
}

/**
 * Get metrics for a specific tool
 */
export function getToolMetric(toolName: string): ToolMetric | undefined {
    return metrics.get(toolName);
}

/**
 * Get a summary of all tool metrics
 */
export function getMetricsSummary(): MetricsSummary {
    let totalCalls = 0;
    let totalSuccess = 0;

    const toolStats: Array<{ name: string; calls: number; successRate: string; avgLatencyMs: number }> = [];

    for (const [name, metric] of metrics) {
        totalCalls += metric.totalCalls;
        totalSuccess += metric.successCount;

        const successRate = metric.totalCalls > 0
            ? ((metric.successCount / metric.totalCalls) * 100).toFixed(1) + "%"
            : "N/A";

        const avgLatency = metric.totalCalls > 0
            ? Math.round(metric.totalLatencyMs / metric.totalCalls)
            : 0;

        toolStats.push({
            name,
            calls: metric.totalCalls,
            successRate,
            avgLatencyMs: avgLatency,
        });
    }

    // Sort by total calls descending
    toolStats.sort((a, b) => b.calls - a.calls);

    const overallSuccessRate = totalCalls > 0
        ? ((totalSuccess / totalCalls) * 100).toFixed(1) + "%"
        : "N/A";

    return {
        totalToolCalls: totalCalls,
        successRate: overallSuccessRate,
        topTools: toolStats.slice(0, 10),
        recentErrors: recentErrors.slice(-5).map(e => ({
            tool: e.tool,
            error: e.error,
            when: getRelativeTime(e.timestamp),
        })).reverse(),
    };
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
    metrics.clear();
    recentErrors.length = 0;
}

/**
 * Format metrics as a human-readable string
 */
export function formatMetricsReport(): string {
    const summary = getMetricsSummary();

    let report = "📊 **Tool Execution Metrics**\n\n";
    report += `Total Calls: ${summary.totalToolCalls}\n`;
    report += `Overall Success Rate: ${summary.successRate}\n\n`;

    if (summary.topTools.length > 0) {
        report += "**Top Tools:**\n";
        for (const tool of summary.topTools) {
            report += `  • ${tool.name}: ${tool.calls} calls, ${tool.successRate} success, ${tool.avgLatencyMs}ms avg\n`;
        }
    }

    if (summary.recentErrors.length > 0) {
        report += "\n**Recent Errors:**\n";
        for (const err of summary.recentErrors) {
            report += `  • [${err.when}] ${err.tool}: ${err.error}\n`;
        }
    }

    return report;
}

// ─── Helpers ────────────────────────────────────────────

function getOrCreateMetric(toolName: string): ToolMetric {
    let metric = metrics.get(toolName);
    if (!metric) {
        metric = {
            name: toolName,
            totalCalls: 0,
            successCount: 0,
            failureCount: 0,
            totalLatencyMs: 0,
            lastUsed: new Date(),
        };
        metrics.set(toolName, metric);
    }
    return metric;
}

function getRelativeTime(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
