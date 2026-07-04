"use client";

import { motion } from "framer-motion";
import {
    MessageSquare,
    Mail,
    Phone,
    Brain,
    ArrowRight,
    Bell,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SimulationEntry as SimEntryType } from "./types";

const CHANNEL_CONFIG = {
    sms: { icon: MessageSquare, label: "SMS" },
    email: { icon: Mail, label: "Email" },
    voice: { icon: Phone, label: "Voice Call" },
};

interface SimulationEntryProps {
    entry: SimEntryType;
    contactName: string;
    agentName?: string;
    index: number;
    isVisible: boolean;
}

export function SimulationEntryComponent({
    entry,
    contactName,
    agentName = "Sarah",
    index,
    isVisible,
}: SimulationEntryProps) {
    if (!isVisible) return null;

    const channelCfg = CHANNEL_CONFIG[entry.channel];
    const Icon = channelCfg.icon;
    const isOutbound = entry.direction === "outbound";
    const firstName = contactName.split(" ")[0];

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                type: "spring",
                stiffness: 300,
                damping: 28,
                delay: index * 0.06,
            }}
            className="relative pl-8"
        >
            {/* Timeline dot — neutral for the AI's sends, sky for the lead's side */}
            <div
                className={cn(
                    "absolute left-1 top-3.5 h-2 w-2 rounded-full ring-2 ring-white",
                    isOutbound ? "bg-gray-300" : "bg-sky-500"
                )}
            />

            {/* Timeline line */}
            <div className="absolute bottom-0 left-[7px] top-7 w-px bg-gray-200" />

            <div className="pb-6">
                {/* Timestamp + Channel */}
                <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">
                        Day {entry.day}, {entry.time}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
                        <Icon className="h-3 w-3 text-gray-400" />
                        {channelCfg.label}
                    </span>
                    {!isOutbound && (
                        <span className="text-xs text-sky-700">
                            {firstName} replies
                        </span>
                    )}
                </div>

                {/* Message Bubble */}
                <div
                    className={cn(
                        "max-w-lg rounded-xl border px-4 py-3",
                        isOutbound
                            ? "border-gray-200 bg-white"
                            : "border-sky-200 bg-sky-50/40"
                    )}
                >
                    {isOutbound && entry.channel === "voice" && (
                        <p className="mb-1 text-xs text-gray-400">
                            {agentName} (AI Agent):
                        </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                        {entry.content}
                    </p>
                </div>

                {/* AI Reasoning Bubble */}
                {entry.ai_reasoning && (
                    <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                        className="mt-2 flex max-w-lg items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                        <Brain className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <p className="text-xs text-gray-600">{entry.ai_reasoning}</p>
                    </motion.div>
                )}

                {/* AI Analysis (for inbound) */}
                {entry.ai_analysis && (
                    <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                        className="mt-2 flex max-w-lg items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2"
                    >
                        <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-600" />
                        <p className="text-xs text-sky-700">{entry.ai_analysis}</p>
                    </motion.div>
                )}

                {/* Adaptation Callout */}
                {entry.adaptation && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-2 flex max-w-lg items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                    >
                        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                        <p className="text-xs font-medium text-amber-700">
                            AI adapts: {entry.adaptation}
                        </p>
                    </motion.div>
                )}

                {/* Handoff Notification */}
                {entry.handoff?.triggered && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4, type: "spring", stiffness: 300, damping: 25 }}
                        className="mt-3 space-y-2"
                    >
                        <div className="flex max-w-lg items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                            <Bell className="h-4 w-4 flex-shrink-0 text-red-500" />
                            <div>
                                <p className="text-xs font-semibold text-red-700">
                                    HANDOFF — You get notified
                                </p>
                                <p className="mt-0.5 text-xs text-red-600">
                                    {entry.handoff.reason}
                                </p>
                            </div>
                        </div>
                        <div className="flex max-w-lg items-start gap-2 rounded-lg bg-gray-900 px-3 py-2.5">
                            <Bell className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                            <p className="text-xs leading-relaxed text-gray-300">
                                {entry.handoff.notification}
                            </p>
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
}
