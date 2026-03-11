/**
 * Tool to toggle Agent Mode (Remote Control capabilities).
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { setAgentMode } from "./index.js";

export const toggleAgentModeDef: ChatCompletionTool = {
    type: "function",
    function: {
        name: "toggle_agent_mode",
        description: "Enables or disables Agent Mode (Remote PC Control). When enabled, Jovi can control Boss's real PC. When disabled, remote tools are hidden for privacy and security.",
        parameters: {
            type: "object",
            properties: {
                enabled: {
                    type: "boolean",
                    description: "Set to true to enable Agent Mode (connect to PC), false to disable."
                }
            },
            required: ["enabled"]
        }
    }
};

export async function executeToggleAgentMode(args: { enabled: boolean }, userId?: number): Promise<string> {
    if (!userId) return "❌ User ID required to toggle agent mode.";

    const {
        isRemoteAgentConnected,
        isRemoteBootstrapperConnected,
        triggerBootstrapper,
        waitForAgentConnection
    } = await import("../utils/remote-relay.js");

    if (args.enabled) {
        const connected = isRemoteAgentConnected();
        const bootstrapperConnected = isRemoteBootstrapperConnected();

        // Case 1: Remote agent already connected — instant activation
        if (connected) {
            await setAgentMode(userId, true);
            return "🟢 Agent Mode ENABLED. Your laptop is ON and successfully connected. Jovi now has remote control authority. How can I help with your PC?";
        }

        // Case 2: Bootstrapper is connected — trigger it and wait for agent
        if (bootstrapperConnected) {
            await setAgentMode(userId, true);
            const triggered = await triggerBootstrapper();
            if (triggered) {
                // Wait for the remote agent to actually connect (up to 15s)
                const agentCameOnline = await waitForAgentConnection(15_000);
                if (agentCameOnline) {
                    return "🟢 Agent Mode ENABLED. I detected your laptop, started the remote agent, and it's now fully connected! I have full remote control. What would you like me to do?";
                } else {
                    return "🟡 Agent Mode ENABLED. I triggered the remote agent on your laptop but it hasn't connected yet. It may take a few more seconds — try your command in a moment. If it doesn't work, press Ctrl+Shift+J on your laptop to restart.";
                }
            } else {
                return "🟡 Agent Mode ENABLED but I couldn't trigger the bootstrapper. Press **Ctrl+Shift+J** on your laptop to restart the connection.";
            }
        }

        // Case 3: Nothing connected — enable mode but instruct user
        await setAgentMode(userId, true);
        return "🟡 Agent Mode ENABLED but your laptop isn't connected yet.\n\n" +
            "👉 Press **Ctrl+Shift+J** on your laptop to start the bootstrapper.\n" +
            "   (Make sure the hotkey listener is running — run `npm run bootstrapper-hotkey` once first)\n\n" +
            "Once your laptop connects, I'll have full remote control of your PC!";
    } else {
        await setAgentMode(userId, false);
        return "🔴 Agent Mode DISABLED. Remote control authority revoked. Jovi is back to standard mode.";
    }
}

