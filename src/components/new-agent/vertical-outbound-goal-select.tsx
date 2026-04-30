"use client";

import { motion } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    PhoneOutgoing,
    Repeat,
    UserCheck,
    Calendar,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RE_OUTBOUND_GOALS } from "@/lib/verticals/real-estate-investor/outbound-prompt-templates";
import type { REOutboundGoal } from "@/lib/verticals/types";

interface VerticalOutboundGoalSelectProps {
    onSelect: (goal: REOutboundGoal) => void;
    onBack: () => void;
}

const GOAL_ICONS: Record<
    REOutboundGoal,
    React.ComponentType<{ className?: string }>
> = {
    re_engage_prior_offer: Repeat,
    cold_outreach_motivated_seller: UserCheck,
    missed_appointment_followup: Calendar,
    custom: Sparkles,
};

export function VerticalOutboundGoalSelect({
    onSelect,
    onBack,
}: VerticalOutboundGoalSelectProps) {
    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-3xl"
            >
                <button
                    onClick={onBack}
                    className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <div className="mb-8 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
                        <PhoneOutgoing className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            What should this outbound agent do?
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">
                            Pick a starter goal. You can refine the prompt and
                            scenario in the next step.
                        </p>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    {RE_OUTBOUND_GOALS.map((goal, index) => {
                        const Icon = GOAL_ICONS[goal.value] || PhoneOutgoing;
                        return (
                            <motion.button
                                key={goal.value}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    duration: 0.35,
                                    delay: 0.1 + index * 0.05,
                                }}
                                onClick={() => onSelect(goal.value)}
                                className={cn(
                                    "group relative flex flex-col items-start rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm",
                                    "transition-all duration-200 hover:border-emerald-300 hover:shadow-md"
                                )}
                            >
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                                    <Icon className="h-5 w-5 text-emerald-600" />
                                </div>
                                <h3 className="mt-3 text-sm font-semibold text-gray-900">
                                    {goal.label}
                                </h3>
                                <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                                    {goal.description}
                                </p>
                                <div className="mt-3 flex items-center gap-1 text-xs font-medium text-emerald-600 transition-colors group-hover:text-emerald-700">
                                    Use this goal
                                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                </div>
                            </motion.button>
                        );
                    })}
                </div>
            </motion.div>
        </div>
    );
}
