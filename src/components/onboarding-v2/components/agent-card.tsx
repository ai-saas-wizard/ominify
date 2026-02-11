"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
    Phone, Zap, CalendarCheck, UserX, Star, Heart,
    Filter, TrendingUp, Megaphone, ClipboardCheck, Users,
    Bot, ChevronDown, MessageSquare, Lock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG, CONFIDENCE_CONFIG } from "../constants";
import type { SuggestedAgent } from "../types";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Phone, Zap, CalendarCheck, UserX, Star, Heart,
    Filter, TrendingUp, Megaphone, ClipboardCheck, Users, Bot,
};

interface AgentCardProps {
    agent: SuggestedAgent;
    onToggle: (enabled: boolean) => void;
    onCustomize: () => void;
}

export function AgentCard({ agent, onToggle, onCustomize }: AgentCardProps) {
    const [expanded, setExpanded] = useState(false);

    const Icon = ICON_MAP[agent.icon] || Bot;
    const category = CATEGORY_CONFIG[agent.category];
    const confidence = CONFIDENCE_CONFIG[agent.confidence_label];
    const isRequired = agent.type_id === "inbound_receptionist";

    return (
        <motion.div
            layout
            className={cn(
                "rounded-xl border bg-zinc-900/50 transition-colors",
                agent.enabled
                    ? "border-zinc-700/50"
                    : "border-zinc-800/50 opacity-60"
            )}
        >
            <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <div
                            className={cn(
                                "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                                category.bgColor
                            )}
                        >
                            <Icon className={cn("h-5 w-5", category.color)} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                            <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2">
                                {agent.description}
                            </p>
                        </div>
                    </div>

                    {isRequired ? (
                        <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400 ring-1 ring-violet-500/20">
                            <Lock className="h-3 w-3" />
                            Required
                        </span>
                    ) : (
                        <Switch
                            checked={agent.enabled}
                            onCheckedChange={onToggle}
                        />
                    )}
                </div>

                {/* Badges row */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                        className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                            category.bgColor, category.color, category.borderColor
                        )}
                    >
                        {category.label}
                    </span>
                    <span
                        className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                            confidence.bgColor, confidence.color, confidence.borderColor
                        )}
                    >
                        {confidence.label}
                    </span>
                    {agent.is_custom && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20">
                            Custom
                        </span>
                    )}
                </div>

                {/* Sequence summary */}
                {agent.sequence_summary && (
                    <p className="mt-2.5 text-[11px] text-zinc-500">
                        {agent.sequence_summary}
                    </p>
                )}

                {/* Action row */}
                <div className="mt-3 flex items-center gap-2">
                    <button
                        onClick={onCustomize}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10"
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Customize
                    </button>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                    >
                        Details
                        <ChevronDown
                            className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                expanded && "rotate-180"
                            )}
                        />
                    </button>
                </div>
            </div>

            {/* Expanded details */}
            <AnimatedExpand expanded={expanded}>
                <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400">
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-zinc-500">Voice</span>
                            <span>{agent.voice_name}</span>
                        </div>
                        {agent.override_variables.length > 0 && (
                            <div>
                                <span className="text-zinc-500">Dynamic variables:</span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {agent.override_variables.map((v) => (
                                        <span
                                            key={v.name}
                                            className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400"
                                        >
                                            {`{{${v.name}}}`}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {agent.custom_instructions && (
                            <div>
                                <span className="text-zinc-500">Custom instructions:</span>
                                <p className="mt-1 text-zinc-300">{agent.custom_instructions}</p>
                            </div>
                        )}
                    </div>
                </div>
            </AnimatedExpand>
        </motion.div>
    );
}

function AnimatedExpand({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
    return (
        <motion.div
            initial={false}
            animate={{
                height: expanded ? "auto" : 0,
                opacity: expanded ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
        >
            {children}
        </motion.div>
    );
}
