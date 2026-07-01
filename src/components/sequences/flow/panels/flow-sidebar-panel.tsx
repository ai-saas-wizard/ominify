"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Zap,
    Pause,
    CheckCircle2,
    MessageSquare,
    Users,
    XCircle,
    Activity,
    Mail,
    Phone,
    Bot,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EnrollmentTable } from "@/components/sequences/enrollment-table";
import { MutationBadge } from "@/components/sequences/mutation-badge";
import { HealingBadge } from "@/components/sequences/healing-badge";
import { getExecutionLog, listOutboundAgents, updateSequence } from "@/app/actions/sequence-actions";

const TRIGGER_LABELS: Record<string, string> = {
    new_lead: "New Lead",
    missed_call: "Missed Call",
    form_submission: "Form Submission",
    manual: "Manual",
    tag_added: "Tag Added",
    status_change: "Status Change",
    schedule: "Schedule",
};

const URGENCY_COLORS: Record<string, string> = {
    critical: "bg-red-100 text-red-700 border-red-200",
    high: "bg-orange-100 text-orange-700 border-orange-200",
    medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    low: "bg-green-100 text-green-700 border-green-200",
};

const CHANNEL_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
    sms: { icon: MessageSquare, color: "text-green-600 bg-green-100", label: "SMS" },
    email: { icon: Mail, color: "text-blue-600 bg-blue-100", label: "Email" },
    voice: { icon: Phone, color: "text-emerald-600 bg-emerald-100", label: "Voice Call" },
    voice_call: { icon: Phone, color: "text-emerald-600 bg-emerald-100", label: "Voice Call" },
};

const DEFAULT_CHANNEL_CONFIG = {
    icon: Activity,
    color: "text-gray-600 bg-gray-100",
    label: "Step",
};

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
                className="fixed right-0 top-0 bottom-0 w-[420px] bg-white border-l shadow-2xl z-50 flex flex-col"
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
                                <h2 className="text-lg font-bold text-gray-900">
                                    {sequence.name}
                                </h2>
                                {sequence.description && (
                                    <p className="text-sm text-gray-500 mt-1">
                                        {sequence.description}
                                    </p>
                                )}
                            </div>

                            {/* Meta badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="default" className="bg-emerald-50 text-emerald-600 border-emerald-100">
                                    {TRIGGER_LABELS[sequence.trigger_type] || sequence.trigger_type}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={URGENCY_COLORS[sequence.urgency_tier] || URGENCY_COLORS.medium}
                                >
                                    {sequence.urgency_tier}
                                </Badge>
                                {sequence.is_active ? (
                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1" />
                                        Active
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary">
                                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mr-1" />
                                        Inactive
                                    </Badge>
                                )}
                            </div>

                            <Separator />

                            {/* Bound Agent */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <Bot className="w-3.5 h-3.5" />
                                        Bound Agent
                                    </h4>
                                    {savingAgent && (
                                        <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                                            <Loader2 className="w-3 h-3 animate-spin" />
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
                                    className="w-full p-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
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
                                    <p className="text-[11px] text-gray-400 mt-1.5">
                                        No outbound agents yet. Create one from the Agents page to bind it here.
                                    </p>
                                )}
                            </div>

                            <Separator />

                            {/* Enrollment stats grid */}
                            <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                    Enrollment Stats
                                </h4>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: "Active", value: stats.active, icon: Zap, color: "text-green-600", bg: "bg-green-50" },
                                        { label: "Paused", value: stats.paused, icon: Pause, color: "text-yellow-600", bg: "bg-yellow-50" },
                                        { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-blue-600", bg: "bg-blue-50" },
                                        { label: "Replied", value: stats.replied, icon: MessageSquare, color: "text-emerald-600", bg: "bg-emerald-50" },
                                        { label: "Booked", value: stats.booked, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
                                        { label: "Failed", value: stats.failed, icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
                                    ].map((stat) => (
                                        <div
                                            key={stat.label}
                                            className={`flex items-center gap-2 px-3 py-2.5 ${stat.bg} rounded-lg`}
                                        >
                                            <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
                                            <div>
                                                <p className={`text-[10px] font-medium ${stat.color}`}>
                                                    {stat.label}
                                                </p>
                                                <p className={`text-base font-bold ${stat.color}`}>
                                                    {stat.value}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Summary */}
                            <div className="text-xs text-gray-500 space-y-1">
                                <p>
                                    <span className="font-medium text-gray-700">Total enrolled:</span>{" "}
                                    {stats.total}
                                </p>
                                <p>
                                    <span className="font-medium text-gray-700">Steps:</span>{" "}
                                    {sequence.sequence_steps?.length || 0}
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
                                <div className="text-center py-12 text-gray-400">
                                    <Activity className="w-8 h-8 mx-auto mb-2 animate-pulse" />
                                    <p className="text-sm">Loading execution log...</p>
                                </div>
                            ) : executionLog.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <Activity className="w-8 h-8 mx-auto mb-2" />
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
                                                <span className="text-[10px] text-gray-400 shrink-0">
                                                    {group.logs.length} event{group.logs.length === 1 ? "" : "s"}
                                                </span>
                                            </div>

                                            {group.logs.map((log: any) => {
                                                const config = CHANNEL_CONFIG[log.channel] || DEFAULT_CHANNEL_CONFIG;
                                                return (
                                                    <motion.div
                                                        key={log.id}
                                                        initial={{ opacity: 0, y: 5 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="bg-gray-50 rounded-lg border p-3 space-y-1.5"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-1.5">
                                                                <Badge
                                                                    variant="secondary"
                                                                    className={config.color}
                                                                >
                                                                    {config.label}
                                                                </Badge>
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
                                                            <Badge
                                                                variant="outline"
                                                                className={
                                                                    log.status === "delivered" || log.status === "success" || log.status === "completed"
                                                                        ? "bg-green-50 text-green-700 border-green-200"
                                                                        : log.status === "failed"
                                                                            ? "bg-red-50 text-red-700 border-red-200"
                                                                            : log.status === "pending" || log.status === "executing"
                                                                                ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                                                                : "bg-gray-50 text-gray-600 border-gray-200"
                                                                }
                                                            >
                                                                {log.status}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-[11px] text-gray-500">
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
                                                            <p className="text-[11px] text-gray-400 truncate">
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
