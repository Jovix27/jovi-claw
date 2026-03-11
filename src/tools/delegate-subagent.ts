import type OpenAI from "openai";
import { logger } from "../utils/logger.js";
import { chat } from "../llm/claude.js";
import { getToolDefinitions } from "./index.js";
import { searchLessons } from "../utils/semantic.js";
import { runRetrospective } from "../agent/retrospective.js";

export const delegateToSubagentDef: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
        name: "delegate_to_subagent",
        description: "Spawns a sub-agent with a specific role and task. Use this to delegate complex multi-step research, drafting, or coding tasks so you can focus on the main conversation. The sub-agent has access to all your tools, but its context is clean. It will return the final result back to you.",
        parameters: {
            type: "object",
            properties: {
                role: {
                    type: "string",
                    description: "The persona or role for the sub-agent (e.g., 'Expert Python Coder', 'Research Analyst')."
                },
                task: {
                    type: "string",
                    description: "The specific, detailed task you want the sub-agent to accomplish."
                },
                workspace: {
                    type: "string",
                    description: "Optional absolute path to an isolated directory/workspace where the sub-agent should work to prevent bleeding into the main environment."
                }
            },
            required: ["role", "task"],
            additionalProperties: false
        }
    }
}

export async function executeDelegateToSubagent(args: { role: string; task: string; workspace?: string }, userId?: number): Promise<string> {
    const { role, task, workspace } = args;
    logger.info(`Spawning sub-agent. Role: ${role} | Task: ${task.slice(0, 50)}...`, { userId });

    const tools = await getToolDefinitions(userId || 0);
    // Prevent recursive infinite loop by temporarily removing delegate_to_subagent from the subagent's tools
    const safeTools = tools.filter(t => t.type === "function" && t.function.name !== "delegate_to_subagent");

    // Fetch prior Engineering Lessons
    const lessons = await searchLessons(userId || 0, task, 2);
    const lessonText = lessons.length > 0 ? `\n\nPrevious Engineering Lessons for similar tasks:\n${lessons.join("\n")}` : "";

    // Contextualize the workspace if provided
    const workspaceInfo = workspace ? `\nYou MUST perform all your file modifications and operations specifically inside the following workspace path: ${workspace}` : "";

    try {
        const messages: any[] = [
            { role: "system", content: `You are a delegated sub-agent for Jovi AI. Your specific role is: ${role}. Your ONLY goal is to solve the prompt provided by the main agent and return a complete, final result in plain text. Do not ask questions back; use tools if you need context.${workspaceInfo}${lessonText}` },
            { role: "user", content: task }
        ];

        let transcript = `Task: ${task}\n\n`;

        // Let the sub-agent run up to 5 tool iterations to solve its task
        for (let i = 0; i < 5; i++) {
            const response = await chat(messages, safeTools, userId);
            const choice = response.choices[0];
            if (!choice) return "Sub-agent failed to return a response.";

            const msg = choice.message;

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                // Execute tools on behalf of sub-agent
                messages.push({
                    role: "assistant",
                    content: msg.content ?? null,
                    tool_calls: msg.tool_calls as any
                });
                if (msg.content) transcript += `Agent: ${msg.content}\n`;

                // Import dynamically to avoid circular dependencies if getMcpToolDefinitions is used
                const { executeTool } = await import("./index.js");

                for (const call of msg.tool_calls) {
                    if (call.type !== "function") continue;
                    const fnName = call.function.name;
                    let fnArgs = {};
                    try { fnArgs = JSON.parse(call.function.arguments); } catch { }

                    let result;
                    if (fnName === "remote_pc_execute") {
                        const { runWithSelfHealing } = await import("../agent/self-healing.js");
                        const { command, cwd } = fnArgs as any;
                        if (command) {
                            const shRes = await runWithSelfHealing(userId || 0, command, cwd || "");
                            result = shRes.finalOutput;
                            if (shRes.retryCount > 0) {
                                transcript += `[System Note: Triggered self-healing AI and took ${shRes.retryCount} retries to fix environment errors.]\n`;
                            }
                        } else {
                            result = JSON.stringify({ error: "Missing command parameter" });
                        }
                    } else {
                        result = await executeTool(fnName, fnArgs, userId);
                    }

                    transcript += `Tool ${fnName}(...): ${String(result).slice(0, 500)}...\n`;
                    messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        content: result
                    });
                }
            } else {
                // Done! Return final text.
                transcript += `Final Output: ${msg.content}\n`;
                // Run post-task retrospective in the background
                runRetrospective(userId || 0, task, transcript).catch(e => logger.error("Bg Retro Error", { e }));
                return `[SUB-AGENT RESULT (${role})]\n${msg.content || "<empty>"}`;
            }
        }

        transcript += `[ABORTED] Hit max iterations.\n`;
        runRetrospective(userId || 0, task, transcript).catch(e => logger.error("Bg Retro Error", { e }));
        return "[SUB-AGENT ABORTED] Task reached max iterations without completion.";
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Sub-agent error: ${msg}`;
    }
}
