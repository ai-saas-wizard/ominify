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
    Clock,
    GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EnrollmentTable } from "@/components/sequences/enrollment-table";
import { MutationBadge } from "@/components/sequences/mutation-badge";
import { HealingBadge } from "@/components/sequences/healing-badge";
import { getExecutionLog } from "@/app/actions/sequence-actions";

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
    voice_call: { icon: Phone, color: "text-violet-600 bg-violet-100", label: "Voice Call" },
    wait: { icon: Clock, color: "text-amber-600 bg-amber-100", label: "Wait / Delay" },
    condition: { icon: GitBranch, color: "text-pink-600 bg-pink-100", label: "Condition" },
};

interface FlowSidebarPanelProps {
    activeTab: string;
    sequence: any;
    enrollments: any[];
    sequenceId: string;
    onClose: () => void;
}

export function FlowSidebarPanel({
    activeTab,
    sequence,
    enrollments,
    sequenceId,
    onClose,
}: FlowSidebarPanelProps) {
    const [executionLog, setExecutionLog] = useState<any[]>([]);
    const [logLoaded, setLogLoaded] = useState(false);

    useEffect(() => {
        if (activeTab === "log" && !logLoaded) {
            loadExecutionLog();
        }
    }, [activeTab]);

    async function loadExecutionLog() {
        const result = await getExecutionLog(sequenceId);
        setExecutionLog(result.data || []);
        setLogLoaded(true);
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
                                <Badge variant="default" className="bg-violet-50 text-violet-600 border-violet-100">
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
                                        { label: "Replied", value: stats.replied, icon: MessageSquare, color: "text-purple-600", bg: "bg-purple-50" },
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
                                <div className="space-y-2">
                                    {executionLog.map((log: any) => {
                                        const config = CHANNEL_CONFIG[log.action_type] || CHANNEL_CONFIG.condition;
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
                                                            log.status === "delivered" || log.status === "success"
                                                                ? "bg-green-50 text-green-700 border-green-200"
                                                                : log.status === "failed"
                                                                    ? "bg-red-50 text-red-700 border-red-200"
                                                                    : log.status === "pending"
                                                                        ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                                                        : "bg-gray-50 text-gray-600 border-gray-200"
                                                        }
                                                    >
                                                        {log.status}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center justify-between text-[11px] text-gray-500">
                                                    <span>
                                                        {new Date(log.executed_at).toLocaleString()}
                                                    </span>
                                                    <span>
                                                        {log.enrollment_id?.substring(0, 8)}...
                                                    </span>
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
                                                {(log.provider_message_id || log.error_message) && (
                                                    <p className="text-[11px] text-gray-400 truncate">
                                                        {log.provider_message_id || log.error_message}
                                                    </p>
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
