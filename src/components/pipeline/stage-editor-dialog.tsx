"use client";

import { useState, useCallback } from "react";
import { Reorder, AnimatePresence, motion } from "framer-motion";
import {
    X,
    Plus,
    GripVertical,
    Trash2,
    Check,
    Loader2,
    AlertTriangle,
    Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    createPipelineStage,
    updatePipelineStage,
    deletePipelineStage,
    reorderPipelineStages,
} from "@/app/actions/pipeline-actions";
import type { PipelineStage, PipelineContact } from "./pipeline-board";

// ─── Preset colors ──────────────────────────────────────────────────────────

const PRESET_COLORS = [
    "#6366f1", // violet
    "#3b82f6", // blue
    "#8b5cf6", // purple
    "#f59e0b", // amber
    "#10b981", // emerald
    "#ef4444", // red
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#84cc16", // lime
    "#f97316", // orange
];

// ─── Animation Variants ─────────────────────────────────────────────────────

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
    exit: {
        opacity: 0,
        x: 40,
        scale: 0.98,
        transition: { duration: 0.15 },
    },
};

const itemVariants = {
    initial: { opacity: 0, height: 0, marginBottom: 0 },
    animate: {
        opacity: 1,
        height: "auto",
        marginBottom: 8,
        transition: { type: "spring" as const, stiffness: 300, damping: 25 },
    },
    exit: {
        opacity: 0,
        height: 0,
        marginBottom: 0,
        transition: { duration: 0.15 },
    },
};

// ─── Component ──────────────────────────────────────────────────────────────

interface EditableStage extends PipelineStage {
    isNew?: boolean;
    isDeleted?: boolean;
    isEditing?: boolean;
}

export function StageEditorDialog({
    open,
    onOpenChange,
    clientId,
    stages: initialStages,
    contactsByStage,
    onStagesUpdated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clientId: string;
    stages: PipelineStage[];
    contactsByStage: Record<string, PipelineContact[]>;
    onStagesUpdated: (stages: PipelineStage[]) => void;
}) {
    const [editableStages, setEditableStages] = useState<EditableStage[]>(
        initialStages.map((s) => ({ ...s }))
    );
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Sync when dialog opens
    const handleOpenChange = (value: boolean) => {
        if (value) {
            setEditableStages(initialStages.map((s) => ({ ...s })));
            setDeleteConfirm(null);
        }
        onOpenChange(value);
    };

    // Rename
    const handleRename = (id: string, name: string) => {
        setEditableStages((prev) =>
            prev.map((s) => (s.id === id ? { ...s, name } : s))
        );
    };

    // Change color
    const handleColorChange = (id: string, color: string) => {
        setEditableStages((prev) =>
            prev.map((s) => (s.id === id ? { ...s, color } : s))
        );
    };

    // Add stage
    const handleAdd = () => {
        if (!newName.trim()) return;
        const tempId = `new-${Date.now()}`;
        setEditableStages((prev) => [
            ...prev,
            {
                id: tempId,
                client_id: clientId,
                name: newName.trim(),
                color: newColor,
                position: prev.length,
                is_default: false,
                is_terminal: false,
                created_at: new Date().toISOString(),
                isNew: true,
            },
        ]);
        setNewName("");
        setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    };

    // Delete stage
    const handleDelete = (id: string) => {
        const stage = editableStages.find((s) => s.id === id);
        if (stage?.is_default) return;
        if (stage?.isNew) {
            setEditableStages((prev) => prev.filter((s) => s.id !== id));
        } else {
            setEditableStages((prev) =>
                prev.map((s) => (s.id === id ? { ...s, isDeleted: true } : s))
            );
        }
        setDeleteConfirm(null);
    };

    // Reorder
    const handleReorder = (reordered: EditableStage[]) => {
        setEditableStages(reordered);
    };

    // Save all changes
    const handleSave = async () => {
        setSaving(true);
        try {
            // 1. Delete removed stages
            const deletedStages = editableStages.filter((s) => s.isDeleted && !s.isNew);
            for (const stage of deletedStages) {
                await deletePipelineStage(stage.id, clientId);
            }

            // 2. Create new stages
            const newStages = editableStages.filter((s) => s.isNew && !s.isDeleted);
            const createdMap: Record<string, string> = {};
            for (const stage of newStages) {
                const result = await createPipelineStage(clientId, stage.name, stage.color);
                if (result.success && result.data) {
                    createdMap[stage.id] = result.data.id;
                }
            }

            // 3. Update existing stages (name, color)
            const existingStages = editableStages.filter((s) => !s.isNew && !s.isDeleted);
            for (const stage of existingStages) {
                const original = initialStages.find((s) => s.id === stage.id);
                if (original && (original.name !== stage.name || original.color !== stage.color)) {
                    await updatePipelineStage(stage.id, { name: stage.name, color: stage.color });
                }
            }

            // 4. Reorder all surviving stages
            const survivingStages = editableStages
                .filter((s) => !s.isDeleted)
                .map((s) => (s.isNew ? createdMap[s.id] || s.id : s.id))
                .filter(Boolean);

            if (survivingStages.length > 0) {
                await reorderPipelineStages(clientId, survivingStages);
            }

            // 5. Refresh data — build the new stages list
            const finalStages: PipelineStage[] = editableStages
                .filter((s) => !s.isDeleted)
                .map((s, i) => ({
                    id: s.isNew ? (createdMap[s.id] || s.id) : s.id,
                    client_id: clientId,
                    name: s.name,
                    color: s.color,
                    position: i,
                    is_default: s.is_default,
                    is_terminal: s.is_terminal,
                    created_at: s.created_at,
                }));

            onStagesUpdated(finalStages);
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to save pipeline stages:", error);
        } finally {
            setSaving(false);
        }
    };

    const activeStages = editableStages.filter((s) => !s.isDeleted);

    if (!open) return null;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    variants={overlayVariants}
                    className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 backdrop-blur-sm"
                    onClick={() => handleOpenChange(false)}
                >
                    <motion.div
                        variants={panelVariants}
                        className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Edit Pipeline</h2>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    Customize stages, colors, and order
                                </p>
                            </div>
                            <button
                                onClick={() => handleOpenChange(false)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        {/* Stage List */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            <Reorder.Group
                                axis="y"
                                values={activeStages}
                                onReorder={handleReorder}
                                className="space-y-2"
                            >
                                <AnimatePresence initial={false}>
                                    {activeStages.map((stage) => (
                                        <Reorder.Item
                                            key={stage.id}
                                            value={stage}
                                            className="list-none"
                                        >
                                            <motion.div
                                                layout
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                                                className={cn(
                                                    "group flex items-center gap-3 p-3 rounded-lg border transition-all",
                                                    "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
                                                )}
                                            >
                                                {/* Drag handle */}
                                                <GripVertical className="w-4 h-4 text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0" />

                                                {/* Color swatch */}
                                                <div className="relative">
                                                    <div
                                                        className="w-6 h-6 rounded-full cursor-pointer ring-2 ring-offset-1 ring-transparent hover:ring-gray-300 transition-all"
                                                        style={{ backgroundColor: stage.color }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditableStages((prev) =>
                                                                prev.map((s) =>
                                                                    s.id === stage.id
                                                                        ? { ...s, isEditing: !s.isEditing }
                                                                        : { ...s, isEditing: false }
                                                                )
                                                            );
                                                        }}
                                                    />
                                                    {/* Color picker popover */}
                                                    {stage.isEditing && (
                                                        <div className="absolute top-8 left-0 z-10 bg-white rounded-lg shadow-xl border border-gray-200 p-2 flex flex-wrap gap-1.5 w-[140px]">
                                                            {PRESET_COLORS.map((c) => (
                                                                <button
                                                                    key={c}
                                                                    className={cn(
                                                                        "w-6 h-6 rounded-full transition-all hover:scale-110",
                                                                        stage.color === c && "ring-2 ring-offset-1 ring-gray-800"
                                                                    )}
                                                                    style={{ backgroundColor: c }}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleColorChange(stage.id, c);
                                                                        setEditableStages((prev) =>
                                                                            prev.map((s) =>
                                                                                s.id === stage.id
                                                                                    ? { ...s, isEditing: false }
                                                                                    : s
                                                                            )
                                                                        );
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Name input */}
                                                <input
                                                    type="text"
                                                    value={stage.name}
                                                    onChange={(e) => handleRename(stage.id, e.target.value)}
                                                    className="flex-1 text-sm font-medium text-gray-800 bg-transparent border-none outline-none focus:ring-0 p-0 placeholder:text-gray-400"
                                                    placeholder="Stage name"
                                                />

                                                {/* Contact count + badges */}
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    {stage.is_default && (
                                                        <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                                                            Default
                                                        </span>
                                                    )}
                                                    {stage.is_terminal && (
                                                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                                            Terminal
                                                        </span>
                                                    )}
                                                    {!stage.isNew && (
                                                        <span className="text-xs text-gray-400 tabular-nums">
                                                            {(contactsByStage[stage.id] || []).length}
                                                        </span>
                                                    )}

                                                    {/* Delete button */}
                                                    {stage.is_default ? (
                                                        <div className="p-1.5" title="Cannot delete default stage">
                                                            <Lock className="w-3.5 h-3.5 text-gray-300" />
                                                        </div>
                                                    ) : deleteConfirm === stage.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => handleDelete(stage.id)}
                                                                className="p-1 bg-red-50 hover:bg-red-100 rounded text-red-600 transition-colors"
                                                                title="Confirm delete"
                                                            >
                                                                <Check className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={() => setDeleteConfirm(null)}
                                                                className="p-1 bg-gray-50 hover:bg-gray-100 rounded text-gray-500 transition-colors"
                                                                title="Cancel"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setDeleteConfirm(stage.id)}
                                                            className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 transition-all"
                                                            title="Delete stage"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        </Reorder.Item>
                                    ))}
                                </AnimatePresence>
                            </Reorder.Group>

                            {/* Delete warning */}
                            {deleteConfirm && (() => {
                                const stage = editableStages.find((s) => s.id === deleteConfirm);
                                const count = stage && !stage.isNew ? (contactsByStage[stage.id] || []).length : 0;
                                if (count === 0) return null;
                                return (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700"
                                    >
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        <span>
                                            {count} contact{count !== 1 ? "s" : ""} will be moved to "New Lead"
                                        </span>
                                    </motion.div>
                                );
                            })()}

                            {/* Add Stage */}
                            <div className="pt-4 border-t border-gray-100">
                                <p className="text-xs font-medium text-gray-500 mb-2">Add Stage</p>
                                <div className="flex items-center gap-2">
                                    {/* Color selector for new stage */}
                                    <div
                                        className="w-8 h-8 rounded-full cursor-pointer ring-2 ring-offset-1 ring-transparent hover:ring-gray-300 transition-all flex-shrink-0 relative group"
                                        style={{ backgroundColor: newColor }}
                                    >
                                        <select
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            value={newColor}
                                            onChange={(e) => setNewColor(e.target.value)}
                                        >
                                            {PRESET_COLORS.map((c) => (
                                                <option key={c} value={c}>
                                                    {c}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                                        placeholder="Stage name"
                                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all"
                                    />

                                    <button
                                        onClick={handleAdd}
                                        disabled={!newName.trim()}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all",
                                            newName.trim()
                                                ? "bg-violet-600 text-white hover:bg-violet-700 shadow-sm"
                                                : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                        )}
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
                            <button
                                onClick={() => handleOpenChange(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 shadow-sm transition-colors"
                            >
                                {saving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Check className="w-4 h-4" />
                                )}
                                Save Changes
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
