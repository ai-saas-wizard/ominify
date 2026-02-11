"use client";

import { useState, useCallback } from "react";
import { processAgentChatMessage } from "@/app/actions/agent-chat-actions";
import type { ChatMessage, AgentModification, SuggestedAgent } from "../types";

export function useAgentChat(businessName: string, industry: string) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [sending, setSending] = useState(false);

    const sendMessage = useCallback(
        async (
            content: string,
            currentAgents: SuggestedAgent[]
        ): Promise<AgentModification[]> => {
            setSending(true);

            const userMessage: ChatMessage = {
                role: "user",
                content,
                timestamp: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, userMessage]);

            try {
                const response = await processAgentChatMessage(
                    {
                        businessName,
                        industry,
                        currentAgents: currentAgents.map((a) => ({
                            type_id: a.type_id,
                            name: a.name,
                            enabled: a.enabled,
                            description: a.description,
                        })),
                    },
                    messages,
                    content
                );

                setMessages((prev) => [...prev, response.message]);
                setSending(false);
                return response.modifications;
            } catch (err) {
                const errorMessage: ChatMessage = {
                    role: "assistant",
                    content:
                        "Sorry, I had trouble processing that. Could you try rephrasing?",
                    timestamp: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, errorMessage]);
                setSending(false);
                return [];
            }
        },
        [businessName, industry, messages]
    );

    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    return {
        messages,
        sending,
        sendMessage,
        clearMessages,
    };
}
