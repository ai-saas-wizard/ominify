"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
    GripVertical, Trash2, Plus, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationFlowStep } from "../types";

interface ConversationFlowEditorProps {
    steps: ConversationFlowStep[];
    generating: boolean;
    onUpdateStep: (stepId: string, text: string) => void;
    onAddStep: () => void;
    onRemoveStep: (stepId: string) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onRegenerate?: () => void;
}

export function ConversationFlowEditor({
    steps,
    generating,
    onUpdateStep,
    onAddStep,
    onRemoveStep,
    onReorder,
    onRegenerate,
}: ConversationFlowEditorProps) {
    const [editingId, setEditingId] = useState<string | null>(null);

    if (generating) {
        return (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Generating conversation flow...
            </div>
        );
    }

    if (steps.length === 0) {
        return (
            <div className="py-4 text-center">
                <p className="text-sm text-gray-400">No conversation flow yet.</p>
                <button
                    onClick={onRegenerate}
                    className="mt-2 text-xs font-medium text-violet-600 hover:text-violet-500"
                >
                    Generate Flow
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {/* Header */}
            <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">Conversation Flow</span>
                {onRegenerate && (
                    <button
                        onClick={onRegenerate}
                        className="flex items-center gap-1 text-[10px] font-medium text-violet-600 hover:text-violet-500"
                    >
                        <RefreshCw className="h-3 w-3" />
                        Regenerate
                    </button>
                )}
            </div>

            {/* Timeline */}
            <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-3 bottom-3 w-px bg-gray-200" />

                <div className="space-y-1">
                    {steps.map((step, idx) => (
                        <motion.div
                            key={step.id}
                            layout
                            className="group relative flex items-start gap-2 pl-1"
                        >
                            {/* Step number circle */}
                            <div className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center">
                                <div
                                    className={cn(
                                        "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold",
                                        step.isEdited
                                            ? "bg-violet-100 text-violet-700 ring-1 ring-violet-200"
                                            : "bg-gray-100 text-gray-500 ring-1 ring-gray-200"
                                    )}
                                >
                                    {step.stepNumber}
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                {editingId === step.id ? (
                                    <textarea
                                        autoFocus
                                        value={step.text}
                                        onChange={(e) => onUpdateStep(step.id, e.target.value)}
                                        onBlur={() => setEditingId(null)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                setEditingId(null);
                                            }
                                        }}
                                        rows={2}
                                        className="w-full rounded-md border border-violet-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                    />
                                ) : (
                                    <button
                                        onClick={() => setEditingId(step.id)}
                                        className={cn(
                                            "w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                                            step.isEdited
                                                ? "bg-violet-50/50 text-gray-800"
                                                : "text-gray-600 hover:bg-gray-50"
                                        )}
                                    >
                                        {step.text || "Click to add step text..."}
                                    </button>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {idx > 0 && (
                                    <button
                                        onClick={() => onReorder(idx, idx - 1)}
                                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    >
                                        <ChevronUp className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                {idx < steps.length - 1 && (
                                    <button
                                        onClick={() => onReorder(idx, idx + 1)}
                                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    >
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                <button
                                    onClick={() => onRemoveStep(step.id)}
                                    className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>

            {/* Add step */}
            <button
                onClick={onAddStep}
                className="mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50"
            >
                <Plus className="h-3.5 w-3.5" />
                Add Step
            </button>
        </div>
    );
}
