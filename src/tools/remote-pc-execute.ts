import type OpenAI from "openai";
import { sendRemoteCommand, isRemoteAgentConnected } from "../utils/remote-relay.js";
import { logger } from "../utils/logger.js";
import { validateRemoteCommand } from "../security/command-validator.js";
import { audit } from "../security/audit-logger.js";

// ─── Tool Definition ────────────────────────────────────
export const remotePcExecuteDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "remote_pc_execute",
        description:
            "Executes a shell command on Boss's real Windows PC remotely, even when the bot " +
            "is running in the cloud. Use this for safe PC operations: opening apps, checking " +
            "system info, listing files, etc. Dangerous commands (rm -rf, registry edits, " +
            "downloads, user management) are blocked for security. The command runs on the " +
            "actual laptop, not on the server. Requires the remote-agent to be running.",
        parameters: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description:
                        "The shell command to execute on the PC " +
                        "(e.g., 'calc', 'dir C:\\Users', 'Get-Process | Select -First 5'). " +
                        "Max 500 characters. Dangerous commands are blocked.",
                },
                shell: {
                    type: "string",
                    enum: ["powershell", "cmd"],
                    description: "Shell to use. Defaults to powershell.",
                },
                cwd: {
                    type: "string",
                    description: "Optional working directory for the command.",
                },
            },
            required: ["command"],
        },
    },
};

// ─── Tool Execution ─────────────────────────────────────
export async function executeRemotePcCommand(
    {
        command,
        shell = "powershell",
        cwd,
    }: {
        command: string;
        shell?: "powershell" | "cmd";
        cwd?: string;
    },
    userId?: number
): Promise<string> {
    logger.info(`Remote PC execute requested: ${command.slice(0, 120)}`);

    // 1. Validate command security
    const validation = validateRemoteCommand(command, userId);

    if (!validation.allowed) {
        logger.warn("Remote command blocked by security", {
            command: command.slice(0, 100),
            reason: validation.reason,
            userId,
        });
        return JSON.stringify({
            error: `Command blocked: ${validation.reason}`,
            blocked: true,
            riskLevel: validation.riskLevel,
        });
    }

    // Log warnings if any
    if (validation.warnings?.length) {
        logger.info("Remote command has warnings", {
            command: command.slice(0, 50),
            warnings: validation.warnings,
        });
    }

    // 2. Check connection
    if (!isRemoteAgentConnected()) {
        return JSON.stringify({
            error: "Remote agent is NOT connected. Boss needs to run 'npm run remote-agent' on the PC first.",
            connected: false,
        });
    }

    // 3. Execute command
    try {
        const sanitizedCommand = validation.sanitized ?? command;
        const result = await sendRemoteCommand(sanitizedCommand, shell, cwd);

        // Audit the execution
        if (userId) {
            audit.commandExecuted(userId, sanitizedCommand, result.exitCode ?? 0);
        }

        return JSON.stringify({
            success: true,
            exitCode: result.exitCode,
            stdout: result.stdout || "(no output)",
            stderr: result.stderr || "",
            riskLevel: validation.riskLevel,
            ...(validation.warnings?.length ? { warnings: validation.warnings } : {}),
            ...(result.error ? { error: result.error } : {}),
        });
    } catch (error) {
        logger.error("Remote PC execute failed.", {
            error: error instanceof Error ? error.message : String(error),
        });
        return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
