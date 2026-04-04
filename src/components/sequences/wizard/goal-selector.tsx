"use client";

import { motion } from "framer-motion";
import {
    PhoneMissed,
    UserRoundSearch,
    Sprout,
    CalendarCheck,
    Receipt,
    PencilLine,
    Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GoalId } from "./types";
import { GOAL_CARDS } from "./constants";

const ICON_MAP: Record<string, typeof PhoneMissed> = {
    "phone-missed": PhoneMissed,
    "user-round-search": UserRoundSearch,
    sprout: Sprout,
    "calendar-check": CalendarCheck,
    receipt: Receipt,
    "pencil-line": PencilLine,
};

const ICON_COLORS: Record<string, { bg: string; text: string }> = {
    "phone-missed": { bg: "bg-red-50", text: "text-red-500" },
    "user-round-search": { bg: "bg-amber-50", text: "text-amber-500" },
    sprout: { bg: "bg-emerald-50", text: "text-emerald-500" },
    "calendar-check": { bg: "bg-blue-50", text: "text-blue-500" },
    receipt: { bg: "bg-violet-50", text: "text-violet-500" },
    "pencil-line": { bg: "bg-gray-50", text: "text-gray-500" },
};

interface GoalSelectorProps {
    selectedGoal: GoalId | null;
    customDescription: string;
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

export function GoalSelector({
    selectedGoal,
    customDescription,
    onSelectGoal,
    onCustomDescriptionChange,
}: GoalSelectorProps) {
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
