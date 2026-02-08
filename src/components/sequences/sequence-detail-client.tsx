"use client";

import { useState } from "react";
import {
    MessageSquare,
    Mail,
    Phone,
    Clock,
    GitBranch,
    Plus,
    Trash2,
    ToggleLeft,
    ToggleRight,
    ChevronDown,
    ChevronUp,
    Activity,
} from "lucide-react";
import {
    toggleSequenceActive,
    deleteSequence,
    deleteSequenceStep,
    getExecutionLog,
} from "@/app/actions/sequence-actions";
import { SequenceStepEditor } from "./sequence-step-editor";
import { EnrollmentTable } from "./enrollment-table";
import { useRouter } from "next/navigation";

const CHANNEL_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
    sms: { icon: MessageSquare, color: "text-green-600 bg-green-100", label: "SMS" },
    email: { icon: Mail, color: "text-blue-600 bg-blue-100", label: "Email" },
    voice_call: { icon: Phone, color: "text-violet-600 bg-violet-100", label: "Voice Call" },
    wait: { icon: Clock, color: "text-amber-600 bg-amber-100", label: "Wait / Delay" },
    condition: { icon: GitBranch, color: "text-pink-600 bg-pink-100", label: "Condition" },
};

const DELAY_LABELS: Record<string, string> = {
    immediate: "Immediately",
    fixed_delay: "After delay",
    business_hours_only: "During business hours",
};

interface Props {
    clientId: string;
    sequenceId: string;
    sequence: any;
    steps: any[];
    enrollments: any[];
    isActive: boolean;
}

export function SequenceDetailClient({
    clientId,
    sequenceId,
    sequence,
    steps,
    enrollments,
    isActive,
}: Props) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"steps" | "enrollments" | "log">("steps");
    const [showAddStep, setShowAddStep] = useState(false);
    const [editingStepId, setEditingStepId] = useState<string | null>(null);
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [executionLog, setExecutionLog] = useState<any[]>([]);
    const [logLoaded, setLogLoaded] = useState(false);

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

    async function handleDeleteStep(stepId: string) {
        if (!confirm("Delete this step?")) return;
        await deleteSequenceStep(stepId);
        router.refresh();
    }

    async function loadExecutionLog() {
        if (logLoaded) return;
        const result = await getExecutionLog(sequenceId);
        setExecutionLog(result.data || []);
        setLogLoaded(true);
    }

    function formatDelay(step: any) {
        if (step.delay_type === "immediate") return "Immediately";
        if (step.delay_amount && step.delay_unit) {
            return `${step.delay_amount} ${step.delay_unit} delay`;
        }
        return DELAY_LABELS[step.delay_type] || step.delay_type;
    }

    const tabs = [
        { key: "steps" as const, label: `Steps (${steps.length})` },
        { key: "enrollments" as const, label: `Enrollments (${enrollments.length})` },
        { key: "log" as const, label: "Execution Log" },
    ];

    return (
        <div className="space-y-4">
            {/* Action Bar */}
            <div className="flex items-center justify-between bg-white rounded-xl border shadow-sm px-5 py-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleToggleActive}
                        disabled={toggling}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                            ? "bg-green-100 text-green-700 hover:bg-green-200"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            } disabled:opacity-50`}
                    >
                        {isActive ? (
                            <ToggleRight className="w-4 h-4" />
                        ) : (
                            <ToggleLeft className="w-4 h-4" />
                        )}
                        {toggling ? "Updating..." : isActive ? "Active" : "Inactive"}
                    </button>
                </div>
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                    <Trash2 className="w-4 h-4" />
                    {deleting ? "Deleting..." : "Delete Sequence"}
                </button>
            </div>

            {/* Tab Bar */}
            <div className="bg-white rounded-xl border shadow-sm">
                <div className="flex border-b">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => {
                                setActiveTab(tab.key);
                                if (tab.key === "log") loadExecutionLog();
                            }}
                            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.key
                                ? "border-violet-600 text-violet-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="p-5">
                    {/* ─── STEPS TAB ─── */}
                    {activeTab === "steps" && (
                        <div className="space-y-1">
                            {steps.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">
                                    <GitBranch className="w-10 h-10 mx-auto mb-2" />
                                    <p>No steps yet. Add your first step below.</p>
                                </div>
                            ) : (
                                <div className="relative">
                                    {/* Vertical timeline line */}
                                    <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-gray-200" />

                                    {steps.map((step, index) => {
                                        const config = CHANNEL_CONFIG[step.action_type] || CHANNEL_CONFIG.condition;
                                        const Icon = config.icon;
                                        const isEditing = editingStepId === step.id;

                                        return (
                                            <div key={step.id} className="relative flex gap-4 pb-4">
                                                {/* Timeline dot */}
                                                <div
                                                    className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-full border-2 border-white shadow-sm ${config.color}`}
                                                >
                                                    <Icon className="w-5 h-5" />
                                                </div>

                                                {/* Step content */}
                                                <div className="flex-1 min-w-0">
                                                    {isEditing ? (
                                                        <div className="bg-gray-50 rounded-lg p-4 border">
                                                            <SequenceStepEditor
                                                                sequenceId={sequenceId}
                                                                existingStep={step}
                                                                onClose={() => setEditingStepId(null)}
                                                                onSaved={() => {
                                                                    setEditingStepId(null);
                                                                    router.refresh();
                                                                }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="bg-white rounded-lg border p-4 hover:shadow-sm transition-shadow group">
                                                            <div className="flex items-start justify-between">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className="text-xs font-medium text-gray-400">
                                                                            Step {index + 1}
                                                                        </span>
                                                                        <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>
                                                                            {config.label}
                                                                        </span>
                                                                        <span className="text-xs text-gray-400">
                                                                            {formatDelay(step)}
                                                                        </span>
                                                                    </div>
                                                                    {step.content_template && (
                                                                        <p className="text-sm text-gray-700 line-clamp-2 mt-1">
                                                                            {step.content_template}
                                                                        </p>
                                                                    )}
                                                                    {step.subject_line && (
                                                                        <p className="text-xs text-gray-500 mt-1">
                                                                            Subject: {step.subject_line}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-3">
                                                                    <button
                                                                        onClick={() => setEditingStepId(step.id)}
                                                                        className="p-1.5 text-gray-400 hover:text-violet-600 rounded"
                                                                    >
                                                                        <ChevronDown className="w-4 h-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteStep(step.id)}
                                                                        className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Add Step */}
                            {showAddStep ? (
                                <div className="bg-gray-50 rounded-lg p-4 border mt-4">
                                    <SequenceStepEditor
                                        sequenceId={sequenceId}
                                        onClose={() => setShowAddStep(false)}
                                        onSaved={() => {
                                            setShowAddStep(false);
                                            router.refresh();
                                        }}
                                    />
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowAddStep(true)}
                                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-violet-400 hover:text-violet-600 transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Step
                                </button>
                            )}
                        </div>
                    )}

                    {/* ─── ENROLLMENTS TAB ─── */}
                    {activeTab === "enrollments" && (
                        <EnrollmentTable
                            enrollments={enrollments}
                        />
                    )}

                    {/* ─── EXECUTION LOG TAB ─── */}
                    {activeTab === "log" && (
                        <div>
                            {!logLoaded ? (
                                <div className="text-center py-8 text-gray-400">
                                    Loading execution log...
                                </div>
                            ) : executionLog.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">
                                    <Activity className="w-10 h-10 mx-auto mb-2" />
                                    <p>No execution history yet.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-gray-500 border-b">
                                                <th className="pb-2 pr-4 font-medium">Time</th>
                                                <th className="pb-2 pr-4 font-medium">Channel</th>
                                                <th className="pb-2 pr-4 font-medium">Status</th>
                                                <th className="pb-2 pr-4 font-medium">Contact</th>
                                                <th className="pb-2 font-medium">Details</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {executionLog.map((log: any) => {
                                                const config = CHANNEL_CONFIG[log.action_type] || CHANNEL_CONFIG.condition;
                                                return (
                                                    <tr key={log.id} className="text-gray-700">
                                                        <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                                                            {new Date(log.executed_at).toLocaleString()}
                                                        </td>
                                                        <td className="py-2.5 pr-4">
                                                            <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>
                                                                {config.label}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 pr-4">
                                                            <span
                                                                className={`text-xs px-2 py-0.5 rounded-full ${log.status === "delivered" || log.status === "success"
                                                                    ? "bg-green-100 text-green-700"
                                                                    : log.status === "failed"
                                                                        ? "bg-red-100 text-red-700"
                                                                        : log.status === "pending"
                                                                            ? "bg-yellow-100 text-yellow-700"
                                                                            : "bg-gray-100 text-gray-600"
                                                                    }`}
                                                            >
                                                                {log.status}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 pr-4 text-xs">
                                                            {log.enrollment_id?.substring(0, 8)}...
                                                        </td>
                                                        <td className="py-2.5 text-xs text-gray-500 max-w-[200px] truncate">
                                                            {log.provider_message_id || log.error_message || "—"}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
