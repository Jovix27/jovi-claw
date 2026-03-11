import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "AIzaSyA0CkR8GUhXyrSyRIi12yXlArlbJq-Noyg", // Gemini Key
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
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

        console.log("Asking Gemini");
        const res1 = await client.chat.completions.create({
            model: "gemini-2.0-flash",
            messages,
            tools
        });

        const assistantMsg = res1.choices[0].message;
        console.log("Gemini generated:", JSON.stringify(assistantMsg, null, 2));

    } catch (e: any) {
        if (e.response && e.response.data) {
            console.error("Gemini Error Data:", e.response.data);
        } else {
            console.error("Gemini Error:", e.status, e.message);
        }
    }
}

main();
