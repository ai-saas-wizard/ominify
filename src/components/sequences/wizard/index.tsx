"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    Loader2,
    Rocket,
    X,
    Check,
    Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seqBtnPrimary, seqFocusRing } from "@/components/sequences/theme";
import { useRouter } from "next/navigation";

import type {
    GoalId,
    WizardState,
    ChannelConfig,
    HandoffRulesConfig,
    SimulationScenario,
} from "./types";
import { WIZARD_STEPS, GOAL_CARDS } from "./constants";
import { GoalSelector } from "./goal-selector";
import { ChannelConfigScreen } from "./channel-config";
import { HandoffRulesScreen } from "./handoff-rules";
import { SimulationView } from "./simulation-view";
import { generateSimulation } from "@/app/actions/simulation-actions";
import { createSequenceFromWizard, type ChannelReadiness } from "@/app/actions/sequence-actions";

// ─── Props ───

interface SequenceWizardProps {
    clientId: string;
    /** Deployed outbound agents — sequences act as one of these; required to activate. */
    outboundAgents: { id: string; name: string; vapi_id: string | null }[];
    /** Which channels this tenant can actually send on (server-derived). */
    channelReadiness: ChannelReadiness;
    metaAdsConnected: boolean;
    googleAdsConnected: boolean;
    tenantProfile: {
        industry: string;
        phone: string;
        email: string;
        business_name: string;
    };
    onClose: () => void;
}

// ─── Animation Variants ───

const stepVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 40 : -40,
        opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
        x: direction < 0 ? 40 : -40,
        opacity: 0,
    }),
};

// ─── Default State ───

function getDefaultState(
    readiness: ChannelReadiness,
    defaultAgent: { id: string; vapi_id: string | null } | undefined
): WizardState {
    return {
        goal: null,
        customGoalDescription: "",
        agentId: defaultAgent?.id ?? null,
        channelConfig: {
            // Only channels the tenant can actually send on start enabled.
            // Voice is scoped to the SELECTED agent — creation intersects on
            // that agent's capability, so offering tenant-wide voice for a
            // vapi-less agent would silently drop it at activation.
            channels: {
                sms: readiness.sms.ready,
                email: readiness.email.ready,
                voice: readiness.voice.ready && !!defaultAgent?.vapi_id,
            },
            firstTouch: null,
            cadence: 3,
            duration: 3,
        },
        handoffRules: {
            success_conditions: ["appointment_booked"],
            handoff_triggers: [],
            no_response: {
                max_touchpoints: 6,
                after_sequence: "mark_cold",
            },
            notification: {
                sms: "",
                email: "",
                push: true,
                urgent_call: false,
            },
        },
    };
}

// ─── Component ───

export function SequenceWizard({
    clientId,
    outboundAgents,
    channelReadiness,
    metaAdsConnected,
    googleAdsConnected,
    tenantProfile,
    onClose,
}: SequenceWizardProps) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);
    const [state, setState] = useState<WizardState>(() =>
        getDefaultState(channelReadiness, outboundAgents[0])
    );
    const [simulation, setSimulation] = useState<SimulationScenario | null>(null);
    const [simLoading, setSimLoading] = useState(false);
    const [activating, setActivating] = useState(false);
    const [activated, setActivated] = useState(false);
    const [replacedSequenceName, setReplacedSequenceName] = useState<string | null>(null);

    // Pre-fill notification from tenant profile
    useEffect(() => {
        setState((prev) => ({
            ...prev,
            handoffRules: {
                ...prev.handoffRules,
                notification: {
                    ...prev.handoffRules.notification,
                    sms: tenantProfile.phone || "",
                    email: tenantProfile.email || "",
                },
            },
        }));
    }, [tenantProfile.phone, tenantProfile.email]);

    // Apply goal defaults when goal changes
    const handleSelectGoal = useCallback((goalId: GoalId) => {
        const card = GOAL_CARDS.find((g) => g.id === goalId);
        if (!card) return;

        setState((prev) => ({
            ...prev,
            goal: goalId,
            channelConfig: {
                ...prev.channelConfig,
                cadence: card.defaults.cadence,
                duration: card.defaults.duration,
            },
            handoffRules: {
                ...prev.handoffRules,
                success_conditions: card.defaults.success_conditions,
                no_response: {
                    ...prev.handoffRules.no_response,
                    max_touchpoints: card.defaults.cadence * card.defaults.duration,
                },
            },
        }));
    }, []);

    // Computed
    const maxTouchpoints = state.channelConfig.cadence * state.channelConfig.duration;

    const canProceed = useMemo(() => {
        switch (step) {
            case 0:
                return state.goal !== null && (state.goal !== "custom" || state.customGoalDescription.trim().length > 5);
            case 1:
                return (
                    state.agentId !== null &&
                    Object.values(state.channelConfig.channels).some(Boolean)
                );
            case 2:
                return state.handoffRules.success_conditions.length > 0;
            case 3:
                return simulation !== null;
            default:
                return false;
        }
    }, [step, state, simulation]);

    // Navigation
    const goNext = useCallback(async () => {
        if (step === 2) {
            // Moving to simulation — generate it
            setDirection(1);
            setStep(3);
            setSimLoading(true);
            try {
                const result = await generateSimulation({
                    clientId,
                    goal: state.goal!,
                    customGoalDescription: state.customGoalDescription,
                    channels: state.channelConfig.channels,
                    firstTouch: state.channelConfig.firstTouch,
                    cadence: state.channelConfig.cadence,
                    duration: state.channelConfig.duration,
                    handoffRules: {
                        success_conditions: state.handoffRules.success_conditions,
                        handoff_triggers: state.handoffRules.handoff_triggers,
                    },
                });
                if (result.success && result.scenario) {
                    setSimulation(result.scenario as SimulationScenario);
                } else {
                    setSimError(result.error || "Failed to generate simulation. Try again.");
                }
            } catch (err: any) {
                console.error("Simulation generation error:", err);
                setSimError("Something went wrong. Try again.");
            } finally {
                setSimLoading(false);
            }
        } else {
            setDirection(1);
            setStep((s) => Math.min(s + 1, 3));
        }
    }, [step, state, clientId]);

    const goBack = useCallback(() => {
        setDirection(-1);
        setStep((s) => Math.max(s - 1, 0));
    }, []);

    // Regenerate scenario
    const [simError, setSimError] = useState<string | null>(null);

    const handleRegenerateScenario = useCallback(
        async (type?: string) => {
            setSimLoading(true);
            setSimError(null);
            // Keep the current simulation visible until new one is ready
            try {
                const scenarioType = (type || "positive") as "positive" | "neutral" | "negative" | "opt_out" | "handoff";
                const result = await generateSimulation({
                    clientId,
                    goal: state.goal!,
                    customGoalDescription: state.customGoalDescription,
                    channels: state.channelConfig.channels,
                    firstTouch: state.channelConfig.firstTouch,
                    cadence: state.channelConfig.cadence,
                    duration: state.channelConfig.duration,
                    handoffRules: {
                        success_conditions: state.handoffRules.success_conditions,
                        handoff_triggers: state.handoffRules.handoff_triggers,
                    },
                    scenarioType,
                });
                if (result.success && result.scenario) {
                    setSimulation(result.scenario as SimulationScenario);
                } else {
                    setSimError(result.error || "Failed to generate scenario. Try again.");
                }
            } catch (err: any) {
                console.error("Simulation regeneration error:", err);
                setSimError("Something went wrong. Try again.");
            } finally {
                setSimLoading(false);
            }
        },
        [state, clientId]
    );

    // Activate
    const handleActivate = useCallback(async () => {
        if (!state.goal || !simulation || !state.agentId) return;
        setActivating(true);

        try {
            const stepBriefs = simulation.timeline
                .filter((e) => e.direction === "outbound")
                .map((e) => ({
                    channel: e.channel,
                    intent: e.step_brief?.intent || e.ai_reasoning || "",
                    cta: e.step_brief?.cta || "",
                }));

            const result = await createSequenceFromWizard(clientId, {
                goal: state.goal,
                customGoalDescription: state.customGoalDescription,
                agentId: state.agentId,
                channels: state.channelConfig.channels,
                firstTouch: state.channelConfig.firstTouch,
                cadence: state.channelConfig.cadence,
                duration: state.channelConfig.duration,
                handoffRules: state.handoffRules,
                stepBriefs,
            });

            if (result.success) {
                setActivated(true);
                if (result.replacedSequenceName) {
                    setReplacedSequenceName(result.replacedSequenceName);
                }
                setTimeout(() => {
                    onClose();
                    if (result.sequenceId) {
                        router.push(`/client/${clientId}/sequences/${result.sequenceId}`);
                    }
                    router.refresh();
                }, result.replacedSequenceName ? 3500 : 2000);
            } else {
                alert(result.error || "Failed to activate sequence");
            }
        } catch {
            alert("An error occurred while activating.");
        } finally {
            setActivating(false);
        }
    }, [state, simulation, clientId, router, onClose]);

    // Zero-agent gate: sequences act as an outbound agent — without one the
    // wizard would dead-end at activation, so block up front with a clear CTA.
    if (outboundAgents.length === 0) {
        return (
            <MotionConfig reducedMotion="user">
            <div className="fixed inset-0 z-50 flex flex-col bg-white">
                <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
                    <div className="mx-auto flex max-w-3xl items-center justify-between">
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className={cn(
                                "rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900",
                                seqFocusRing
                            )}
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="w-9" />
                    </div>
                </div>
                <div className="flex flex-1 items-center justify-center">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-md space-y-4 px-6 text-center"
                    >
                        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                            <Bot className="h-6 w-6 text-gray-400" />
                        </div>
                        <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
                            Deploy your AI agent first
                        </h2>
                        <p className="text-gray-500">
                            Sequences are run by your AI agent — it texts and calls
                            leads as your business. Deploy an outbound agent, then
                            come back to launch a sequence.
                        </p>
                        <a
                            href={`/client/${clientId}/agents/new`}
                            className={cn(seqBtnPrimary, "px-6 py-3")}
                        >
                            Set up your agent
                            <ArrowRight className="h-4 w-4" />
                        </a>
                    </motion.div>
                </div>
            </div>
            </MotionConfig>
        );
    }

    // Success screen
    if (activated) {
        const goalCard = GOAL_CARDS.find((g) => g.id === state.goal);
        return (
            <MotionConfig reducedMotion="user">
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-md space-y-4 px-6 text-center"
                >
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.15 }}
                        className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50"
                    >
                        <Check className="h-6 w-6 text-emerald-600" />
                    </motion.div>
                    <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
                        Your AI is live
                    </h2>
                    <p className="text-gray-500">
                        {goalCard
                            ? `Now actively: ${goalCard.title.toLowerCase()}.`
                            : "Your sequence is now active."}{" "}
                        You'll be notified when leads engage.
                    </p>
                    {replacedSequenceName && (
                        <div className="mx-auto mt-4 max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Replaced your previous active sequence{" "}
                            <span className="font-medium">&ldquo;{replacedSequenceName}&rdquo;</span>{" "}
                            — only one ad-platform sequence can be live at a time.
                        </div>
                    )}
                </motion.div>
            </div>
            </MotionConfig>
        );
    }

    return (
        <MotionConfig reducedMotion="user">
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
                <div className="mx-auto flex max-w-3xl items-center justify-between">
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className={cn(
                            "rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900",
                            seqFocusRing
                        )}
                    >
                        <X className="h-5 w-5" />
                    </button>

                    {/* Step Indicators */}
                    <div className="flex items-center gap-2">
                        {WIZARD_STEPS.map((ws, i) => (
                            <div key={ws.label} className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        if (i < step) {
                                            setDirection(-1);
                                            setStep(i);
                                        }
                                    }}
                                    disabled={i > step}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150",
                                        seqFocusRing,
                                        i === step
                                            ? "bg-gray-900 text-white"
                                            : i < step
                                            ? "cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200"
                                            : "bg-gray-50 text-gray-400"
                                    )}
                                >
                                    {i < step ? (
                                        <Check className="h-3 w-3" />
                                    ) : (
                                        <span className="w-4 text-center tabular-nums">{i + 1}</span>
                                    )}
                                    <span className="hidden sm:inline">{ws.label}</span>
                                </button>
                                {i < WIZARD_STEPS.length - 1 && (
                                    <div
                                        className={cn(
                                            "h-px w-6 transition-colors",
                                            i < step ? "bg-gray-400" : "bg-gray-200"
                                        )}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="w-9" /> {/* Spacer for alignment */}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-8">
                    <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                            key={step}
                            custom={direction}
                            variants={stepVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                        >
                            {step === 0 && (
                                <GoalSelector
                                    selectedGoal={state.goal}
                                    customDescription={state.customGoalDescription}
                                    clientId={clientId}
                                    metaAdsConnected={metaAdsConnected}
                                    googleAdsConnected={googleAdsConnected}
                                    onSelectGoal={handleSelectGoal}
                                    onCustomDescriptionChange={(desc) =>
                                        setState((s) => ({ ...s, customGoalDescription: desc }))
                                    }
                                />
                            )}
                            {step === 1 && (
                                <ChannelConfigScreen
                                    config={state.channelConfig}
                                    readiness={channelReadiness}
                                    outboundAgents={outboundAgents}
                                    agentId={state.agentId}
                                    onAgentChange={(agentId) =>
                                        setState((s) => {
                                            // Voice follows the selected agent's capability.
                                            const voiceCapable =
                                                channelReadiness.voice.ready &&
                                                !!outboundAgents.find((a) => a.id === agentId)?.vapi_id;
                                            return {
                                                ...s,
                                                agentId,
                                                channelConfig: {
                                                    ...s.channelConfig,
                                                    channels: {
                                                        ...s.channelConfig.channels,
                                                        voice: s.channelConfig.channels.voice && voiceCapable,
                                                    },
                                                    // Never leave voice as the opener once the
                                                    // new agent can't place calls.
                                                    firstTouch:
                                                        s.channelConfig.firstTouch === "voice" && !voiceCapable
                                                            ? null
                                                            : s.channelConfig.firstTouch,
                                                },
                                            };
                                        })
                                    }
                                    onChange={(channelConfig) =>
                                        setState((s) => ({ ...s, channelConfig }))
                                    }
                                />
                            )}
                            {step === 2 && (
                                <HandoffRulesScreen
                                    config={state.handoffRules}
                                    industry={tenantProfile.industry}
                                    tenantPhone={tenantProfile.phone}
                                    tenantEmail={tenantProfile.email}
                                    maxTouchpoints={maxTouchpoints}
                                    onChange={(handoffRules) =>
                                        setState((s) => ({ ...s, handoffRules }))
                                    }
                                />
                            )}
                            {step === 3 && (
                                <SimulationView
                                    scenario={simulation}
                                    isLoading={simLoading}
                                    error={simError}
                                    onRegenerateScenario={handleRegenerateScenario}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4">
                <div className="mx-auto flex max-w-2xl items-center justify-between">
                    <button
                        onClick={goBack}
                        disabled={step === 0}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors duration-150",
                            seqFocusRing,
                            step === 0
                                ? "cursor-not-allowed text-gray-300"
                                : "text-gray-600 hover:bg-gray-100"
                        )}
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>

                    {step < 3 ? (
                        <button
                            onClick={goNext}
                            disabled={!canProceed}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors duration-150",
                                seqFocusRing,
                                canProceed
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                    : "cursor-not-allowed bg-gray-100 text-gray-400"
                            )}
                        >
                            {step === 2 ? "Generate Preview" : "Next"}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleActivate}
                            disabled={activating || !simulation}
                            className={cn(seqBtnPrimary, "px-6 py-2.5")}
                        >
                            {activating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Activating...
                                </>
                            ) : (
                                <>
                                    <Rocket className="h-4 w-4" />
                                    Activate
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
        </MotionConfig>
    );
}
