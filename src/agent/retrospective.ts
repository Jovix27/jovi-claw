import { chat } from "../llm/claude.js";
import { storeLessonLearned } from "../utils/semantic.js";
import { logger } from "../utils/logger.js";

/**
 * Runs a retrospective on a completed sub-agent session.
 * Analyzes the sequence of messages/tool calls to extract things to avoid, best practices, etc.
 * Stores these learnings into Semantic Memory so future agents handling similar tasks can be pre-prompted with them.
 */
export async function runRetrospective(userId: number, taskDescription: string, agentTranscript: string): Promise<void> {
    logger.info(`Running retrospective for task: ${taskDescription.slice(0, 50)}...`, { userId });

    const prompt = `
You are the "Retrospective Engine" (ao-52). 
A sub-agent just completed the following task:
<task>
${taskDescription}
</task>

Here is a summary of their transcript (actions taken, errors hit, final output):
<transcript>
${agentTranscript.slice(-10000)} // truncate if too massive
</transcript>

Analyze this execution. Did the agent hit any errors? Did they have to try multiple times?
Extract exactly 1 or 2 concise, generalized "Lessons Learned" that would help another agent succeed faster next time on a similar task.
Format your output as a short summary of the lesson, starting with an action verb. Focus on things like "Install X before running Y", "Remember to escape quotes in JSON", or "Always check for Z when modifying auth".
If the task was trivial and no deep lesson is needed, return "NO_LESSON".
    `;

    try {
        const response = await chat([
            { role: "system", content: "You are the Retrospective Engine. You analyze agent executions for reusable engineering lessons." },
            { role: "user", content: prompt }
        ], [], userId);

        const lesson = response.choices[0]?.message.content;

        if (lesson && !lesson.includes("NO_LESSON")) {
            logger.info("Retrospective extracted new lesson.", { lesson });
            // Store it in our semantic memory vector DB
            await storeLessonLearned(userId, taskDescription, lesson.trim());
        } else {
            logger.debug("Retrospective determined NO_LESSON.");
        }

    } catch (error) {
        logger.error("Failed to run retrospective", { error });
    }
}
