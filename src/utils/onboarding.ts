import { Context } from "grammy";
import { setCoreMemory } from "./memory.js";

const setupQuestions = [
    { key: "name", question: "1. 👤 What is your name?" },
    { key: "occupation", question: "2. 💼 What do you do for work?" },
    { key: "location", question: "3. 📍 Where are you based?" },
    { key: "goals", question: "4. 🎯 What are your current goals or projects?" },
    { key: "topics", question: "5. 🧠 What topics are you most interested in?" },
    { key: "communication_style", question: "6. 💬 How do you like me to communicate? (e.g., concise, detailed, casual)" },
    { key: "tools", question: "7. 🛠️ What tools or software do you use daily?" },
    { key: "important_people", question: "8. 👥 Are there any important people I should know about?" },
];

const activeSetups = new Map<number, number>(); // userId -> current question index

export async function handleSetupStart(ctx: Context) {
    if (!ctx.from) return;

    await ctx.reply(
        "Welcome to the memory setup! 🧠\n\nI'm going to ask you 8 quick questions to build your Core Memory profile.\n\nYou can reply with your answer, or type 'skip' to skip any question. Let's begin!"
    );

    activeSetups.set(ctx.from.id, 0);
    await askNextQuestion(ctx);
}

export async function handleSetupAnswer(ctx: Context, answer: string): Promise<boolean> {
    if (!ctx.from) return false;

    const userId = ctx.from.id;
    const currentIndex = activeSetups.get(userId);

    if (currentIndex === undefined) return false; // Not in setup mode

    const currentQ = setupQuestions[currentIndex];

    if (answer.toLowerCase() !== "skip") {
        await setCoreMemory(userId, currentQ.key, answer);
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < setupQuestions.length) {
        activeSetups.set(userId, nextIndex);
        await askNextQuestion(ctx);
    } else {
        activeSetups.delete(userId);
        await ctx.reply("✨ Setup complete! Your Core Memory is now loaded. I'll remember this information in all our future chats.");
    }

    return true; // We handled the message
}

async function askNextQuestion(ctx: Context) {
    if (!ctx.from) return;
    const currentIndex = activeSetups.get(ctx.from.id);
    if (currentIndex === undefined) return;

    const q = setupQuestions[currentIndex];
    await ctx.reply(q.question);
}
