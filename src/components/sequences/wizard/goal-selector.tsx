"use client";

import { motion } from "framer-motion";
import {
    PhoneMissed,
    UserRoundSearch,
    Sprout,
    CalendarCheck,
    Receipt,
    PencilLine,
    Megaphone,
    Target,
    Check,
    Lock,
    Clock,
    ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seqOption, seqOptionSelected, seqFocusRing } from "@/components/sequences/theme";
import type { GoalId, GoalCard as GoalCardType } from "./types";
import { GOAL_CARDS } from "./constants";

const ICON_MAP: Record<string, typeof PhoneMissed> = {
    "phone-missed": PhoneMissed,
    "user-round-search": UserRoundSearch,
    sprout: Sprout,
    "calendar-check": CalendarCheck,
    receipt: Receipt,
    megaphone: Megaphone,
    target: Target,
    "pencil-line": PencilLine,
};

interface GoalSelectorProps {
    selectedGoal: GoalId | null;
    customDescription: string;
    clientId: string;
    metaAdsConnected: boolean;
    googleAdsConnected: boolean;
    onSelectGoal: (goal: GoalId) => void;
    onCustomDescriptionChange: (desc: string) => void;
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.04, delayChildren: 0.05 },
    },
};

const cardVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 300, damping: 30 },
    },
};

function isGoalLocked(
    goal: GoalCardType,
    metaAdsConnected: boolean,
    googleAdsConnected: boolean
): boolean {
    if (goal.requires === "meta_ads") return !metaAdsConnected;
    if (goal.requires === "google_ads") return !googleAdsConnected;
    return false;
}

function lockedLabel(requires: GoalCardType["requires"]): string {
    if (requires === "meta_ads") return "Connect Meta Ads";
    if (requires === "google_ads") return "Connect Google Ads";
    return "Connect integration";
}

export function GoalSelector({
    selectedGoal,
    customDescription,
    clientId,
    metaAdsConnected,
    googleAdsConnected,
    onSelectGoal,
    onCustomDescriptionChange,
}: GoalSelectorProps) {
    const integrationsHref = `/client/${clientId}/settings/integrations`;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                    What do you want to achieve?
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                    Pick a goal and we'll set up everything for you.
                </p>
            </div>

            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
                {GOAL_CARDS.map((goal) => {
                    const Icon = ICON_MAP[goal.icon] || PencilLine;
                    const isSelected = selectedGoal === goal.id;
                    const isComingSoon = goal.comingSoon === true;
                    const isLocked =
                        !isComingSoon && isGoalLocked(goal, metaAdsConnected, googleAdsConnected);

                    if (isComingSoon) {
                        return (
                            <motion.div
                                key={goal.id}
                                variants={cardVariants}
                                aria-disabled="true"
                                className="relative flex cursor-not-allowed items-start gap-3.5 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-4 text-left opacity-80"
                            >
                                <div className="flex-shrink-0 rounded-lg bg-gray-100 p-2.5">
                                    <Icon className="h-5 w-5 text-gray-400" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium text-gray-700">
                                            {goal.title}
                                        </p>
                                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                                            <Clock className="h-2.5 w-2.5" />
                                            Coming soon
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {goal.description}
                                    </p>
                                    <p className="mt-2 text-xs text-gray-500">
                                        Verification with the platform is in progress, we&apos;ll
                                        switch this on as soon as it clears.
                                    </p>
                                </div>
                            </motion.div>
                        );
                    }

                    if (isLocked) {
                        return (
                            <motion.div
                                key={goal.id}
                                variants={cardVariants}
                                className="relative flex items-start gap-3.5 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-4 text-left opacity-80"
                            >
                                <div className="flex-shrink-0 rounded-lg bg-gray-100 p-2.5">
                                    <Icon className="h-5 w-5 text-gray-400" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium text-gray-700">
                                            {goal.title}
                                        </p>
                                        <Lock className="h-3 w-3 text-gray-400" />
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {goal.description}
                                    </p>
                                    <a
                                        href={integrationsHref}
                                        className={cn(
                                            "mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-emerald-600 hover:text-emerald-700",
                                            seqFocusRing
                                        )}
                                    >
                                        {lockedLabel(goal.requires)}
                                        <ArrowUpRight className="h-3 w-3" />
                                    </a>
                                </div>
                            </motion.div>
                        );
                    }

                    return (
                        <motion.button
                            key={goal.id}
                            variants={cardVariants}
                            onClick={() => onSelectGoal(goal.id)}
                            className={cn(
                                "relative flex items-start gap-3.5 rounded-xl p-4 text-left",
                                seqFocusRing,
                                isSelected ? seqOptionSelected : seqOption
                            )}
                        >
                            <div
                                className={cn(
                                    "flex-shrink-0 rounded-lg p-2.5 transition-colors",
                                    isSelected ? "bg-emerald-100" : "bg-gray-50"
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "h-5 w-5 transition-colors",
                                        isSelected ? "text-emerald-600" : "text-gray-500"
                                    )}
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                    {goal.title}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {goal.description}
                                </p>
                            </div>
                            {isSelected && (
                                <motion.div
                                    initial={{ scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                    className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600"
                                >
                                    <Check className="h-3 w-3 text-white" />
                                </motion.div>
                            )}
                        </motion.button>
                    );
                })}
            </motion.div>

            {/* Custom goal text input */}
            {selectedGoal === "custom" && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2"
                >
                    <label className="text-sm font-medium text-gray-700">
                        Describe your goal
                    </label>
                    <textarea
                        value={customDescription}
                        onChange={(e) => onCustomDescriptionChange(e.target.value)}
                        placeholder="e.g., Follow up with leads who attended our open house event but haven't scheduled a showing yet..."
                        rows={3}
                        className="w-full resize-none rounded-lg border border-gray-200 p-3 text-sm outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
                    />
                </motion.div>
            )}
        </div>
    );
}
