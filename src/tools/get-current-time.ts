import type OpenAI from "openai";

/**
 * get-current-time — Jovi's first tool.
 * Returns the current date/time in a human-readable format.
 */
export const getCurrentTimeTool = {
    name: "get_current_time" as const,

    definition: {
        type: "function" as const,
        function: {
            name: "get_current_time",
            description:
                "Get the current date and time. Use this when the user asks what time it is, today's date, or anything time-related.",
            parameters: {
                type: "object" as const,
                properties: {
                    timezone: {
                        type: "string" as const,
                        description:
                            'IANA timezone string (e.g. "Asia/Kolkata", "America/New_York"). Defaults to system local time if not provided.',
                    },
                },
                required: [] as string[],
            },
        },
    } satisfies OpenAI.ChatCompletionTool,

    async execute(input: { timezone?: string }): Promise<string> {
        try {
            const options: Intl.DateTimeFormatOptions = {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
                timeZoneName: "short",
            };

            if (input.timezone) {
                options.timeZone = input.timezone;
            } else {
                // Default to IST (Boss's timezone) since the server runs in UTC on Railway
                options.timeZone = "Asia/Kolkata";
            }

            const now = new Date();
            const formatted = new Intl.DateTimeFormat("en-US", options).format(now);

            return JSON.stringify({
                formatted,
                iso: now.toISOString(),
                timezone: input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                unix: Math.floor(now.getTime() / 1000),
            });
        } catch {
            return JSON.stringify({
                error: `Invalid timezone: ${input.timezone}`,
            });
        }
    },
};
