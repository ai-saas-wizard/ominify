"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Loader2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { createPipeline } from "@/app/actions/pipeline-actions";
import type { Pipeline } from "@/types/pipeline";

const PRESET_COLORS = [
    "#059669", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#8b5cf6",
];

const overlayVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.15 } },
    exit: { opacity: 0, transition: { duration: 0.1 } },
};

const panelVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 350, damping: 30 },
    },
    exit: { opacity: 0, scale: 0.95, y: 20, transition: { duration: 0.15 } },
};

export function CreatePipelineDialog({
    open,
    onOpenChange,
    clientId,
    pipelines,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clientId: string;
    pipelines: Pipeline[];
}) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [color, setColor] = useState(PRESET_COLORS[0]);
    const [copyFrom, setCopyFrom] = useState("");
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    const handleCreate = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const result = await createPipeline(
                clientId,
                name.trim(),
                description.trim() || undefined,
                color,
                copyFrom || undefined
            );
            if (result.success && result.data) {
                setName("");
                setDescription("");
                setCopyFrom("");
                onOpenChange(false);
                router.push(`/client/${clientId}/pipeline?pipeline=${result.data.id}`);
            }
        } catch (error) {
            console.error("Failed to create pipeline:", error);
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    variants={overlayVariants}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={() => onOpenChange(false)}
                >
                    <motion.div
                        variants={panelVariants}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-gray-900">Create Pipeline</h2>
                            <button
                                onClick={() => onOpenChange(false)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        {/* Form */}
                        <div className="p-6 space-y-4">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Pipeline Name
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                    placeholder="e.g. Sales Pipeline, Onboarding"
                                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all"
                                    autoFocus
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Description <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="What is this pipeline for?"
                                    rows={2}
                                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all resize-none"
                                />
                            </div>

                            {/* Color */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Color
                                </label>
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

                            {/* Copy stages from */}
                            {pipelines.length > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                        Copy stages from <span className="text-gray-400 font-normal">(optional)</span>
                                    </label>
                                    <select
                                        value={copyFrom}
                                        onChange={(e) => setCopyFrom(e.target.value)}
                                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all bg-white"
                                    >
                                        <option value="">Use default stages</option>
                                        {pipelines.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
                            <button
                                onClick={() => onOpenChange(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!name.trim() || saving}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
                            >
                                {saving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Plus className="w-4 h-4" />
                                )}
                                Create Pipeline
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
