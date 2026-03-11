import { logger } from "../utils/logger.js";
import { chat } from "../llm/claude.js";
import { executeTool, getToolDefinitions } from "../tools/index.js";

/**
 * Executes a CLI command and, if it fails, spawns an inner agent loop that tries to fix the code
 * until the command succeeds or max retries are hit.
 */
export async function runWithSelfHealing(
    userId: number,
    command: string,
    cwd: string,
    maxRetries: number = 3
): Promise<{ success: boolean; finalOutput: string; retryCount: number }> {
    logger.info(`Starting Self-Healing Execution: ${command}`, { cwd });

    const tools = await getToolDefinitions(userId);
    // Prevent recursive delegate_to_subagent inside self-healing
    const safeTools = tools.filter(t => t.type === "function" && t.function.name !== "delegate_to_subagent");

    let output = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logger.info(`Self-healing attempt ${attempt}/${maxRetries}`);

        // Execute the command via the secure wrapper to ensure command validation
        try {
            output = await executeTool("remote_pc_execute", { command, cwd }, userId);

            let parsed;
            try {
                parsed = JSON.parse(output);
            } catch {
                parsed = null;
            }

            // Abort self-healing if command was actively blocked by security logic
            if (parsed && parsed.blocked === true) {
                logger.warn("Self-healing aborted because command was blocked by security validator.", { command });
                return { success: false, finalOutput: output, retryCount: attempt - 1 };
            }

            // A command might have an error message or non-zero exit code
            const isError = parsed
                ? (parsed.error != null || (parsed.exitCode != null && parsed.exitCode !== 0))
                : (output.toLowerCase().includes("error") || output.includes("ERR!") || output.includes("CommandNotFoundException"));

            if (!isError) {
                return { success: true, finalOutput: output, retryCount: attempt - 1 };
            }
        } catch (e) {
            output = String(e);
        }

        logger.warn(`Execution failed or returned errors. Triggering fix agent.`, { output: output.slice(0, 200) });

        if (attempt === maxRetries) {
            break;
        }

        // Spawn a fixing chat loop
        const fixPrompt = `
You are the Self-Healing module.
I ran: \`${command}\` in \`${cwd}\`
It failed with this output:
<output>
${output.slice(-5000)}
</output>

Your task: Fix the code or environment so this command succeeds next time. 
Use tools to read files, modify files, or install dependencies as needed to resolve the error.
Reply "FIXED" when you are confident the issue is resolved. Do not try to re-run the main command yourself, I will do that.
`;

        const messages: any[] = [
            { role: "system", content: "You are the Self-Healing agent. Fix the error described." },
            { role: "user", content: fixPrompt }
        ];

        // Inner fix loop (max 4 turns)
        for (let j = 0; j < 4; j++) {
            const res = await chat(messages, safeTools, userId);
            const msg = res.choices[0]?.message;
            if (!msg) break;

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls as any });
                for (const call of msg.tool_calls) {
                    if (call.type !== "function") continue;
                    let fnArgs = {};
                    try { fnArgs = JSON.parse(call.function.arguments); } catch { }
                    const tr = await executeTool(call.function.name, fnArgs, userId);
                    messages.push({ role: "tool", tool_call_id: call.id, content: tr });
                }
            } else {
                break; // done fixing
            }
        }
    }

    return { success: false, finalOutput: output, retryCount: maxRetries };
}
