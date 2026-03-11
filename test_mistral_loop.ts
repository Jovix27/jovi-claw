import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "RgFerV4PL5viOnPwGUSPgqyg4kZAwBXB",
    baseURL: "https://api.mistral.ai/v1",
});

async function main() {
    try {
        const messages: any[] = [{ role: "user", content: "What is the weather?" }];
        const tools: any[] = [{
            type: "function",
            function: {
                name: "get_weather",
                description: "Get weather",
                parameters: { type: "object", properties: {}, required: [] }
            }
        }];

        console.log("Turn 1 - Asking Mistral");
        const res1 = await client.chat.completions.create({
            model: "mistral-small-latest",
            messages,
            tools
        });

        const assistantMsg = res1.choices[0].message;
        console.log("Mistral generated:", JSON.stringify(assistantMsg, null, 2));

        messages.push(assistantMsg);

        // Mock the tool execution
        if (assistantMsg.tool_calls) {
            messages.push({
                role: "tool",
                tool_call_id: assistantMsg.tool_calls[0].id,
                name: assistantMsg.tool_calls[0].function.name,
                content: "Sunny, 25C"
            });
        }

        console.log("\nTurn 2 - Passing it back to Mistral");
        console.log("Messages array:", JSON.stringify(messages, null, 2));

        const res2 = await client.chat.completions.create({
            model: "mistral-small-latest",
            messages,
            tools
        });

        console.log("Success! Turn 2 replied:", res2.choices[0].message.content);
    } catch (e: any) {
        if (e.response && e.response.data) {
            console.error("Mistral Error Data:", e.response.data);
        } else {
            console.error("Mistral Error:", e.status, e.message);
        }
    }
}

main();
