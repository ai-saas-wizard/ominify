"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@xyflow/react";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    Brain,
    Trash2,
    Sparkles,
    Info,
    Users,
    Activity,
    PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider,
} from "@/components/ui/tooltip";
import {
    toggleSequenceActive,
    deleteSequence,
    updateSequenceMutationSettings,
} from "@/app/actions/sequence-actions";
import Link from "next/link";

interface FlowToolbarProps {
    clientId: string;
    sequenceId: string;
    sequence: any;
    isActive: boolean;
    sidebarTab: string | null;
    onSidebarToggle: (tab: string | null) => void;
}

export function FlowToolbar({
    clientId,
    sequenceId,
    sequence,
    isActive,
    sidebarTab,
    onSidebarToggle,
}: FlowToolbarProps) {
    const router = useRouter();
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [mutationEnabled, setMutationEnabled] = useState(
        sequence?.enable_adaptive_mutation || false
    );
    const [mutationAggressiveness, setMutationAggressiveness] = useState(
        sequence?.mutation_aggressiveness || "moderate"
    );
    const [savingMutation, setSavingMutation] = useState(false);

    async function handleToggleActive() {
        setToggling(true);
        try {
            await toggleSequenceActive(sequenceId, !isActive);
            router.refresh();
        } catch (err) {
            console.error("Toggle error:", err);
        } finally {
            setToggling(false);
        }
    }

    async function handleDelete() {
        if (!confirm("Are you sure you want to delete this sequence? This cannot be undone.")) return;
        setDeleting(true);
        try {
            await deleteSequence(sequenceId);
            router.push(`/client/${clientId}/sequences`);
        } catch (err) {
            console.error("Delete error:", err);
            setDeleting(false);
        }
    }

    async function handleMutationToggle(enabled: boolean) {
        setSavingMutation(true);
        setMutationEnabled(enabled);
        try {
            await updateSequenceMutationSettings(sequenceId, {
                enable_adaptive_mutation: enabled,
            });
            router.refresh();
        } catch (err) {
            console.error("Mutation toggle error:", err);
            setMutationEnabled(!enabled);
        } finally {
            setSavingMutation(false);
        }
    }

    async function handleAggressivenessChange(level: string) {
        setSavingMutation(true);
        setMutationAggressiveness(level);
        try {
            await updateSequenceMutationSettings(sequenceId, {
                mutation_aggressiveness: level,
            });
            router.refresh();
        } catch (err) {
            console.error("Aggressiveness change error:", err);
        } finally {
            setSavingMutation(false);
        }
    }

    return (
        <Panel position="top-left" className="!m-0">
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-xl border shadow-lg px-3 py-2 m-4"
            >
                {/* Back + name */}
                <Link
                    href={`/client/${clientId}/sequences`}
                    className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <h2 className="text-sm font-semibold text-gray-900 max-w-[160px] truncate">
                    {sequence.name}
                </h2>

                <Separator orientation="vertical" className="h-6" />

                {/* Active toggle */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={handleToggleActive}
                                disabled={toggling}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                            >
                                <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
                                {toggling ? "..." : isActive ? "Active" : "Inactive"}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Toggle sequence active/inactive</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <Separator orientation="vertical" className="h-6" />

                {/* AI Mutation */}
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-xs font-medium text-violet-700">AI</span>
                    <Switch
                        checked={mutationEnabled}
                        onCheckedChange={handleMutationToggle}
                        disabled={savingMutation}
                        className="data-[state=checked]:bg-violet-600 h-5 w-9"
                    />
                    {mutationEnabled && (
                        <Select
                            value={mutationAggressiveness}
                            onValueChange={handleAggressivenessChange}
                            disabled={savingMutation}
                        >
                            <SelectTrigger className="h-7 w-[110px] text-xs border-violet-200">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="conservative">Conservative</SelectItem>
                                <SelectItem value="moderate">Moderate</SelectItem>
                                <SelectItem value="aggressive">Aggressive</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <Separator orientation="vertical" className="h-6" />

                {/* Learning Dashboard */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Link
                                href={`/client/${clientId}/sequences/${sequenceId}/learning`}
                                className="flex items-center justify-center w-8 h-8 rounded-lg text-violet-600 hover:bg-violet-50 transition-colors"
                            >
                                <Brain className="w-4 h-4" />
                            </Link>
                        </TooltipTrigger>
                        <TooltipContent>Learning Dashboard</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Delete */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleDelete}
                                disabled={deleting}
                                className="w-8 h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete sequence</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <Separator orientation="vertical" className="h-6" />

                {/* Sidebar toggles */}
                <div className="flex items-center gap-0.5">
                    {[
                        { key: "info", icon: Info, label: "Info" },
                        { key: "enrollments", icon: Users, label: "Enrollments" },
                        { key: "log", icon: Activity, label: "Log" },
                    ].map((item) => (
                        <TooltipProvider key={item.key}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={sidebarTab === item.key ? "default" : "ghost"}
                                        size="icon"
                                        onClick={() =>
                                            onSidebarToggle(sidebarTab === item.key ? null : item.key)
                                        }
                                        className={`w-8 h-8 ${
                                            sidebarTab === item.key
                                                ? "bg-violet-600 text-white hover:bg-violet-700"
                                                : "text-gray-500 hover:text-gray-900"
                                        }`}
                                    >
                                        <item.icon className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{item.label}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ))}
                </div>
            </motion.div>
        </Panel>
    );
}
