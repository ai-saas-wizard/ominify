"use client";

import { useState, useCallback } from "react";
import { deployAgentFleet } from "@/app/actions/agent-deployment-actions";
import type { SuggestedAgent, DeploymentProgress, DeploymentResult } from "../types";

export function useDeployment(clientId: string) {
    const [deploying, setDeploying] = useState(false);
    const [progress, setProgress] = useState<DeploymentProgress | null>(null);
    const [result, setResult] = useState<DeploymentResult | null>(null);

    const deploy = useCallback(
        async (
            enabledAgents: SuggestedAgent[],
            profileFormData: FormData
        ): Promise<DeploymentResult | null> => {
            setDeploying(true);
            setResult(null);

            // Initialize progress
            const initialProgress: DeploymentProgress = {
                totalAgents: enabledAgents.length,
                completedAgents: 0,
                currentAgent: null,
                steps: [
                    {
                        id: "save_profile",
                        agentTypeId: "",
                        label: "Saving your business profile",
                        status: "in_progress",
                        substeps: [],
                    },
                    ...enabledAgents.map((agent) => ({
                        id: `agent_${agent.type_id}`,
                        agentTypeId: agent.type_id,
                        label: `Creating ${agent.name}`,
                        status: "pending" as const,
                        substeps: [
                            { label: "VAPI assistant created", status: "pending" as const },
                            ...(agent.sequence_summary
                                ? [{ label: "Sequence configured", status: "pending" as const }]
                                : []),
                        ],
                    })),
                ],
                error: null,
            };
            setProgress(initialProgress);

            try {
                // Mark profile save as in-progress
                setProgress((prev) => {
                    if (!prev) return prev;
                    const steps = [...prev.steps];
                    steps[0] = { ...steps[0], status: "in_progress" };
                    return { ...prev, steps };
                });

                const deployResult = await deployAgentFleet(clientId, enabledAgents, profileFormData);

                // Mark profile save as complete
                setProgress((prev) => {
                    if (!prev) return prev;
                    const steps = [...prev.steps];
                    steps[0] = { ...steps[0], status: "completed" };
                    return { ...prev, steps };
                });

                // Update each agent's status based on results
                for (const agentResult of deployResult.agents) {
                    setProgress((prev) => {
                        if (!prev) return prev;
                        const steps = prev.steps.map((step) => {
                            if (step.agentTypeId !== agentResult.type_id) return step;

                            const success = agentResult.agent_id !== null;
                            return {
                                ...step,
                                status: success ? "completed" as const : "failed" as const,
                                substeps: step.substeps.map((sub, idx) => {
                                    if (idx === 0) {
                                        return {
                                            ...sub,
                                            status: success ? "completed" as const : "failed" as const,
                                        };
                                    }
                                    if (idx === 1) {
                                        return {
                                            ...sub,
                                            status: agentResult.sequence_id
                                                ? "completed" as const
                                                : success
                                                  ? "completed" as const
                                                  : "failed" as const,
                                        };
                                    }
                                    return sub;
                                }),
                            };
                        });

                        return {
                            ...prev,
                            steps,
                            completedAgents: deployResult.agents.filter(
                                (a) => a.agent_id !== null
                            ).length,
                        };
                    });
                }

                setResult(deployResult);
                setDeploying(false);
                return deployResult;
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : "Deployment failed";
                setProgress((prev) =>
                    prev ? { ...prev, error: errorMsg } : prev
                );
                setDeploying(false);
                return null;
            }
        },
        [clientId]
    );

    return {
        deploying,
        progress,
        result,
        deploy,
    };
}
