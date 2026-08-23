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
    Zap,
    CalendarClock,
} from "lucide-react";
import { TestNowDialog } from "./test-now-dialog";
import { callingScheduleSummary } from "@/components/sequences/calling-schedule-card";
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
import { cn } from "@/lib/utils";
import { seqFocusRing, seqBtnSecondary } from "@/components/sequences/theme";

interface FlowToolbarProps {
    clientId: string;
    sequenceId: string;
    sequence: any;
    isActive: boolean;
    enrollments?: any[];
    sidebarTab: string | null;
    onSidebarToggle: (tab: string | null) => void;
    onOpenAIDialog: () => void;
}

export function FlowToolbar({
    clientId,
    sequenceId,
    sequence,
    isActive,
    enrollments = [],
    sidebarTab,
    onSidebarToggle,
    onOpenAIDialog,
}: FlowToolbarProps) {
    const router = useRouter();
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testOpen, setTestOpen] = useState(false);
    const [mutationEnabled, setMutationEnabled] = useState(
        sequence?.enable_adaptive_mutation || false
    );
    const [mutationAggressiveness, setMutationAggressiveness] = useState(
        sequence?.mutation_aggressiveness || "moderate"
    );
    const [savingMutation, setSavingMutation] = useState(false);
    const scheduleSummary = callingScheduleSummary(sequence);

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
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="m-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
            >
                {/* Back + name */}
                <Link
                    href={`/client/${clientId}/sequences`}
                    className={cn(
                        "rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900",
                        seqFocusRing
                    )}
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <h2 className="max-w-[160px] truncate text-sm font-semibold text-gray-900">
                    {sequence.name}
                </h2>
                {/* This canvas is the advanced/legacy editor, only static
                    sequences reach it (dynamic ones get the observability view). */}
                <Badge variant="secondary" className="h-5 px-1.5 py-0 text-xs font-normal text-gray-500">
                    Manual
                </Badge>

                <Separator orientation="vertical" className="h-6" />

                {/* Active toggle */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={handleToggleActive}
                                disabled={toggling}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50",
                                    seqFocusRing
                                )}
                            >
                                <div className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-gray-300"}`} />
                                {toggling ? "..." : isActive ? "Active" : "Inactive"}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Toggle sequence active/inactive</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Test now */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setTestOpen(true)}
                                className={cn(seqBtnSecondary, "px-2.5 py-1 text-xs")}
                            >
                                <Zap className="h-3.5 w-3.5 text-gray-400" />
                                Test now
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Fire a test call to a phone number, bypasses pacing &amp; quiet-hours</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Read-only calling-schedule summary, the editable controls
                    live in the Info sidebar. */}
                {scheduleSummary && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium tabular-nums text-gray-600">
                                    <CalendarClock className="h-3 w-3 text-gray-400" />
                                    {scheduleSummary}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>
                                Voice dialing limit &amp; window (business timezone)
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                <Separator orientation="vertical" className="h-6" />

                {/* AI Mutation */}
                <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-600">AI</span>
                    <Switch
                        checked={mutationEnabled}
                        onCheckedChange={handleMutationToggle}
                        disabled={savingMutation}
                        className="h-5 w-9 data-[state=checked]:bg-emerald-600"
                    />
                    {mutationEnabled && (
                        <Select
                            value={mutationAggressiveness}
                            onValueChange={handleAggressivenessChange}
                            disabled={savingMutation}
                        >
                            <SelectTrigger className="h-7 w-[110px] border-gray-200 text-xs">
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
                                className={cn(
                                    "flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900",
                                    seqFocusRing
                                )}
                            >
                                <Brain className="h-4 w-4" />
                            </Link>
                        </TooltipTrigger>
                        <TooltipContent>Learning Dashboard</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* AI Generate Steps */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onOpenAIDialog}
                                className="h-8 w-8 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                            >
                                <Sparkles className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Generate steps with AI</TooltipContent>
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
                                        className={`h-8 w-8 ${
                                            sidebarTab === item.key
                                                ? "bg-gray-900 text-white hover:bg-gray-800"
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

            <TestNowDialog
                open={testOpen}
                onOpenChange={setTestOpen}
                sequenceId={sequenceId}
                clientId={clientId}
                enrollments={enrollments}
            />
        </Panel>
    );
}
