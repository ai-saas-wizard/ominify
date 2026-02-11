"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Rocket, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentCard } from "./agent-card";
import type { SuggestedAgent } from "../types";

interface AgentMarketplaceProps {
    businessName: string;
    industry: string;
    suggestedAgents: SuggestedAgent[];
    onToggleAgent: (agentTypeId: string, enabled: boolean) => void;
    onCustomizeAgent: (agentTypeId: string) => void;
    onDeploy: () => void;
    onOpenChat: () => void;
    onEditProfile: () => void;
    deploying: boolean;
}

export function AgentMarketplace({
    businessName,
    industry,
    suggestedAgents,
    onToggleAgent,
    onCustomizeAgent,
    onDeploy,
    onOpenChat,
    onEditProfile,
    deploying,
}: AgentMarketplaceProps) {
    const enabledCount = useMemo(
        () => suggestedAgents.filter((a) => a.enabled).length,
        [suggestedAgents]
    );

    const sequenceCount = useMemo(
        () => suggestedAgents.filter((a) => a.enabled && a.sequence_summary).length,
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
                                <Badge
                                    variant="outline"
                                    className="border-gray-200 text-gray-500"
                                >
                                    {industryLabel}
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                            Your AI Agent Fleet — {enabledCount} agent{enabledCount !== 1 ? "s" : ""} selected
                        </p>
                    </div>
                    <button
                        onClick={onEditProfile}
                        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit profile
                    </button>
                </div>
            </div>

            {/* Agent grid */}
            <div className="flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6">
                <div className="mx-auto max-w-5xl">
                    <p className="mb-5 text-sm text-gray-400">
                        Based on our analysis, here are the agents we recommend.
                        Toggle them on or off, or chat with us to customize.
                    </p>

                    <motion.div
                        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                        layout
                    >
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
                                    <AgentCard
                                        agent={agent}
                                        onToggle={(enabled) =>
                                            onToggleAgent(agent.type_id, enabled)
                                        }
                                        onCustomize={() =>
                                            onCustomizeAgent(agent.type_id)
                                        }
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                </div>
            </div>

            {/* Fixed bottom bar */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/90 px-4 py-4 backdrop-blur-lg sm:px-6">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div className="text-sm text-gray-500">
                        <span className="font-medium text-gray-900">{enabledCount}</span> agent{enabledCount !== 1 ? "s" : ""}
                        {sequenceCount > 0 && (
                            <span>
                                {" "}&middot; <span className="font-medium text-gray-900">{sequenceCount}</span> sequence{sequenceCount !== 1 ? "s" : ""}
                            </span>
                        )}
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
