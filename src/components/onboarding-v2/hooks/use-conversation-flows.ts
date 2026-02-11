"use client";

import { useState, useCallback } from "react";
import type { ConversationFlowStep, SuggestedAgent, TenantProfile } from "../types";
import { generateConversationFlowSteps } from "@/app/actions/conversation-flow-actions";

export function useConversationFlows() {
    const [flows, setFlows] = useState<Record<string, ConversationFlowStep[]>>({});
    const [generatingFlow, setGeneratingFlow] = useState<Record<string, boolean>>({});

    // ─── GENERATE FLOW FOR A SINGLE AGENT ───

    const generateFlowForAgent = useCallback(
        async (
            agentTypeId: string,
            agentName: string,
            agentPurpose: string,
            direction: "inbound" | "outbound",
            profile: TenantProfile
        ) => {
            setGeneratingFlow((prev) => ({ ...prev, [agentTypeId]: true }));

            try {
                const steps = await generateConversationFlowSteps(
                    agentName,
                    agentPurpose,
                    direction,
                    profile
                );

                const flowSteps: ConversationFlowStep[] = steps.map((text: string, idx: number) => ({
                    id: `${agentTypeId}_step_${idx + 1}`,
                    stepNumber: idx + 1,
                    text,
                    isEdited: false,
                }));

                setFlows((prev) => ({ ...prev, [agentTypeId]: flowSteps }));
            } catch (error) {
                console.error(`Failed to generate flow for ${agentName}:`, error);
            } finally {
                setGeneratingFlow((prev) => ({ ...prev, [agentTypeId]: false }));
            }
        },
        []
    );

    // ─── GENERATE ALL FLOWS IN PARALLEL ───

    const generateAllFlows = useCallback(
        async (agents: SuggestedAgent[], profile: TenantProfile) => {
            const enabledAgents = agents.filter((a) => a.enabled);
            await Promise.all(
                enabledAgents.map((agent) =>
                    generateFlowForAgent(
                        agent.type_id,
                        agent.name,
                        agent.description,
                        agent.direction || "inbound",
                        profile
                    )
                )
            );
        },
        [generateFlowForAgent]
    );

    // ─── EDIT OPERATIONS ───

    const updateStep = useCallback((agentTypeId: string, stepId: string, text: string) => {
        setFlows((prev) => ({
            ...prev,
            [agentTypeId]: (prev[agentTypeId] || []).map((step) =>
                step.id === stepId ? { ...step, text, isEdited: true } : step
            ),
        }));
    }, []);

    const addStep = useCallback((agentTypeId: string) => {
        setFlows((prev) => {
            const current = prev[agentTypeId] || [];
            const newStep: ConversationFlowStep = {
                id: `${agentTypeId}_step_${Date.now()}`,
                stepNumber: current.length + 1,
                text: "",
                isEdited: true,
            };
            return { ...prev, [agentTypeId]: [...current, newStep] };
        });
    }, []);

    const removeStep = useCallback((agentTypeId: string, stepId: string) => {
        setFlows((prev) => {
            const updated = (prev[agentTypeId] || [])
                .filter((s) => s.id !== stepId)
                .map((s, idx) => ({ ...s, stepNumber: idx + 1 }));
            return { ...prev, [agentTypeId]: updated };
        });
    }, []);

    const reorderSteps = useCallback((agentTypeId: string, fromIndex: number, toIndex: number) => {
        setFlows((prev) => {
            const current = [...(prev[agentTypeId] || [])];
            const [moved] = current.splice(fromIndex, 1);
            current.splice(toIndex, 0, moved);
            const renumbered = current.map((s, idx) => ({ ...s, stepNumber: idx + 1 }));
            return { ...prev, [agentTypeId]: renumbered };
        });
    }, []);

    // ─── SERIALIZE TO TEXT ───

    const getFlowAsText = useCallback(
        (agentTypeId: string): string => {
            const steps = flows[agentTypeId] || [];
            if (steps.length === 0) return "";
            return steps.map((s) => `${s.stepNumber}. ${s.text}`).join("\n");
        },
        [flows]
    );

    // ─── GET ALL FLOWS AS TEXT MAP ───

    const getAllFlowsAsText = useCallback((): Record<string, string> => {
        const result: Record<string, string> = {};
        for (const [agentTypeId, steps] of Object.entries(flows)) {
            if (steps.length > 0) {
                result[agentTypeId] = steps.map((s) => `${s.stepNumber}. ${s.text}`).join("\n");
            }
        }
        return result;
    }, [flows]);

    return {
        flows,
        generatingFlow,
        generateFlowForAgent,
        generateAllFlows,
        updateStep,
        addStep,
        removeStep,
        reorderSteps,
        getFlowAsText,
        getAllFlowsAsText,
    };
}
