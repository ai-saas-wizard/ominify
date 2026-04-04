"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    Loader2,
    Rocket,
    X,
    Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { createSequenceFromWizard } from "@/app/actions/sequence-actions";

// ─── Props ───

interface SequenceWizardProps {
    clientId: string;
    hasAgent: boolean;
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

function getDefaultState(): WizardState {
    return {
        goal: null,
        customGoalDescription: "",
        channelConfig: {
            channels: { sms: true, email: true, voice: true },
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
    hasAgent,
    tenantProfile,
    onClose,
}: SequenceWizardProps) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);
    const [state, setState] = useState<WizardState>(getDefaultState);
    const [simulation, setSimulation] = useState<SimulationScenario | null>(null);
    const [simLoading, setSimLoading] = useState(false);
    const [activating, setActivating] = useState(false);
    const [activated, setActivated] = useState(false);

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
                return Object.values(state.channelConfig.channels).some(Boolean);
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
        if (!state.goal || !simulation) return;
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
                channels: state.channelConfig.channels,
                cadence: state.channelConfig.cadence,
                duration: state.channelConfig.duration,
                handoffRules: state.handoffRules,
                stepBriefs,
            });

            if (result.success) {
                setActivated(true);
                setTimeout(() => {
                    onClose();
                    if (result.sequenceId) {
                        router.push(`/client/${clientId}/sequences/${result.sequenceId}`);
                    }
                    router.refresh();
                }, 2000);
            } else {
                alert(result.error || "Failed to activate sequence");
            }
        } catch {
            alert("An error occurred while activating.");
        } finally {
            setActivating(false);
        }
    }, [state, simulation, clientId, router, onClose]);

    // Success screen
    if (activated) {
        const goalCard = GOAL_CARDS.find((g) => g.id === state.goal);
        return (
            <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-center space-y-4 max-w-md px-6"
                >
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", delay: 0.2 }}
                        className="inline-flex p-4 bg-emerald-100 rounded-2xl"
                    >
                        <Check className="w-10 h-10 text-emerald-600" />
                    </motion.div>
                    <h2 className="text-2xl font-bold text-gray-900">
                        Your AI is live
                    </h2>
                    <p className="text-gray-500">
                        {goalCard
                            ? `Now actively: ${goalCard.title.toLowerCase()}.`
                            : "Your sequence is now active."}{" "}
                        You'll be notified when leads engage.
                    </p>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between max-w-3xl mx-auto">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
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
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                                        i === step
                                            ? "bg-emerald-100 text-emerald-700"
                                            : i < step
                                            ? "bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer"
                                            : "bg-gray-50 text-gray-400"
                                    )}
                                >
                                    {i < step ? (
                                        <Check className="w-3 h-3" />
                                    ) : (
                                        <span className="w-4 text-center">{i + 1}</span>
                                    )}
                                    <span className="hidden sm:inline">{ws.label}</span>
                                </button>
                                {i < WIZARD_STEPS.length - 1 && (
                                    <div
                                        className={cn(
                                            "w-6 h-0.5 rounded-full transition-colors",
                                            i < step ? "bg-emerald-300" : "bg-gray-200"
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
                                    onSelectGoal={handleSelectGoal}
                                    onCustomDescriptionChange={(desc) =>
                                        setState((s) => ({ ...s, customGoalDescription: desc }))
                                    }
                                />
                            )}
                            {step === 1 && (
                                <ChannelConfigScreen
                                    config={state.channelConfig}
                                    hasAgent={hasAgent}
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
                <div className="max-w-2xl mx-auto flex items-center justify-between">
                    <button
                        onClick={goBack}
                        disabled={step === 0}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                            step === 0
                                ? "text-gray-300 cursor-not-allowed"
                                : "text-gray-600 hover:bg-gray-100"
                        )}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>

                    {step < 3 ? (
                        <button
                            onClick={goNext}
                            disabled={!canProceed}
                            className={cn(
                                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all",
                                canProceed
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            )}
                        >
                            {step === 2 ? "Generate Preview" : "Next"}
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleActivate}
                            disabled={activating || !simulation}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-50"
                        >
                            {activating ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Activating...
                                </>
                            ) : (
                                <>
                                    <Rocket className="w-4 h-4" />
                                    Activate
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
