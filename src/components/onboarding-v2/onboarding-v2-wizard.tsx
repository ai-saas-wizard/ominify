"use client";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { buildSuggestedAgentFromDefinition, AGENT_CATALOG } from "@/lib/agent-catalog";
import { UrlLaunchScreen } from "./components/url-launch-screen";
import { AnalysisTheater } from "./components/analysis-theater";
import { AgentMarketplace } from "./components/agent-marketplace";
import { ChatPanel } from "./components/chat-panel";
import { DeploySequence } from "./components/deploy-sequence";
import { DeploySuccess } from "./components/deploy-success";
import { useAIAnalysisV2 } from "./hooks/use-ai-analysis-v2";
import { useAgentChat } from "./hooks/use-agent-chat";
import { useDeployment } from "./hooks/use-deployment";
import type {
    OnboardingV2Phase,
    OnboardingV2WizardProps,
    SuggestedAgent,
    AgentModification,
} from "./types";

export function OnboardingV2Wizard({
    clientId,
    clientName,
    initialProfile,
}: OnboardingV2WizardProps) {
    // ─── PHASE STATE ───
    const [phase, setPhase] = useState<OnboardingV2Phase>("url_input");
    const [websiteUrl, setWebsiteUrl] = useState("");
    const [businessName, setBusinessName] = useState(clientName || "");
    const [industry, setIndustry] = useState("");
    const [tenantProfile, setTenantProfile] = useState<Record<string, unknown> | null>(
        initialProfile
    );
    const [suggestedAgents, setSuggestedAgents] = useState<SuggestedAgent[]>([]);

    // ─── CHAT STATE ───
    const [chatOpen, setChatOpen] = useState(false);
    const [focusedAgentName, setFocusedAgentName] = useState<string | undefined>(undefined);

    // ─── HOOKS ───
    const analysis = useAIAnalysisV2();
    const chat = useAgentChat(businessName, industry);
    const deployment = useDeployment(clientId);

    // ─── DERIVED ───
    const enabledAgents = useMemo(
        () => suggestedAgents.filter((a) => a.enabled),
        [suggestedAgents]
    );

    const sequenceCount = useMemo(
        () => enabledAgents.filter((a) => a.sequence_summary).length,
        [enabledAgents]
    );

    // ─── PHASE 1: URL LAUNCH ───
    const handleLaunch = useCallback(
        async (url: string) => {
            setWebsiteUrl(url);
            setPhase("analyzing");

            const result = await analysis.analyzeWebsite(url);
            if (result && result.success) {
                setBusinessName(result.businessName || clientName || "");
                setIndustry(result.industry || "");
                setTenantProfile(result.profile);
                setSuggestedAgents(result.agentSuggestions);
                setPhase("marketplace");
            }
            // If failed, stay on "analyzing" phase — error UI shown by AnalysisTheater
        },
        [analysis, clientName]
    );

    // ─── PHASE 2: ANALYSIS RETRY/SKIP ───
    const handleRetry = useCallback(() => {
        analysis.resetAnalysis();
        setPhase("url_input");
    }, [analysis]);

    const handleSkip = useCallback(() => {
        // Skip to marketplace with default agents (all as optional)
        const defaultAgents = AGENT_CATALOG.map((def) =>
            buildSuggestedAgentFromDefinition(
                def,
                def.type_id === "inbound_receptionist" ? 1.0 : 0.5,
                def.type_id === "inbound_receptionist"
            )
        );
        setSuggestedAgents(defaultAgents);
        setBusinessName(clientName || "My Business");
        setIndustry("general");
        setPhase("marketplace");
    }, [clientName]);

    // ─── PHASE 3: MARKETPLACE ACTIONS ───
    const handleToggleAgent = useCallback((agentTypeId: string, enabled: boolean) => {
        setSuggestedAgents((prev) =>
            prev.map((a) => (a.type_id === agentTypeId ? { ...a, enabled } : a))
        );
    }, []);

    const handleCustomizeAgent = useCallback(
        (agentTypeId: string) => {
            const agent = suggestedAgents.find((a) => a.type_id === agentTypeId);
            setFocusedAgentName(agent?.name);
            setChatOpen(true);
        },
        [suggestedAgents]
    );

    const handleEditProfile = useCallback(() => {
        // For now, go back to URL input to re-analyze
        analysis.resetAnalysis();
        setPhase("url_input");
    }, [analysis]);

    // ─── PHASE 4: CHAT ───
    const handleSendChatMessage = useCallback(
        async (message: string) => {
            const modifications = await chat.sendMessage(message, suggestedAgents);
            if (modifications.length > 0) {
                applyModifications(modifications);
            }
        },
        [chat, suggestedAgents]
    );

    const applyModifications = useCallback((modifications: AgentModification[]) => {
        setSuggestedAgents((prev) => {
            let next = [...prev];

            for (const mod of modifications) {
                switch (mod.modification_type) {
                    case "enable":
                        next = next.map((a) =>
                            a.type_id === mod.agent_type_id ? { ...a, enabled: true } : a
                        );
                        break;

                    case "disable":
                        next = next.map((a) =>
                            a.type_id === mod.agent_type_id ? { ...a, enabled: false } : a
                        );
                        break;

                    case "remove":
                        next = next.filter((a) => a.type_id !== mod.agent_type_id);
                        break;

                    case "update": {
                        const changes = mod.changes as Record<string, unknown>;
                        next = next.map((a) => {
                            if (a.type_id !== (changes.agent_type_id || mod.agent_type_id)) return a;
                            const updates = (changes.updates || changes) as Record<string, unknown>;
                            return {
                                ...a,
                                ...(updates.name && typeof updates.name === "string" ? { name: updates.name } : {}),
                                ...(updates.description && typeof updates.description === "string"
                                    ? { description: updates.description }
                                    : {}),
                                ...(updates.custom_instructions && typeof updates.custom_instructions === "string"
                                    ? { custom_instructions: updates.custom_instructions }
                                    : {}),
                                ...(updates.voice_gender || updates.voice_name
                                    ? {
                                          voice_name:
                                              typeof updates.voice_name === "string"
                                                  ? updates.voice_name
                                                  : a.voice_name,
                                      }
                                    : {}),
                            };
                        });
                        break;
                    }

                    case "create": {
                        const changes = mod.changes as Record<string, unknown>;
                        const newAgent: SuggestedAgent = {
                            type_id: `custom_${Date.now()}`,
                            name: (changes.name as string) || "Custom Agent",
                            description: (changes.description as string) || "",
                            category: (changes.category as SuggestedAgent["category"]) || "outbound_follow_up",
                            enabled: true,
                            confidence: 0.7,
                            confidence_label: "recommended",
                            icon: "Bot",
                            voice_id: "EXAVITQu4vr4xnSDxMaL",
                            voice_name: "Sarah",
                            sequence_summary: null,
                            override_variables: [],
                            custom_instructions: (changes.purpose as string) || null,
                            is_custom: true,
                        };
                        next.push(newAgent);
                        break;
                    }
                }
            }

            return next;
        });
    }, []);

    // ─── PHASE 5: DEPLOY ───
    const handleDeploy = useCallback(async () => {
        setPhase("deploying");
        setChatOpen(false);

        // Build profile FormData
        const formData = new FormData();
        if (tenantProfile) {
            for (const [key, value] of Object.entries(tenantProfile)) {
                if (value === null || value === undefined) continue;
                if (typeof value === "object") {
                    formData.append(key, JSON.stringify(value));
                } else {
                    formData.append(key, String(value));
                }
            }
        }
        // Ensure required fields are present
        if (!formData.get("business_name")) {
            formData.set("business_name", businessName);
        }
        if (!formData.get("industry")) {
            formData.set("industry", industry);
        }
        if (!formData.get("website_url") && websiteUrl) {
            formData.set("website_url", websiteUrl);
        }

        const result = await deployment.deploy(enabledAgents, formData);

        if (result && result.success) {
            // Small delay for the final animation to settle
            setTimeout(() => setPhase("success"), 1500);
        }
        // If failed, stay on "deploying" — error shown by DeploySequence
    }, [tenantProfile, businessName, industry, websiteUrl, deployment, enabledAgents]);

    // ─── RENDER ───
    return (
        <div className="fixed inset-0 z-50 bg-zinc-950">
            <AnimatePresence mode="wait">
                {phase === "url_input" && (
                    <motion.div
                        key="url_input"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <UrlLaunchScreen
                            onLaunch={handleLaunch}
                            launching={analysis.analyzing}
                        />
                    </motion.div>
                )}

                {phase === "analyzing" && (
                    <motion.div
                        key="analyzing"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AnalysisTheater
                            websiteUrl={websiteUrl}
                            currentStage={analysis.currentStage}
                            error={analysis.error}
                            onRetry={handleRetry}
                            onSkip={handleSkip}
                        />
                    </motion.div>
                )}

                {phase === "marketplace" && (
                    <motion.div
                        key="marketplace"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AgentMarketplace
                            businessName={businessName}
                            industry={industry}
                            suggestedAgents={suggestedAgents}
                            onToggleAgent={handleToggleAgent}
                            onCustomizeAgent={handleCustomizeAgent}
                            onDeploy={handleDeploy}
                            onOpenChat={() => {
                                setFocusedAgentName(undefined);
                                setChatOpen(true);
                            }}
                            onEditProfile={handleEditProfile}
                            deploying={deployment.deploying}
                        />
                        <ChatPanel
                            isOpen={chatOpen}
                            onClose={() => setChatOpen(false)}
                            messages={chat.messages}
                            onSendMessage={handleSendChatMessage}
                            sending={chat.sending}
                            focusedAgentName={focusedAgentName}
                        />
                    </motion.div>
                )}

                {phase === "deploying" && deployment.progress && (
                    <motion.div
                        key="deploying"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <DeploySequence progress={deployment.progress} />
                    </motion.div>
                )}

                {phase === "success" && (
                    <motion.div
                        key="success"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <DeploySuccess
                            clientId={clientId}
                            agentCount={enabledAgents.length}
                            sequenceCount={sequenceCount}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
