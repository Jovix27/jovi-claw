/**
 * Command Validator — Security layer for remote PC command execution
 *
 * Implements:
 * - Command whitelisting for safe operations
 * - Dangerous pattern detection
 * - Shell metacharacter filtering
 * - Rate limiting per command type
 */

import { logger } from "../utils/logger.js";
import { audit } from "./audit-logger.js";

// ─── Safe Command Whitelist ─────────────────────────────────
// Commands that can be executed without additional validation
const SAFE_COMMANDS = new Set([
    // Windows Apps
    "calc", "calc.exe",
    "notepad", "notepad.exe",
    "mspaint", "mspaint.exe",
    "explorer", "explorer.exe",
    "taskmgr", "taskmgr.exe",
    "control", "control.exe",
    "msconfig", "msconfig.exe",
    "devmgmt.msc",
    "diskmgmt.msc",
    "compmgmt.msc",
    "services.msc",

    // Safe PowerShell commands (read-only)
    "Get-Date",
    "Get-Process",
    "Get-Service",
    "Get-ComputerInfo",
    "Get-Volume",
    "Get-Disk",
    "Get-NetAdapter",
    "Get-NetIPAddress",
    "Get-WmiObject Win32_OperatingSystem",
    "systeminfo",
    "hostname",
    "whoami",
    "ipconfig",
    "ipconfig /all",

    // Safe cmd commands
    "dir",
    "date /t",
    "time /t",
    "ver",
    "vol",
]);

// ─── Dangerous Patterns ─────────────────────────────────────
// Commands/patterns that should NEVER be allowed
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    // File system destruction
    { pattern: /\brm\s+-rf\b/i, reason: "Recursive delete" },
    { pattern: /\brmdir\s+\/s\b/i, reason: "Directory removal" },
    { pattern: /\bdel\s+\/[sfq]/i, reason: "Forced file deletion" },
    { pattern: /\bformat\s+[a-z]:/i, reason: "Disk formatting" },
    { pattern: /\brd\s+\/s/i, reason: "Directory removal" },

    // System destruction
    { pattern: /System32/i, reason: "System32 access" },
    { pattern: /\bshutdown\b/i, reason: "System shutdown" },
    { pattern: /\brestart-computer\b/i, reason: "System restart" },
    { pattern: /\bstop-computer\b/i, reason: "System shutdown" },

    // Registry manipulation
    { pattern: /\breg\s+(add|delete|import)/i, reason: "Registry modification" },
    { pattern: /\bRegedit\b/i, reason: "Registry editor" },
    { pattern: /\bRemove-ItemProperty\b.*Registry/i, reason: "Registry deletion" },

    // User/permission escalation
    { pattern: /\bnet\s+user\b/i, reason: "User management" },
    { pattern: /\bnet\s+localgroup\b/i, reason: "Group management" },
    { pattern: /\bAdd-LocalGroupMember\b/i, reason: "Adding users to groups" },
    { pattern: /\bNew-LocalUser\b/i, reason: "Creating users" },
    { pattern: /\brunas\b/i, reason: "Privilege escalation" },

    // Network attacks
    { pattern: /\bInvoke-WebRequest\b.*(-OutFile|-o)/i, reason: "File download" },
    { pattern: /\bcurl\b.*(-o|-O)/i, reason: "File download" },
    { pattern: /\bwget\b/i, reason: "File download" },
    { pattern: /\bIEX\b.*\(.*Invoke-WebRequest/i, reason: "Remote code execution" },
    { pattern: /\bDownloadString\b/i, reason: "Remote code download" },
    { pattern: /\bDownloadFile\b/i, reason: "Remote file download" },

    // Credential theft
    { pattern: /\bmimikatz\b/i, reason: "Credential theft tool" },
    { pattern: /\bsekurlsa\b/i, reason: "Credential extraction" },
    { pattern: /\bGet-Credential\b/i, reason: "Credential harvesting" },
    { pattern: /\bConvertTo-SecureString\b/i, reason: "Credential manipulation" },

    // Code execution from web
    { pattern: /\bpowershell\b.*-enc/i, reason: "Encoded command execution" },
    { pattern: /\bpowershell\b.*-e\s+[A-Za-z0-9+\/=]/i, reason: "Base64 encoded command" },
    { pattern: /\biex\s*\(/i, reason: "Invoke-Expression" },
    { pattern: /\bInvoke-Expression\b/i, reason: "Dynamic code execution" },

    // Firewall/security bypass
    { pattern: /\bnetsh\s+firewall\b/i, reason: "Firewall manipulation" },
    { pattern: /\bnetsh\s+advfirewall\b/i, reason: "Firewall manipulation" },
    { pattern: /\bSet-MpPreference\b/i, reason: "Windows Defender manipulation" },
    { pattern: /\bDisable-WindowsOptionalFeature\b/i, reason: "Security feature disable" },

    // Process injection/manipulation
    { pattern: /\bStart-Process\b.*-Verb\s+RunAs/i, reason: "Privilege escalation" },
    { pattern: /\bInject\b/i, reason: "Process injection" },

    // Crypto mining
    { pattern: /\bxmrig\b/i, reason: "Crypto miner" },
    { pattern: /\bstratum\+tcp\b/i, reason: "Mining pool connection" },

    // Shell escape sequences (command chaining)
    { pattern: /;\s*rm\b/i, reason: "Command chaining with rm" },
    { pattern: /\|\s*rm\b/i, reason: "Pipe to rm" },
    { pattern: /`[^`]*`/i, reason: "Backtick command substitution" },
    { pattern: /\$\([^)]*\)/i, reason: "Command substitution" },
];

// ─── Suspicious Patterns (Warning, not blocked) ─────────────
const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bStart-Process\b/i, reason: "Process spawning" },
    { pattern: /\bSet-ExecutionPolicy\b/i, reason: "Execution policy change" },
    { pattern: /\bGet-Content\b.*password/i, reason: "Password file access" },
    { pattern: /\bGet-ChildItem\b.*-Recurse/i, reason: "Recursive file listing" },
    { pattern: /\bCopy-Item\b/i, reason: "File copying" },
    { pattern: /\bMove-Item\b/i, reason: "File moving" },
    { pattern: /\bRemove-Item\b/i, reason: "File deletion" },
];

// ─── Rate Limiting ──────────────────────────────────────────
interface CommandRateLimit {
    timestamps: number[];
}

const commandRateLimits = new Map<string, CommandRateLimit>();
const COMMAND_RATE_WINDOW_MS = 60_000; // 1 minute
const MAX_COMMANDS_PER_MINUTE = 10;

function checkCommandRateLimit(userId: number): boolean {
    const key = `cmd_${userId}`;
    const now = Date.now();
    const limit = commandRateLimits.get(key) ?? { timestamps: [] };

    // Remove timestamps outside window
    limit.timestamps = limit.timestamps.filter(ts => now - ts < COMMAND_RATE_WINDOW_MS);

    if (limit.timestamps.length >= MAX_COMMANDS_PER_MINUTE) {
        return false;
    }

    limit.timestamps.push(now);
    commandRateLimits.set(key, limit);
    return true;
}

// ─── Validation Result ──────────────────────────────────────
export interface CommandValidationResult {
    allowed: boolean;
    reason?: string;
    sanitized?: string;
    warnings?: string[];
    riskLevel: "safe" | "low" | "medium" | "high" | "blocked";
}

// ─── Main Validation Function ───────────────────────────────
export function validateRemoteCommand(
    command: string,
    userId?: number
): CommandValidationResult {
    const warnings: string[] = [];

    // 1. Basic sanitization
    const trimmed = command.trim();

    if (!trimmed) {
        return {
            allowed: false,
            reason: "Empty command",
            riskLevel: "blocked",
        };
    }

    if (trimmed.length > 500) {
        return {
            allowed: false,
            reason: "Command too long (max 500 chars)",
            riskLevel: "blocked",
        };
    }

    // 2. Rate limiting
    if (userId && !checkCommandRateLimit(userId)) {
        logger.warn("Remote command rate limit exceeded", { userId });
        audit.rateLimited(userId);
        return {
            allowed: false,
            reason: "Rate limit exceeded (max 10 commands/minute)",
            riskLevel: "blocked",
        };
    }

    // 3. Check if it's a whitelisted safe command
    const normalizedCmd = trimmed.toLowerCase().split(/\s+/)[0];
    if (SAFE_COMMANDS.has(trimmed) || SAFE_COMMANDS.has(normalizedCmd)) {
        logger.debug("Command whitelisted", { command: trimmed.slice(0, 50) });
        return {
            allowed: true,
            sanitized: trimmed,
            riskLevel: "safe",
        };
    }

    // 4. Check for dangerous patterns
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
        if (pattern.test(trimmed)) {
            logger.warn("Dangerous command blocked", { command: trimmed.slice(0, 100), reason, userId });
            if (userId) {
                audit.record({
                    ts: new Date().toISOString(),
                    action: "command_blocked",
                    userId,
                    detail: { command: trimmed.slice(0, 100), reason },
                });
            }
            return {
                allowed: false,
                reason: `Blocked: ${reason}`,
                riskLevel: "blocked",
            };
        }
    }

    // 5. Check for suspicious patterns (allow with warning)
    for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
        if (pattern.test(trimmed)) {
            warnings.push(`Warning: ${reason}`);
        }
    }

    // 6. Check for shell metacharacters that could enable command injection
    const dangerousChars = /[;&|`$(){}[\]<>]/;
    if (dangerousChars.test(trimmed)) {
        // Allow pipes for PowerShell (common usage)
        if (trimmed.includes("|") && !trimmed.includes(";") && !trimmed.includes("&")) {
            warnings.push("Command contains pipe operator");
        } else {
            return {
                allowed: false,
                reason: "Command contains potentially dangerous shell characters",
                riskLevel: "high",
            };
        }
    }

    // 7. Determine risk level based on warnings
    let riskLevel: "low" | "medium" = "low";
    if (warnings.length > 0) {
        riskLevel = "medium";
    }

    logger.info("Command validated", {
        command: trimmed.slice(0, 50),
        riskLevel,
        warnings: warnings.length
    });

    return {
        allowed: true,
        sanitized: trimmed,
        warnings: warnings.length > 0 ? warnings : undefined,
        riskLevel,
    };
}

// ─── Cleanup stale rate limit entries ───────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [key, limit] of commandRateLimits.entries()) {
        limit.timestamps = limit.timestamps.filter(ts => now - ts < COMMAND_RATE_WINDOW_MS);
        if (limit.timestamps.length === 0) {
            commandRateLimits.delete(key);
        }
    }
}, 5 * 60 * 1000); // Cleanup every 5 minutes
