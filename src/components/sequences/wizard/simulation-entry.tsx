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
    sms: {
        icon: MessageSquare,
        label: "SMS",
        outboundBg: "bg-emerald-50",
        outboundBorder: "border-emerald-200",
        outboundText: "text-emerald-700",
        inboundBg: "bg-gray-50",
        inboundBorder: "border-gray-200",
        badgeBg: "bg-emerald-100",
        badgeText: "text-emerald-600",
    },
    email: {
        icon: Mail,
        label: "Email",
        outboundBg: "bg-blue-50",
        outboundBorder: "border-blue-200",
        outboundText: "text-blue-700",
        inboundBg: "bg-gray-50",
        inboundBorder: "border-gray-200",
        badgeBg: "bg-blue-100",
        badgeText: "text-blue-600",
    },
    voice: {
        icon: Phone,
        label: "Voice Call",
        outboundBg: "bg-violet-50",
        outboundBorder: "border-violet-200",
        outboundText: "text-violet-700",
        inboundBg: "bg-gray-50",
        inboundBorder: "border-gray-200",
        badgeBg: "bg-violet-100",
        badgeText: "text-violet-600",
    },
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
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
                type: "spring",
                stiffness: 300,
                damping: 25,
                delay: index * 0.08,
            }}
            className="relative pl-8"
        >
            {/* Timeline dot */}
            <div className="absolute left-0 top-3 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center">
                <div
                    className={cn(
                        "w-4 h-4 rounded-full",
                        isOutbound ? channelCfg.badgeBg : "bg-gray-200"
                    )}
                />
            </div>

            {/* Timeline line */}
            <div className="absolute left-[7px] top-7 bottom-0 w-0.5 bg-gray-200" />

            <div className="pb-6">
                {/* Timestamp + Channel Badge */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-400">
                        Day {entry.day}, {entry.time}
                    </span>
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                            channelCfg.badgeBg,
                            channelCfg.badgeText
                        )}
                    >
                        <Icon className="w-3 h-3" />
                        {channelCfg.label}
                    </span>
                    {!isOutbound && (
                        <span className="text-xs text-gray-400">
                            {firstName} replies
                        </span>
                    )}
                </div>

                {/* Message Bubble */}
                <div
                    className={cn(
                        "rounded-xl px-4 py-3 border max-w-lg",
                        isOutbound
                            ? `${channelCfg.outboundBg} ${channelCfg.outboundBorder}`
                            : `${channelCfg.inboundBg} ${channelCfg.inboundBorder}`
                    )}
                >
                    {isOutbound && entry.channel === "voice" && (
                        <p className="text-xs text-gray-400 mb-1">
                            {agentName} (AI Agent):
                        </p>
                    )}
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                        {entry.content}
                    </p>
                </div>

                {/* AI Reasoning Bubble */}
                {entry.ai_reasoning && (
                    <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                        className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50/60 border border-emerald-100 max-w-lg"
                    >
                        <Brain className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-700">{entry.ai_reasoning}</p>
                    </motion.div>
                )}

                {/* AI Analysis (for inbound) */}
                {entry.ai_analysis && (
                    <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                        className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50/60 border border-blue-100 max-w-lg"
                    >
                        <Zap className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700">{entry.ai_analysis}</p>
                    </motion.div>
                )}

                {/* Adaptation Callout */}
                {entry.adaptation && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 max-w-lg"
                    >
                        <ArrowRight className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                        <p className="text-xs text-amber-700 font-medium">
                            AI adapts: {entry.adaptation}
                        </p>
                    </motion.div>
                )}

                {/* Handoff Notification */}
                {entry.handoff?.triggered && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4, type: "spring" }}
                        className="mt-3 space-y-2"
                    >
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border-2 border-red-200 max-w-lg">
                            <Bell className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-red-700">
                                    HANDOFF — You get notified
                                </p>
                                <p className="text-xs text-red-600 mt-0.5">
                                    {entry.handoff.reason}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-gray-900 max-w-lg">
                            <Bell className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-gray-300 leading-relaxed">
                                {entry.handoff.notification}
                            </p>
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
}
