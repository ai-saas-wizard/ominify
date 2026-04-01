"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
    X,
    Settings,
    Trash2,
    Loader2,
    Check,
    AlertTriangle,
    Plus,
    Zap,
    Route,
    ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { updatePipeline, deletePipeline } from "@/app/actions/pipeline-actions";
import {
    getAssignmentRules,
    createAssignmentRule,
    deleteAssignmentRule,
    updateAssignmentRule,
    getAutomations,
    createAutomation,
    deleteAutomation,
    updateAutomation,
} from "@/app/actions/pipeline-rule-actions";
import type { Pipeline, PipelineStage, PipelineAssignmentRule, PipelineAutomation } from "@/types/pipeline";

const PRESET_COLORS = [
    "#059669", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#8b5cf6",
];

const LEAD_SOURCES = [
    { value: "google_ads", label: "Google Ads" },
    { value: "facebook", label: "Facebook" },
    { value: "webhook", label: "Webhook" },
    { value: "csv_upload", label: "CSV Upload" },
    { value: "manual", label: "Manual" },
    { value: "api", label: "API" },
    { value: "form", label: "Form" },
];

const overlayVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.15 } },
    exit: { opacity: 0, transition: { duration: 0.1 } },
};

const panelVariants = {
    hidden: { opacity: 0, x: 40, scale: 0.98 },
    visible: {
        opacity: 1,
        x: 0,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 350, damping: 30 },
    },
    exit: { opacity: 0, x: 40, scale: 0.98, transition: { duration: 0.15 } },
};

type Tab = "general" | "rules" | "automations" | "danger";

export function PipelineSettingsDialog({
    open,
    onOpenChange,
    pipeline,
    clientId,
    stages,
    pipelines,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pipeline: Pipeline;
    clientId: string;
    stages: PipelineStage[];
    pipelines: Pipeline[];
}) {
    const [tab, setTab] = useState<Tab>("general");
    const [name, setName] = useState(pipeline.name);
    const [description, setDescription] = useState(pipeline.description || "");
    const [color, setColor] = useState(pipeline.color);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const router = useRouter();

    // Assignment rules
    const [rules, setRules] = useState<PipelineAssignmentRule[]>([]);
    const [rulesLoaded, setRulesLoaded] = useState(false);
    const [newRuleSource, setNewRuleSource] = useState("");

    // Automations
    const [automations, setAutomations] = useState<PipelineAutomation[]>([]);
    const [automationsLoaded, setAutomationsLoaded] = useState(false);
    const [newAutoTriggerStage, setNewAutoTriggerStage] = useState("");
    const [newAutoTargetPipeline, setNewAutoTargetPipeline] = useState("");

    useEffect(() => {
        if (open) {
            setName(pipeline.name);
            setDescription(pipeline.description || "");
            setColor(pipeline.color);
            setTab("general");
            setDeleteConfirm(false);
        }
    }, [open, pipeline]);

    // Load rules when tab switches
    useEffect(() => {
        if (tab === "rules" && !rulesLoaded && open) {
            getAssignmentRules(pipeline.id).then(({ rules }) => {
                setRules(rules);
                setRulesLoaded(true);
            });
        }
    }, [tab, rulesLoaded, open, pipeline.id]);

    useEffect(() => {
        if (tab === "automations" && !automationsLoaded && open) {
            getAutomations(clientId).then(({ automations }) => {
                setAutomations(automations.filter((a: any) => a.trigger_pipeline_id === pipeline.id));
                setAutomationsLoaded(true);
            });
        }
    }, [tab, automationsLoaded, open, clientId, pipeline.id]);

    const handleSaveGeneral = async () => {
        setSaving(true);
        try {
            await updatePipeline(pipeline.id, {
                name: name.trim(),
                description: description.trim() || undefined,
                color,
            });
            onOpenChange(false);
            router.refresh();
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const result = await deletePipeline(pipeline.id, clientId);
            if (result.success) {
                onOpenChange(false);
                router.push(`/client/${clientId}/pipeline`);
            }
        } finally {
            setDeleting(false);
        }
    };

    const handleAddRule = async () => {
        if (!newRuleSource) return;
        const result = await createAssignmentRule(
            pipeline.id,
            { enrollment_source: newRuleSource },
            rules.length
        );
        if (result.success && result.data) {
            setRules((prev) => [...prev, result.data]);
            setNewRuleSource("");
        }
    };

    const handleDeleteRule = async (ruleId: string) => {
        await deleteAssignmentRule(ruleId);
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
    };

    const handleToggleRule = async (ruleId: string, isActive: boolean) => {
        await updateAssignmentRule(ruleId, { is_active: isActive });
        setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, is_active: isActive } : r));
    };

    const handleAddAutomation = async () => {
        if (!newAutoTriggerStage || !newAutoTargetPipeline) return;
        const result = await createAutomation(
            clientId,
            pipeline.id,
            newAutoTriggerStage,
            newAutoTargetPipeline
        );
        if (result.success && result.data) {
            setAutomations((prev) => [...prev, result.data]);
            setNewAutoTriggerStage("");
            setNewAutoTargetPipeline("");
        }
    };

    const handleDeleteAutomation = async (id: string) => {
        await deleteAutomation(id);
        setAutomations((prev) => prev.filter((a) => a.id !== id));
    };

    if (!open) return null;

    const otherPipelines = pipelines.filter((p) => p.id !== pipeline.id);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    variants={overlayVariants}
                    className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 backdrop-blur-sm"
                    onClick={() => onOpenChange(false)}
                >
                    <motion.div
                        variants={panelVariants}
                        className="bg-white h-full w-full max-w-lg shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Settings className="w-5 h-5 text-gray-500" />
                                <h2 className="text-lg font-semibold text-gray-900">Pipeline Settings</h2>
                            </div>
                            <button
                                onClick={() => onOpenChange(false)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="px-6 pt-4 flex gap-1 border-b border-gray-100">
                            {([
                                { key: "general", label: "General" },
                                { key: "rules", label: "Assignment Rules" },
                                { key: "automations", label: "Automations" },
                                { key: "danger", label: "Danger Zone" },
                            ] as { key: Tab; label: string }[]).map((t) => (
                                <button
                                    key={t.key}
                                    onClick={() => setTab(t.key)}
                                    className={cn(
                                        "px-3 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2",
                                        tab === t.key
                                            ? "text-emerald-700 border-emerald-600 bg-emerald-50/50"
                                            : "text-gray-500 border-transparent hover:text-gray-700"
                                    )}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {/* General Tab */}
                            {tab === "general" && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 resize-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Color</label>
                                        <div className="flex gap-2">
                                            {PRESET_COLORS.map((c) => (
                                                <button
                                                    key={c}
                                                    className={cn(
                                                        "w-7 h-7 rounded-full transition-all hover:scale-110",
                                                        color === c && "ring-2 ring-offset-2 ring-gray-800"
                                                    )}
                                                    style={{ backgroundColor: c }}
                                                    onClick={() => setColor(c)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSaveGeneral}
                                        disabled={saving || !name.trim()}
                                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                                    >
                                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                        Save Changes
                                    </button>
                                </div>
                            )}

                            {/* Assignment Rules Tab */}
                            {tab === "rules" && (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500">
                                        Auto-route new contacts to this pipeline based on their lead source.
                                    </p>

                                    {rules.map((rule) => (
                                        <div key={rule.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            <Route className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-gray-800">
                                                    {LEAD_SOURCES.find((s) => s.value === rule.conditions?.enrollment_source)?.label || JSON.stringify(rule.conditions)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleToggleRule(rule.id, !rule.is_active)}
                                                className={cn(
                                                    "relative w-9 h-5 rounded-full transition-colors",
                                                    rule.is_active ? "bg-emerald-600" : "bg-gray-300"
                                                )}
                                            >
                                                <div className={cn(
                                                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                                                    rule.is_active ? "left-[18px]" : "left-0.5"
                                                )} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteRule(rule.id)}
                                                className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}

                                    <div className="pt-3 border-t border-gray-100">
                                        <p className="text-xs font-medium text-gray-500 mb-2">Add Rule</p>
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={newRuleSource}
                                                onChange={(e) => setNewRuleSource(e.target.value)}
                                                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                            >
                                                <option value="">Select lead source...</option>
                                                {LEAD_SOURCES.map((s) => (
                                                    <option key={s.value} value={s.value}>{s.label}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={handleAddRule}
                                                disabled={!newRuleSource}
                                                className={cn(
                                                    "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all",
                                                    newRuleSource
                                                        ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                                                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                )}
                                            >
                                                <Plus className="w-4 h-4" />
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Automations Tab */}
                            {tab === "automations" && (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500">
                                        Automatically move contacts to another pipeline when they reach a stage.
                                    </p>

                                    {automations.map((auto) => (
                                        <div key={auto.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            <Zap className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                            <span className="text-sm text-gray-800">
                                                {stages.find((s) => s.id === auto.trigger_stage_id)?.name || "Stage"}
                                            </span>
                                            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="text-sm font-medium text-gray-800">
                                                {pipelines.find((p) => p.id === auto.target_pipeline_id)?.name || "Pipeline"}
                                            </span>
                                            <div className="ml-auto flex items-center gap-1">
                                                <button
                                                    onClick={() => updateAutomation(auto.id, { is_active: !auto.is_active })}
                                                    className={cn(
                                                        "relative w-9 h-5 rounded-full transition-colors",
                                                        auto.is_active ? "bg-emerald-600" : "bg-gray-300"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                                                        auto.is_active ? "left-[18px]" : "left-0.5"
                                                    )} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteAutomation(auto.id)}
                                                    className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {otherPipelines.length > 0 && (
                                        <div className="pt-3 border-t border-gray-100">
                                            <p className="text-xs font-medium text-gray-500 mb-2">Add Automation</p>
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500 w-24">When reaches</span>
                                                    <select
                                                        value={newAutoTriggerStage}
                                                        onChange={(e) => setNewAutoTriggerStage(e.target.value)}
                                                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                                                    >
                                                        <option value="">Select stage...</option>
                                                        {stages.map((s) => (
                                                            <option key={s.id} value={s.id}>{s.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500 w-24">Move to</span>
                                                    <select
                                                        value={newAutoTargetPipeline}
                                                        onChange={(e) => setNewAutoTargetPipeline(e.target.value)}
                                                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                                                    >
                                                        <option value="">Select pipeline...</option>
                                                        {otherPipelines.map((p) => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button
                                                    onClick={handleAddAutomation}
                                                    disabled={!newAutoTriggerStage || !newAutoTargetPipeline}
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all",
                                                        newAutoTriggerStage && newAutoTargetPipeline
                                                            ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                                                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                    )}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Add Automation
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Danger Zone */}
                            {tab === "danger" && (
                                <div className="space-y-4">
                                    {pipeline.is_default ? (
                                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                            <p className="text-sm text-amber-700">
                                                This is the default pipeline and cannot be deleted.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-red-800">Delete this pipeline</p>
                                                    <p className="text-xs text-red-600 mt-1">
                                                        This will remove all contacts from this pipeline (contacts themselves are preserved).
                                                        Stages, rules, and automations will be permanently deleted.
                                                    </p>
                                                </div>
                                            </div>
                                            {deleteConfirm ? (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={handleDelete}
                                                        disabled={deleting}
                                                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                                                    >
                                                        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                        Confirm Delete
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteConfirm(false)}
                                                        className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setDeleteConfirm(true)}
                                                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-100"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete Pipeline
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
