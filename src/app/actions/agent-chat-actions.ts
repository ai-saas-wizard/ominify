"use server";

import OpenAI from "openai";
import { AGENT_CATALOG, buildSuggestedAgentFromDefinition } from "@/lib/agent-catalog";
import type { ChatMessage, AgentModification } from "@/components/onboarding-v2/types";

// ═══════════════════════════════════════════════════════════
// AGENT CHAT — GPT-4o with function calling for modifying
// the agent fleet during onboarding setup.
// ═══════════════════════════════════════════════════════════

interface ChatContext {
    businessName: string;
    industry: string;
    currentAgents: Array<{
        type_id: string;
        name: string;
        enabled: boolean;
        description: string;
    }>;
}

interface ChatResponse {
    message: ChatMessage;
    modifications: AgentModification[];
}

function buildSystemPrompt(ctx: ChatContext): string {
    const catalogSummary = AGENT_CATALOG.map(
        (a) => `- ${a.type_id}: ${a.name} (${a.category}) — ${a.description}`
    ).join("\n");

    return `You are an AI setup assistant for ${ctx.businessName}, a ${ctx.industry} business. You help customize their AI voice agent fleet.

CURRENT AGENTS:
${ctx.currentAgents.map((a) => `- ${a.name} (${a.type_id}): ${a.enabled ? "ENABLED" : "DISABLED"} — ${a.description}`).join("\n")}

AVAILABLE AGENT TYPES:
${catalogSummary}

RULES:
- Use the provided functions to modify agents. Always call a function when making changes.
- Explain what you changed in your response.
- Be proactive — suggest complementary changes if relevant.
- If something isn't feasible, explain why and offer alternatives.
- Keep responses concise.
- The inbound_receptionist cannot be disabled.`;
}

const CHAT_TOOLS: OpenAI.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "update_agent",
            description: "Update an existing agent's configuration",
            parameters: {
                type: "object",
                properties: {
                    agent_type_id: { type: "string" },
                    updates: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            custom_instructions: { type: "string" },
                        },
                    },
                },
                required: ["agent_type_id", "updates"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_custom_agent",
            description: "Create a new custom agent type not in the catalog",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    category: {
                        type: "string",
                        enum: ["inbound", "outbound_follow_up", "outbound_marketing", "outbound_retention"],
                    },
                    purpose: { type: "string" },
                },
                required: ["name", "description", "category", "purpose"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "remove_agent",
            description: "Remove an agent from the setup",
            parameters: {
                type: "object",
                properties: {
                    agent_type_id: { type: "string" },
                },
                required: ["agent_type_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "toggle_agent",
            description: "Enable or disable an agent",
            parameters: {
                type: "object",
                properties: {
                    agent_type_id: { type: "string" },
                    enabled: { type: "boolean" },
                },
                required: ["agent_type_id", "enabled"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_voice",
            description: "Change the voice for one or all agents",
            parameters: {
                type: "object",
                properties: {
                    agent_type_id: {
                        type: "string",
                        description: "Specific agent type_id, or 'all' for all agents",
                    },
                    voice_gender: { type: "string", enum: ["male", "female"] },
                    voice_name: { type: "string" },
                },
                required: ["agent_type_id"],
            },
        },
    },
];

export async function processAgentChatMessage(
    context: ChatContext,
    messageHistory: ChatMessage[],
    newUserMessage: string
): Promise<ChatResponse> {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 30000,
    });

    const systemPrompt = buildSystemPrompt(context);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messageHistory.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
        { role: "user", content: newUserMessage },
    ];

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools: CHAT_TOOLS,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 1000,
        });

        const choice = response.choices[0];
        const modifications: AgentModification[] = [];
        const functionCalls: ChatMessage["function_calls"] = [];

        // Process function calls
        if (choice.message.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                const mod: AgentModification = {
                    modification_id: crypto.randomUUID(),
                    agent_type_id: args.agent_type_id || args.name || "",
                    modification_type: mapFnToModType(toolCall.function.name, args),
                    changes: args,
                    timestamp: new Date().toISOString(),
                };
                modifications.push(mod);
                functionCalls.push({
                    function_name: toolCall.function.name,
                    arguments: args,
                    result: "Applied",
                });
            }
        }

        // Get text response
        let content = choice.message.content || "";

        if (choice.message.tool_calls && !content) {
            const followUp = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    ...messages,
                    choice.message as OpenAI.ChatCompletionMessageParam,
                    ...choice.message.tool_calls.map((tc) => ({
                        role: "tool" as const,
                        tool_call_id: tc.id,
                        content: "Applied successfully",
                    })),
                ],
                temperature: 0.7,
                max_tokens: 500,
            });
            content = followUp.choices[0]?.message?.content || "Done!";
        }

        return {
            message: {
                role: "assistant",
                content,
                function_calls: functionCalls.length > 0 ? functionCalls : undefined,
                timestamp: new Date().toISOString(),
            },
            modifications,
        };
    } catch (error) {
        console.error("[AGENT CHAT] Error:", error);
        return {
            message: {
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
                timestamp: new Date().toISOString(),
            },
            modifications: [],
        };
    }
}

function mapFnToModType(
    fnName: string,
    args: Record<string, unknown>
): AgentModification["modification_type"] {
    switch (fnName) {
        case "create_custom_agent":
            return "create";
        case "remove_agent":
            return "remove";
        case "toggle_agent":
            return args.enabled ? "enable" : "disable";
        default:
            return "update";
    }
}
