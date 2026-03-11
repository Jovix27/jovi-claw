import { logger } from "../utils/logger.js";
import { executeTool } from "../tools/index.js";
import { executeDelegateToSubagent } from "../tools/delegate-subagent.js";

let cronInterval: NodeJS.Timeout | null = null;
const RUNNING_TASKS = new Set<number>();

/**
 * Periodically searches GitHub for issues labeled "ai-ready" and spawns sub-agents to solve them.
 * Represents the final piece of the independent orchestrator loop.
 */
export function startOrchestratorCron(userId: number) {
    if (cronInterval) return;

    // Run every 10 minutes
    const intervalMs = 10 * 60 * 1000;
    logger.info("Starting Autonomous Orchestrator Cron...", { intervalMs });

    cronInterval = setInterval(async () => {
        logger.debug("Running backlog check...");
        try {
            await processBacklog(userId);
        } catch (e) {
            logger.error("Error in backlog process", { error: e });
        }
    }, intervalMs);

    // Initial run
    processBacklog(userId).catch(e => logger.error("Initial backlog error", { e }));
}

async function processBacklog(userId: number) {
    // Only fetch if we have MCP setup, or just fallback to generic tool execution
    // Assuming the user has a primary repo configured or we search globally across user org
    const repo = process.env.NODE_ENV === "development" ? "test-repo" : "Jovi-Claw";
    const owner = "GreenBuildAI"; // Example owner, adjust based on actual context

    logger.info("Polling GitHub for 'ai-ready' issues.");

    try {
        // Query the github MCP
        const searchResultStr = await executeTool("mcp_github_search_issues", {
            q: `repo:${owner}/${repo} is:open is:issue label:ai-ready`,
        }, userId);

        let searchResult;
        try {
            searchResult = typeof searchResultStr === 'string' ? JSON.parse(searchResultStr) : searchResultStr;
        } catch {
            logger.warn("Could not parse github issue search result");
            return;
        }

        const issues = searchResult.items || [];
        if (issues.length === 0) {
            logger.debug("No ai-ready issues found in backlog.");
            return;
        }

        for (const issue of issues) {
            if (RUNNING_TASKS.has(issue.number)) {
                continue; // Already working on it
            }

            logger.info(`Orchestrator picked up issue #${issue.number}: ${issue.title}`);
            RUNNING_TASKS.add(issue.number);

            // Spawn agent asynchronously
            assignTaskToSubagent(userId, issue).catch(e => {
                logger.error(`Failed to complete task for issue #${issue.number}`, { error: e });
            }).finally(() => {
                RUNNING_TASKS.delete(issue.number);
            });
        }
    } catch (error) {
        logger.error("Failed to fetch backlog from GitHub tools", { error });
    }
}

async function assignTaskToSubagent(userId: number, issue: any) {
    const taskDescription = `
Solve GitHub Issue #${issue.number}: ${issue.title}
Body:
${issue.body}

Please:
1. Understand the issue.
2. Read the relevant code from the local codebase.
3. Make the necessary code modifications to fix it.
4. Verify your fix if possible.
`;

    // Create a unique workspace for the sub-agent
    // const workspace = `${process.env.USERPROFILE || 'C:\\'}\\.jovi-workspaces\\issue-${issue.number}`;

    // Attempt to clone or set up the workspace...
    // For now, assume the user's current directory is the repo, but in real isolation 
    // we would `git worktree add ...`

    const result = await executeDelegateToSubagent({
        role: "Autonomous Backlog Engineer",
        task: taskDescription,
        // workspace: workspace // Un-comment when worktree cloning logic is fully active
    }, userId);

    logger.info(`Sub-agent finished issue #${issue.number}`, { result });

    // Optionally: Post completion comment to GitHub
    try {
        /*
        await executeTool("mcp_github_add_issue_comment", {
            owner: "GreenBuildAI",
            repo: "Jovi-Claw",
            issue_number: issue.number,
            body: `Jovi AI has completed processing this task. Result:\n\n${result}`
        }, userId);
        */
    } catch (e) {
        logger.error("Failed to post github comment completion", { e });
    }
}
