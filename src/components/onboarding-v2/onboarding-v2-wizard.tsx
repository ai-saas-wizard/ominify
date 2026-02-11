"use client";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UrlLaunchScreen } from "./components/url-launch-screen";
import { AnalysisTheater } from "./components/analysis-theater";
import { ProfileReview } from "./components/profile-review";
import { AgentFleet } from "./components/agent-fleet";
import { ChatPanel } from "./components/chat-panel";
import { DeploySequence } from "./components/deploy-sequence";
import { DeploySuccess } from "./components/deploy-success";
import { useAIAnalysisV2 } from "./hooks/use-ai-analysis-v2";
import { useProfileForm } from "./hooks/use-profile-form";
import { useAgentChat } from "./hooks/use-agent-chat";
import { useConversationFlows } from "./hooks/use-conversation-flows";
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
    const [suggestedAgents, setSuggestedAgents] = useState<SuggestedAgent[]>([]);

    // ─── CHAT STATE ───
    const [chatOpen, setChatOpen] = useState(false);
    const [focusedAgentName, setFocusedAgentName] = useState<string | undefined>(undefined);

    // ─── HOOKS ───
    const analysis = useAIAnalysisV2();
    const profileForm = useProfileForm(initialProfile);
    const chat = useAgentChat(businessName, industry);
    const flowsHook = useConversationFlows();
    const deployment = useDeployment(clientId);

    // ─── DERIVED ───
    const enabledAgents = useMemo(
        () => suggestedAgents.filter((a) => a.enabled),
        [suggestedAgents]
    );

    const sequenceCount = useMemo(
        () => enabledAgents.filter((a) => a.direction === "outbound").length,
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
                setSuggestedAgents(result.agentSuggestions);

                // Apply analysis to profile form
                profileForm.applyV2Analysis(result);

                // Set website URL in profile
                profileForm.updateField("website", url);

                setPhase("profile_review");
            }
            // If failed, stay on "analyzing" phase — error UI shown by AnalysisTheater
        },
        [analysis, clientName, profileForm]
    );

    // ─── PHASE 2: ANALYSIS RETRY/SKIP ───
    const handleRetry = useCallback(() => {
        analysis.resetAnalysis();
        setPhase("url_input");
    }, [analysis]);

    const handleSkip = useCallback(() => {
        // Skip to profile review with empty agents
        setSuggestedAgents([]);
        setBusinessName(clientName || "My Business");
        setIndustry("general");
        setPhase("profile_review");
    }, [clientName]);

    // ─── PHASE 3: PROFILE REVIEW → AGENT FLEET ───
    const handleProfileContinue = useCallback(async () => {
        setPhase("agent_fleet");

        // Fire-and-forget flow generation for all enabled agents
        flowsHook.generateAllFlows(enabledAgents, profileForm.form);
    }, [enabledAgents, profileForm.form, flowsHook]);

    const handleBackToProfile = useCallback(() => {
        setPhase("profile_review");
    }, []);

    // ─── PHASE 4: AGENT FLEET ACTIONS ───
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

    // ─── CONVERSATION FLOW HANDLERS ───
    const handleRegenerateFlow = useCallback(
        (agentTypeId: string) => {
            const agent = suggestedAgents.find((a) => a.type_id === agentTypeId);
            if (agent) {
                flowsHook.generateFlowForAgent(
                    agentTypeId,
                    agent.name,
                    agent.purpose || agent.description,
                    agent.direction || "inbound",
                    profileForm.form
                );
            }
        },
        [suggestedAgents, flowsHook, profileForm.form]
    );

    // ─── CHAT ───
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
                            purpose: (changes.purpose as string) || "",
                            direction: (changes.direction as "inbound" | "outbound") || "outbound",
                        };
                        next.push(newAgent);
                        break;
                    }
                }
            }

            return next;
        });
    }, []);

    // ─── DEPLOY ───
    const handleDeploy = useCallback(async () => {
        setPhase("deploying");
        setChatOpen(false);

        // Build profile FormData
        const formData = profileForm.buildFormData();

        // Add business name if missing
        if (!formData.get("business_name")) {
            formData.set("business_name", businessName);
        }
        if (!formData.get("industry")) {
            formData.set("industry", industry);
        }
        if (!formData.get("website_url") && websiteUrl) {
            formData.set("website_url", websiteUrl);
        }

        // Serialize conversation flows
        const flowsText = flowsHook.getAllFlowsAsText();

        const result = await deployment.deploy(enabledAgents, formData, flowsText);

        if (result && result.success) {
            setTimeout(() => setPhase("success"), 1500);
        }
    }, [profileForm, businessName, industry, websiteUrl, deployment, enabledAgents, flowsHook]);

    // ─── RENDER ───
    return (
        <div className="fixed inset-0 z-50 bg-gray-50">
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

                {phase === "profile_review" && (
                    <motion.div
                        key="profile_review"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <ProfileReview
                            form={profileForm.form}
                            fieldMeta={profileForm.fieldMeta}
                            businessName={businessName}
                            updateField={profileForm.updateField}
                            resetFieldToAI={profileForm.resetFieldToAI}
                            addJobType={profileForm.addJobType}
                            updateJobType={profileForm.updateJobType}
                            removeJobType={profileForm.removeJobType}
                            updateServiceAreaCities={profileForm.updateServiceAreaCities}
                            updateServiceAreaZips={profileForm.updateServiceAreaZips}
                            updateServiceAreaRadius={profileForm.updateServiceAreaRadius}
                            updateHours={profileForm.updateHours}
                            toggleLeadSource={profileForm.toggleLeadSource}
                            onContinue={handleProfileContinue}
                        />
                    </motion.div>
                )}

                {phase === "agent_fleet" && (
                    <motion.div
                        key="agent_fleet"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AgentFleet
                            businessName={businessName}
                            industry={industry}
                            suggestedAgents={suggestedAgents}
                            flows={flowsHook.flows}
                            generatingFlow={flowsHook.generatingFlow}
                            onToggleAgent={handleToggleAgent}
                            onCustomizeAgent={handleCustomizeAgent}
                            onDeploy={handleDeploy}
                            onOpenChat={() => {
                                setFocusedAgentName(undefined);
                                setChatOpen(true);
                            }}
                            onBackToProfile={handleBackToProfile}
                            onUpdateFlowStep={(agentTypeId, stepId, text) =>
                                flowsHook.updateStep(agentTypeId, stepId, text)
                            }
                            onAddFlowStep={(agentTypeId) => flowsHook.addStep(agentTypeId)}
                            onRemoveFlowStep={(agentTypeId, stepId) =>
                                flowsHook.removeStep(agentTypeId, stepId)
                            }
                            onReorderFlowSteps={(agentTypeId, from, to) =>
                                flowsHook.reorderSteps(agentTypeId, from, to)
                            }
                            onRegenerateFlow={handleRegenerateFlow}
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
