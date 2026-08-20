"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    MessageSquare,
    Users,
    Activity,
    Mail,
    Phone,
    Bot,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EnrollmentTable } from "@/components/sequences/enrollment-table";
import { MutationBadge } from "@/components/sequences/mutation-badge";
import { HealingBadge } from "@/components/sequences/healing-badge";
import { getExecutionLog, listOutboundAgents, updateSequence } from "@/app/actions/sequence-actions";
import { CallingScheduleCard } from "@/components/sequences/calling-schedule-card";
import { cn } from "@/lib/utils";

const TRIGGER_LABELS: Record<string, string> = {
    new_lead: "New Lead",
    missed_call: "Missed Call",
    form_submission: "Form Submission",
    manual: "Manual",
    tag_added: "Tag Added",
    status_change: "Status Change",
    schedule: "Schedule",
};

// Urgency as dot+label — only critical/high carry color.
const URGENCY_DOTS: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-amber-500",
    medium: "bg-gray-300",
    low: "bg-gray-300",
};

const CHANNEL_CONFIG: Record<string, { icon: any; label: string }> = {
    sms: { icon: MessageSquare, label: "SMS" },
    email: { icon: Mail, label: "Email" },
    voice: { icon: Phone, label: "Voice Call" },
    voice_call: { icon: Phone, label: "Voice Call" },
};

const DEFAULT_CHANNEL_CONFIG = {
    icon: Activity,
    label: "Step",
};

function logStatusStyle(status: string): { dot: string; text: string } {
    if (status === "delivered" || status === "success" || status === "completed" || status === "sent")
        return { dot: "bg-emerald-500", text: "text-emerald-700" };
    if (status === "failed") return { dot: "bg-red-500", text: "text-red-700" };
    if (status === "pending" || status === "executing")
        return { dot: "bg-sky-500", text: "text-sky-700" };
    return { dot: "bg-gray-300", text: "text-gray-500" };
}

/**
 * Group a flat, time-sorted list of execution-log rows into per-lead sections.
 * Each row carries `_contact` (the contact behind its enrollment) so we can
 * label the group. Insertion order follows first-seen executed_at.
 */
function groupLogsByLead(
    logs: any[]
): { enrollmentId: string; contact: any; logs: any[] }[] {
    const map = new Map<string, { enrollmentId: string; contact: any; logs: any[] }>();
    for (const log of logs) {
        const key = log.enrollment_id || "unknown";
        if (!map.has(key)) {
            map.set(key, { enrollmentId: key, contact: log._contact || null, logs: [] });
        }
        map.get(key)!.logs.push(log);
    }
    return Array.from(map.values());
}

interface FlowSidebarPanelProps {
    activeTab: string;
    sequence: any;
    enrollments: any[];
    sequenceId: string;
    clientId: string;
    onClose: () => void;
}

export function FlowSidebarPanel({
    activeTab,
    sequence,
    enrollments,
    sequenceId,
    clientId,
    onClose,
}: FlowSidebarPanelProps) {
    const [executionLog, setExecutionLog] = useState<any[]>([]);
    const [logLoaded, setLogLoaded] = useState(false);

    // Bound-agent picker (Info tab). The agent drives voice calls + SMS persona.
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    const [agentsLoaded, setAgentsLoaded] = useState(false);
    const [boundAgentId, setBoundAgentId] = useState<string>(sequence.agent_id || "");
    const [savingAgent, setSavingAgent] = useState(false);

    useEffect(() => {
        if (activeTab === "log" && !logLoaded) {
            loadExecutionLog();
        }
        if (activeTab === "info" && !agentsLoaded) {
            listOutboundAgents(clientId).then((list) => {
                setAgents(list);
                setAgentsLoaded(true);
            });
        }
    }, [activeTab]);

    async function loadExecutionLog() {
        const result = await getExecutionLog(sequenceId);
        setExecutionLog(result.data || []);
        setLogLoaded(true);
    }

    async function handleAgentChange(newAgentId: string) {
        const prev = boundAgentId;
        setBoundAgentId(newAgentId); // optimistic
        setSavingAgent(true);
        const fd = new FormData();
        fd.set("agent_id", newAgentId); // "" → unbind
        const res = await updateSequence(sequenceId, fd);
        setSavingAgent(false);
        if (!res?.success) {
            setBoundAgentId(prev); // revert on failure
            alert(res?.error || "Failed to update the bound agent");
        }
    }

    // Keyboard escape handler
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const stats = sequence.enrollment_stats || {
        active: 0,
        paused: 0,
        completed: 0,
        replied: 0,
        booked: 0,
        failed: 0,
        total: 0,
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed bottom-0 right-0 top-0 z-50 flex w-[420px] flex-col border-l border-gray-200 bg-white shadow-lg"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b">
                    <h3 className="text-sm font-semibold text-gray-900">
                        {activeTab === "info" && "Sequence Info"}
                        {activeTab === "enrollments" && "Enrollments"}
                        {activeTab === "log" && "Execution Log"}
                    </h3>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="w-8 h-8 text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {/* Info Tab */}
                    {activeTab === "info" && (
                        <div className="p-5 space-y-5">
                            {/* Name + Description */}
                            <div>
                                <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                                    {sequence.name}
                                </h2>
                                {sequence.description && (
                                    <p className="mt-1 text-sm text-gray-500">
                                        {sequence.description}
                                    </p>
                                )}
                            </div>

                            {/* Meta: trigger chip + urgency/status as dot+label */}
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="inline-flex items-center rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                                    {TRIGGER_LABELS[sequence.trigger_type] || sequence.trigger_type}
                                </span>
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            URGENCY_DOTS[sequence.urgency_tier] || URGENCY_DOTS.medium
                                        )}
                                    />
                                    {sequence.urgency_tier}
                                </span>
                                {sequence.is_active ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
                                        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                                        Inactive
                                    </span>
                                )}
                            </div>

                            <Separator />

                            {/* Bound Agent */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        <Bot className="h-3.5 w-3.5 text-gray-400" />
                                        Bound Agent
                                    </h4>
                                    {savingAgent && (
                                        <span className="flex items-center gap-1 text-xs text-gray-500">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Saving
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 mb-2">
                                    Drives voice calls and the SMS persona for this sequence&apos;s texts.
                                </p>
                                <select
                                    value={boundAgentId}
                                    onChange={(e) => handleAgentChange(e.target.value)}
                                    disabled={savingAgent || !agentsLoaded}
                                    className="w-full rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:ring-2 focus:ring-emerald-600/50 disabled:opacity-60"
                                >
                                    <option value="">Unassigned</option>
                                    {/* Keep the current binding selectable even if it's not in the fetched list. */}
                                    {boundAgentId &&
                                        !agents.some((a) => a.id === boundAgentId) && (
                                            <option value={boundAgentId}>Current agent</option>
                                        )}
                                    {agents.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}
                                        </option>
                                    ))}
                                </select>
                                {agentsLoaded && agents.length === 0 && (
                                    <p className="mt-1.5 text-xs text-gray-400">
                                        No outbound agents yet. Create one from the Agents page to bind it here.
                                    </p>
                                )}
                            </div>

                            <Separator />

                            {/* Calling schedule (daily cap / window / release pace) */}
                            <CallingScheduleCard
                                sequenceId={sequenceId}
                                sequence={sequence}
                                className="border-none p-0"
                            />

                            <Separator />

                            {/* Enrollment stats grid */}
                            <div>
                                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Enrollment Stats
                                </h4>
                                <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                                    {[
                                        { label: "Active", value: stats.active, dot: "bg-sky-500" },
                                        { label: "Paused", value: stats.paused, dot: "bg-amber-500" },
                                        { label: "Completed", value: stats.completed },
                                        { label: "Replied", value: stats.replied },
                                        { label: "Booked", value: stats.booked },
                                        { label: "Failed", value: stats.failed, dot: "bg-red-500" },
                                    ].map((stat) => (
                                        <div key={stat.label}>
                                            <p className="flex items-center gap-1.5 text-xs text-gray-500">
                                                {stat.dot && (
                                                    <span className={cn("h-1.5 w-1.5 rounded-full", stat.dot)} />
                                                )}
                                                {stat.label}
                                            </p>
                                            <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">
                                                {stat.value}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Summary */}
                            <div className="space-y-1 text-xs text-gray-500">
                                <p>
                                    <span className="font-medium text-gray-700">Total enrolled:</span>{" "}
                                    <span className="tabular-nums">{stats.total}</span>
                                </p>
                                <p>
                                    <span className="font-medium text-gray-700">Steps:</span>{" "}
                                    <span className="tabular-nums">{sequence.sequence_steps?.length || 0}</span>
                                </p>
                                {sequence.created_at && (
                                    <p>
                                        <span className="font-medium text-gray-700">Created:</span>{" "}
                                        {new Date(sequence.created_at).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Enrollments Tab */}
                    {activeTab === "enrollments" && (
                        <div className="p-4">
                            <EnrollmentTable enrollments={enrollments} />
                        </div>
                    )}

                    {/* Log Tab */}
                    {activeTab === "log" && (
                        <div className="p-4">
                            {!logLoaded ? (
                                <div className="space-y-2" aria-busy="true" aria-label="Loading execution log">
                                    {[0, 1, 2, 3].map((i) => (
                                        <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <Skeleton className="h-4 w-20" />
                                                <Skeleton className="h-4 w-16" />
                                            </div>
                                            <Skeleton className="mt-2 h-3 w-36" />
                                        </div>
                                    ))}
                                </div>
                            ) : executionLog.length === 0 ? (
                                <div className="py-12 text-center text-gray-400">
                                    <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                                    <p className="text-sm">No execution history yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    {groupLogsByLead(executionLog).map((group) => (
                                        <div key={group.enrollmentId} className="space-y-2">
                                            {/* Lead header */}
                                            <div className="flex items-center justify-between px-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    <span className="text-xs font-semibold text-gray-700 truncate">
                                                        {group.contact?.name ||
                                                            group.contact?.phone ||
                                                            `Lead ${group.enrollmentId.substring(0, 8)}`}
                                                    </span>
                                                </div>
                                                <span className="shrink-0 text-xs tabular-nums text-gray-400">
                                                    {group.logs.length} event{group.logs.length === 1 ? "" : "s"}
                                                </span>
                                            </div>

                                            {group.logs.map((log: any) => {
                                                const config = CHANNEL_CONFIG[log.channel] || DEFAULT_CHANNEL_CONFIG;
                                                const Icon = config.icon;
                                                const status = logStatusStyle(log.status);
                                                return (
                                                    <motion.div
                                                        key={log.id}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-3"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <span className="flex items-center gap-1.5">
                                                                    <Icon className="h-3.5 w-3.5 text-gray-400" />
                                                                    <span className="text-xs font-medium text-gray-700">
                                                                        {config.label}
                                                                    </span>
                                                                </span>
                                                                {log.was_mutated && log.mutation && (
                                                                    <MutationBadge
                                                                        originalContent={log.mutation.original_content}
                                                                        mutatedContent={log.mutation.mutated_content}
                                                                        mutationReason={log.mutation.mutation_reason}
                                                                        confidence={log.mutation.confidence_score}
                                                                        model={log.mutation.mutation_model}
                                                                    />
                                                                )}
                                                            </div>
                                                            <span
                                                                className={cn(
                                                                    "inline-flex items-center gap-1.5 text-xs font-medium",
                                                                    status.text
                                                                )}
                                                            >
                                                                <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                                                                {log.status}
                                                            </span>
                                                        </div>
                                                        <div className="font-mono text-xs text-gray-400">
                                                            {new Date(log.executed_at).toLocaleString()}
                                                        </div>
                                                        {log.was_healed && log.healing && (
                                                            <div className="mt-1">
                                                                <HealingBadge
                                                                    failureType={log.healing.failure_type}
                                                                    healingAction={log.healing.healing_action}
                                                                    healingDetails={log.healing.healing_details}
                                                                    failureDetails={log.healing.failure_details}
                                                                />
                                                            </div>
                                                        )}
                                                        {(log.provider_id || log.error_message) && (
                                                            <p
                                                                className={cn(
                                                                    "truncate font-mono text-xs",
                                                                    log.provider_id ? "text-gray-400" : "text-red-600"
                                                                )}
                                                            >
                                                                {log.provider_id || log.error_message}
                                                            </p>
                                                        )}
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
