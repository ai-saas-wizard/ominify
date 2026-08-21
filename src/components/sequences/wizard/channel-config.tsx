"use client";

import { motion } from "framer-motion";
import {
    MessageSquare,
    Mail,
    Phone,
    AlertCircle,
    Bot,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { seqOption, seqOptionSelected, seqFocusRing } from "@/components/sequences/theme";
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
        description: "Text messages to their phone",
    },
    {
        key: "email" as const,
        label: "Email",
        icon: Mail,
        description: "Emails to their inbox",
    },
    {
        key: "voice" as const,
        label: "Voice Calls",
        icon: Phone,
        description: "AI-powered phone calls",
    },
];

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
        onChange({
            ...config,
            channels: updated,
            // The opener can never be a channel that's switched off.
            firstTouch:
                !updated[key] && config.firstTouch === key ? null : config.firstTouch,
        });
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                    How should we reach them?
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                    Pick your channels, frequency, and duration.
                </p>
            </div>

            {/* Outbound Agent */}
            <div className="space-y-3">
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                    <Bot className="h-4 w-4 text-gray-400" />
                    Your AI agent
                </label>
                {outboundAgents.length > 1 ? (
                    <select
                        value={agentId ?? ""}
                        onChange={(e) => onAgentChange(e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:ring-2 focus:ring-emerald-600/50"
                    >
                        {outboundAgents.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {CHANNELS.map((ch, i) => {
                        const isOn = config.channels[ch.key];
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
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                                onClick={() => !notReady && toggleChannel(ch.key)}
                                disabled={notReady}
                                className={cn(
                                    "relative flex flex-col items-center gap-2 rounded-xl p-4",
                                    seqFocusRing,
                                    notReady && "cursor-not-allowed opacity-50",
                                    isOn ? seqOptionSelected : seqOption
                                )}
                            >
                                <div
                                    className={cn(
                                        "rounded-lg p-2.5 transition-colors",
                                        isOn ? "bg-emerald-100" : "bg-gray-50"
                                    )}
                                >
                                    <ch.icon
                                        className={cn(
                                            "h-5 w-5 transition-colors",
                                            isOn ? "text-emerald-600" : "text-gray-400"
                                        )}
                                    />
                                </div>
                                <span
                                    className={cn(
                                        "text-sm font-medium",
                                        isOn ? "text-gray-900" : "text-gray-500"
                                    )}
                                >
                                    {ch.label}
                                </span>
                                <span className="text-xs text-gray-400">
                                    {ch.description}
                                </span>
                                {notReady && (
                                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                                        <AlertCircle className="h-3 w-3 shrink-0" />
                                        {notReadyReason}
                                    </div>
                                )}
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            {/* First Touch */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">First touch</label>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => onChange({ ...config, firstTouch: null })}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                            seqFocusRing,
                            config.firstTouch === null
                                ? cn(seqOptionSelected, "text-emerald-800")
                                : cn(seqOption, "text-gray-600")
                        )}
                    >
                        <Sparkles
                            className={cn(
                                "h-4 w-4",
                                config.firstTouch === null ? "text-emerald-600" : "text-gray-400"
                            )}
                        />
                        Let the AI decide
                    </button>
                    {CHANNELS.filter((ch) => config.channels[ch.key]).map((ch) => (
                        <button
                            key={ch.key}
                            onClick={() => onChange({ ...config, firstTouch: ch.key })}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                                seqFocusRing,
                                config.firstTouch === ch.key
                                    ? cn(seqOptionSelected, "text-emerald-800")
                                    : cn(seqOption, "text-gray-600")
                            )}
                        >
                            <ch.icon
                                className={cn(
                                    "h-4 w-4",
                                    config.firstTouch === ch.key
                                        ? "text-emerald-600"
                                        : "text-gray-400"
                                )}
                            />
                            {ch.label}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400">
                    The channel your AI opens on. Later steps still adapt to how the
                    lead replies.
                </p>
            </div>

            {/* Cadence Slider */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                        Touchpoints per week
                    </label>
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                        {config.cadence}/week
                        <span className="ml-1.5 text-xs font-normal text-gray-400">
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
                <div className="flex justify-between px-0.5 text-xs text-gray-400">
                    <span>1 - Gentle</span>
                    <span>5 - Persistent</span>
                </div>
            </div>

            {/* Duration Select */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Run for</label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {DURATION_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => onChange({ ...config, duration: opt.value })}
                            className={cn(
                                "rounded-lg px-3 py-2 text-sm font-medium",
                                seqFocusRing,
                                config.duration === opt.value
                                    ? cn(seqOptionSelected, "text-emerald-800")
                                    : cn(seqOption, "text-gray-600")
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
                className="rounded-xl border border-gray-200 bg-gray-50 p-4"
            >
                <p className="text-sm text-gray-600">
                    Your AI will make roughly{" "}
                    <span className="font-semibold tabular-nums text-gray-900">
                        {totalTouchpoints} touchpoints
                    </span>{" "}
                    over{" "}
                    <span className="font-semibold tabular-nums text-gray-900">
                        {config.duration} week{config.duration !== 1 ? "s" : ""}
                    </span>{" "}
                    across{" "}
                    <span className="font-semibold tabular-nums text-gray-900">
                        {enabledCount} channel{enabledCount !== 1 ? "s" : ""}
                    </span>
                    , with intelligent timing and channel distribution.
                </p>
            </motion.div>
        </div>
    );
}
