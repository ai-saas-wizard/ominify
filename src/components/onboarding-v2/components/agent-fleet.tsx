"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Phone, Zap, CalendarCheck, UserX, Star, Heart,
    Filter, TrendingUp, Megaphone, ClipboardCheck, Users,
    Bot, MessageSquare, Rocket, ArrowLeft, Plus, Lock,
    ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG, CONFIDENCE_CONFIG } from "../constants";
import { ConversationFlowEditor } from "./conversation-flow-editor";
import type { SuggestedAgent, ConversationFlowStep, AgentCategory } from "../types";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Phone, Zap, CalendarCheck, UserX, Star, Heart,
    Filter, TrendingUp, Megaphone, ClipboardCheck, Users, Bot,
};

// ─── PROPS ───

interface AgentFleetProps {
    businessName: string;
    industry: string;
    suggestedAgents: SuggestedAgent[];
    flows: Record<string, ConversationFlowStep[]>;
    generatingFlow: Record<string, boolean>;
    onToggleAgent: (agentTypeId: string, enabled: boolean) => void;
    onCustomizeAgent: (agentTypeId: string) => void;
    onDeploy: () => void;
    onOpenChat: () => void;
    onBackToProfile: () => void;
    onUpdateFlowStep: (agentTypeId: string, stepId: string, text: string) => void;
    onAddFlowStep: (agentTypeId: string) => void;
    onRemoveFlowStep: (agentTypeId: string, stepId: string) => void;
    onReorderFlowSteps: (agentTypeId: string, from: number, to: number) => void;
    onRegenerateFlow: (agentTypeId: string) => void;
    deploying: boolean;
}

// ─── AGENT CARD (with flow editor) ───

function FleetAgentCard({
    agent,
    flow,
    generatingFlow,
    onToggle,
    onCustomize,
    onUpdateFlowStep,
    onAddFlowStep,
    onRemoveFlowStep,
    onReorderFlowSteps,
    onRegenerateFlow,
}: {
    agent: SuggestedAgent;
    flow: ConversationFlowStep[];
    generatingFlow: boolean;
    onToggle: (enabled: boolean) => void;
    onCustomize: () => void;
    onUpdateFlowStep: (stepId: string, text: string) => void;
    onAddFlowStep: () => void;
    onRemoveFlowStep: (stepId: string) => void;
    onReorderFlowSteps: (from: number, to: number) => void;
    onRegenerateFlow: () => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const Icon = ICON_MAP[agent.icon] || Bot;
    const category = CATEGORY_CONFIG[agent.category] || CATEGORY_CONFIG.inbound;
    const confidence = CONFIDENCE_CONFIG[agent.confidence_label];
    const isInbound = agent.direction === "inbound" || agent.type_id.includes("inbound");

    return (
        <motion.div
            layout
            className={cn(
                "rounded-xl border bg-white shadow-sm transition-colors",
                agent.enabled ? "border-gray-200" : "border-gray-100 opacity-60"
            )}
        >
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", category.bgColor)}>
                            <Icon className={cn("h-5 w-5", category.color)} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-gray-900">{agent.name}</h3>
                            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{agent.description}</p>
                        </div>
                    </div>
                    {isInbound && agent.confidence >= 1.0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-600 ring-1 ring-violet-200">
                            <Lock className="h-3 w-3" />
                            Required
                        </span>
                    ) : (
                        <Switch checked={agent.enabled} onCheckedChange={onToggle} />
                    )}
                </div>

                {/* Badges */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", category.bgColor, category.color, category.borderColor)}>
                        {category.label}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", confidence.bgColor, confidence.color, confidence.borderColor)}>
                        {confidence.label}
                    </span>
                    <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                        agent.direction === "inbound"
                            ? "bg-blue-50 text-blue-600 ring-blue-200"
                            : "bg-orange-50 text-orange-600 ring-orange-200"
                    )}>
                        {agent.direction === "inbound" ? "Inbound" : "Outbound"}
                    </span>
                </div>

                {/* Reasoning */}
                {agent.reasoning && (
                    <p className="mt-2.5 text-[11px] text-gray-400 italic">{agent.reasoning}</p>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2">
                    <button
                        onClick={onCustomize}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-50"
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Customize
                    </button>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                    >
                        Conversation Flow
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                    </button>
                </div>
            </div>

            {/* Expanded: Conversation Flow Editor */}
            <motion.div
                initial={false}
                animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
            >
                <div className="border-t border-gray-100 px-4 py-3">
                    <ConversationFlowEditor
                        steps={flow}
                        generating={generatingFlow}
                        onUpdateStep={onUpdateFlowStep}
                        onAddStep={onAddFlowStep}
                        onRemoveStep={onRemoveFlowStep}
                        onReorder={onReorderFlowSteps}
                        onRegenerate={onRegenerateFlow}
                    />
                </div>
            </motion.div>
        </motion.div>
    );
}

// ─── MAIN COMPONENT ───

export function AgentFleet({
    businessName,
    industry,
    suggestedAgents,
    flows,
    generatingFlow,
    onToggleAgent,
    onCustomizeAgent,
    onDeploy,
    onOpenChat,
    onBackToProfile,
    onUpdateFlowStep,
    onAddFlowStep,
    onRemoveFlowStep,
    onReorderFlowSteps,
    onRegenerateFlow,
    deploying,
}: AgentFleetProps) {
    const enabledCount = useMemo(
        () => suggestedAgents.filter((a) => a.enabled).length,
        [suggestedAgents]
    );

    const industryLabel = industry
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            {/* Header */}
            <div className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                                {businessName || "Your Business"}
                            </h1>
                            {industry && (
                                <Badge variant="outline" className="border-gray-200 text-gray-500">
                                    {industryLabel}
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                            Your AI Agent Fleet — {enabledCount} agent{enabledCount !== 1 ? "s" : ""} selected
                        </p>
                    </div>
                    <button
                        onClick={onBackToProfile}
                        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to Profile
                    </button>
                </div>
            </div>

            {/* Agent grid */}
            <div className="flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6">
                <div className="mx-auto max-w-5xl">
                    <p className="mb-5 text-sm text-gray-400">
                        AI-generated agents tailored to your business. Toggle agents on/off,
                        customize via chat, and edit conversation flows before deploying.
                    </p>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <AnimatePresence mode="popLayout">
                            {suggestedAgents.map((agent) => (
                                <motion.div
                                    key={agent.type_id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <FleetAgentCard
                                        agent={agent}
                                        flow={flows[agent.type_id] || []}
                                        generatingFlow={generatingFlow[agent.type_id] || false}
                                        onToggle={(enabled) => onToggleAgent(agent.type_id, enabled)}
                                        onCustomize={() => onCustomizeAgent(agent.type_id)}
                                        onUpdateFlowStep={(stepId, text) => onUpdateFlowStep(agent.type_id, stepId, text)}
                                        onAddFlowStep={() => onAddFlowStep(agent.type_id)}
                                        onRemoveFlowStep={(stepId) => onRemoveFlowStep(agent.type_id, stepId)}
                                        onReorderFlowSteps={(from, to) => onReorderFlowSteps(agent.type_id, from, to)}
                                        onRegenerateFlow={() => onRegenerateFlow(agent.type_id)}
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Fixed bottom bar */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/90 px-4 py-4 backdrop-blur-lg sm:px-6">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div className="text-sm text-gray-500">
                        <span className="font-medium text-gray-900">{enabledCount}</span> agent{enabledCount !== 1 ? "s" : ""} ready to deploy
                    </div>
                    <Button
                        onClick={onDeploy}
                        disabled={deploying || enabledCount === 0}
                        className="bg-violet-600 px-6 text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                        <Rocket className="mr-2 h-4 w-4" />
                        Deploy {enabledCount} Agent{enabledCount !== 1 ? "s" : ""}
                    </Button>
                </div>
            </div>

            {/* Floating chat button */}
            <motion.button
                onClick={onOpenChat}
                className="fixed bottom-24 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-500/20 transition-colors hover:bg-violet-500"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <MessageSquare className="h-6 w-6" />
            </motion.button>
        </div>
    );
}
