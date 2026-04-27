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

const ICON_COLORS: Record<string, { bg: string; text: string }> = {
    "phone-missed": { bg: "bg-red-50", text: "text-red-500" },
    "user-round-search": { bg: "bg-amber-50", text: "text-amber-500" },
    sprout: { bg: "bg-emerald-50", text: "text-emerald-500" },
    "calendar-check": { bg: "bg-blue-50", text: "text-blue-500" },
    receipt: { bg: "bg-violet-50", text: "text-violet-500" },
    megaphone: { bg: "bg-rose-50", text: "text-rose-500" },
    target: { bg: "bg-sky-50", text: "text-sky-500" },
    "pencil-line": { bg: "bg-gray-50", text: "text-gray-500" },
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
        transition: { staggerChildren: 0.05, delayChildren: 0.1 },
    },
};

const cardVariants = {
    hidden: { opacity: 0, y: 16, scale: 0.97 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 300, damping: 24 },
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
                <h2 className="text-xl font-semibold text-gray-900">
                    What do you want to achieve?
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                    Pick a goal and we'll set up everything for you.
                </p>
            </div>

            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
                {GOAL_CARDS.map((goal) => {
                    const Icon = ICON_MAP[goal.icon] || PencilLine;
                    const colors = ICON_COLORS[goal.icon] || ICON_COLORS["pencil-line"];
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
                                className="relative flex items-start gap-3.5 p-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/40 text-left opacity-80 cursor-not-allowed"
                            >
                                <div className={cn("flex-shrink-0 p-2.5 rounded-xl", colors.bg)}>
                                    <Icon className={cn("w-5 h-5", colors.text)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <p className="font-medium text-gray-700 text-sm">
                                            {goal.title}
                                        </p>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                            <Clock className="w-2.5 h-2.5" />
                                            Coming soon
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {goal.description}
                                    </p>
                                    <p className="mt-2 text-xs text-gray-500">
                                        Verification with the platform is in progress — we&apos;ll
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
                                className="relative flex items-start gap-3.5 p-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/40 text-left opacity-80"
                            >
                                <div className={cn("flex-shrink-0 p-2.5 rounded-xl", colors.bg)}>
                                    <Icon className={cn("w-5 h-5", colors.text)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <p className="font-medium text-gray-700 text-sm">
                                            {goal.title}
                                        </p>
                                        <Lock className="w-3 h-3 text-gray-400" />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {goal.description}
                                    </p>
                                    <a
                                        href={integrationsHref}
                                        className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                                    >
                                        {lockedLabel(goal.requires)}
                                        <ArrowUpRight className="w-3 h-3" />
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
                                "relative flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all duration-150",
                                isSelected
                                    ? "border-emerald-500 bg-emerald-50/40 shadow-sm"
                                    : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                            )}
                        >
                            <div
                                className={cn(
                                    "flex-shrink-0 p-2.5 rounded-xl transition-colors",
                                    isSelected ? "bg-emerald-100" : colors.bg
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "w-5 h-5 transition-colors",
                                        isSelected ? "text-emerald-600" : colors.text
                                    )}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 text-sm">
                                    {goal.title}
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {goal.description}
                                </p>
                            </div>
                            {isSelected && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="absolute top-3 right-3 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center"
                                >
                                    <Check className="w-3 h-3 text-white" />
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
                        className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none text-sm"
                    />
                </motion.div>
            )}
        </div>
    );
}
