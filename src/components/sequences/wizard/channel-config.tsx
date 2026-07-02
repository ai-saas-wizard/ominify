"use client";

import { motion } from "framer-motion";
import {
    MessageSquare,
    Mail,
    Phone,
    AlertCircle,
    Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import type { ChannelReadiness } from "@/app/actions/sequence-actions";
import type { ChannelConfig as ChannelConfigType } from "./types";
import { CADENCE_LABELS, DURATION_OPTIONS } from "./constants";

interface ChannelConfigProps {
    config: ChannelConfigType;
    readiness: ChannelReadiness;
    outboundAgents: { id: string; name: string; vapi_id: string | null }[];
    agentId: string | null;
    onAgentChange: (agentId: string) => void;
    onChange: (config: ChannelConfigType) => void;
}

const CHANNELS = [
    {
        key: "sms" as const,
        label: "SMS",
        icon: MessageSquare,
        color: "emerald",
        description: "Text messages to their phone",
    },
    {
        key: "email" as const,
        label: "Email",
        icon: Mail,
        color: "blue",
        description: "Emails to their inbox",
    },
    {
        key: "voice" as const,
        label: "Voice Calls",
        icon: Phone,
        color: "violet",
        description: "AI-powered phone calls",
    },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
    emerald: {
        bg: "bg-emerald-50/50",
        border: "border-emerald-500",
        text: "text-emerald-700",
        iconBg: "bg-emerald-100",
    },
    blue: {
        bg: "bg-blue-50/50",
        border: "border-blue-500",
        text: "text-blue-700",
        iconBg: "bg-blue-100",
    },
    violet: {
        bg: "bg-violet-50/50",
        border: "border-violet-500",
        text: "text-violet-700",
        iconBg: "bg-violet-100",
    },
};

export function ChannelConfigScreen({
    config,
    readiness,
    outboundAgents,
    agentId,
    onAgentChange,
    onChange,
}: ChannelConfigProps) {
    const enabledCount = Object.values(config.channels).filter(Boolean).length;
    const totalTouchpoints = config.cadence * config.duration;
    const cadenceLabel = CADENCE_LABELS[config.cadence] || "Moderate";
    const selectedAgent = outboundAgents.find((a) => a.id === agentId);

    function toggleChannel(key: "sms" | "email" | "voice") {
        const updated = { ...config.channels, [key]: !config.channels[key] };
        // Must have at least one channel
        if (!updated.sms && !updated.email && !updated.voice) return;
        onChange({ ...config, channels: updated });
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">
                    How should we reach them?
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                    Pick your channels, frequency, and duration.
                </p>
            </div>

            {/* Outbound Agent */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-gray-400" />
                    Your AI agent
                </label>
                {outboundAgents.length > 1 ? (
                    <select
                        value={agentId ?? ""}
                        onChange={(e) => onAgentChange(e.target.value)}
                        className="w-full p-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                        {outboundAgents.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700">
                        <span className="font-medium">{selectedAgent?.name || "Your agent"}</span>
                    </div>
                )}
                <p className="text-xs text-gray-400">
                    Drives the voice for calls and the SMS persona for texts.
                </p>
            </div>

            {/* Channel Toggles */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Channels</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {CHANNELS.map((ch, i) => {
                        const isOn = config.channels[ch.key];
                        const colors = COLOR_MAP[ch.color];
                        // Voice is scoped to the selected agent — creation
                        // intersects on the bound agent's capability.
                        const agentLacksVoice =
                            ch.key === "voice" && !!selectedAgent && !selectedAgent.vapi_id;
                        const notReady = !readiness[ch.key].ready || agentLacksVoice;
                        const notReadyReason = agentLacksVoice
                            ? "This agent has no voice assistant"
                            : readiness[ch.key].reason || "Not configured";

                        return (
                            <motion.button
                                key={ch.key}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05 }}
                                onClick={() => !notReady && toggleChannel(ch.key)}
                                disabled={notReady}
                                className={cn(
                                    "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-150",
                                    notReady && "opacity-50 cursor-not-allowed",
                                    isOn
                                        ? `${colors.bg} ${colors.border} shadow-sm`
                                        : "border-gray-200 bg-white hover:border-gray-300"
                                )}
                            >
                                <div
                                    className={cn(
                                        "p-2.5 rounded-xl transition-colors",
                                        isOn ? colors.iconBg : "bg-gray-100"
                                    )}
                                >
                                    <ch.icon
                                        className={cn(
                                            "w-5 h-5 transition-colors",
                                            isOn ? colors.text : "text-gray-400"
                                        )}
                                    />
                                </div>
                                <span
                                    className={cn(
                                        "text-sm font-medium",
                                        isOn ? colors.text : "text-gray-500"
                                    )}
                                >
                                    {ch.label}
                                </span>
                                <span className="text-xs text-gray-400">
                                    {ch.description}
                                </span>
                                {notReady && (
                                    <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                                        <AlertCircle className="w-3 h-3 shrink-0" />
                                        {notReadyReason}
                                    </div>
                                )}
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            {/* Cadence Slider */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                        Touchpoints per week
                    </label>
                    <span className="text-sm font-semibold text-emerald-600">
                        {config.cadence}/week
                        <span className="text-xs font-normal text-gray-400 ml-1.5">
                            {cadenceLabel}
                        </span>
                    </span>
                </div>
                <Slider
                    value={[config.cadence]}
                    min={1}
                    max={5}
                    step={1}
                    onValueChange={([val]) => onChange({ ...config, cadence: val })}
                    className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 px-0.5">
                    <span>1 - Gentle</span>
                    <span>5 - Persistent</span>
                </div>
            </div>

            {/* Duration Select */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Run for</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {DURATION_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => onChange({ ...config, duration: opt.value })}
                            className={cn(
                                "px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                                config.duration === opt.value
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                            )}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-gray-50 rounded-xl p-4 border border-gray-200"
            >
                <p className="text-sm text-gray-600">
                    Your AI will make roughly{" "}
                    <span className="font-semibold text-gray-900">
                        {totalTouchpoints} touchpoints
                    </span>{" "}
                    over{" "}
                    <span className="font-semibold text-gray-900">
                        {config.duration} week{config.duration !== 1 ? "s" : ""}
                    </span>{" "}
                    across{" "}
                    <span className="font-semibold text-gray-900">
                        {enabledCount} channel{enabledCount !== 1 ? "s" : ""}
                    </span>
                    , with intelligent timing and channel distribution.
                </p>
            </motion.div>
        </div>
    );
}
