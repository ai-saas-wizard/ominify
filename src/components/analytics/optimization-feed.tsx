"use client";

import { useEffect, useState } from "react";
import {
    Lightbulb, Trash2, ArrowRightLeft, Clock, Pencil, Shuffle,
    FlaskConical, GitMerge, Sparkles, SlidersHorizontal,
    Check, X, TrendingUp,
} from "lucide-react";
import {
    getOptimizationSuggestions,
    updateSuggestionStatus,
} from "@/app/actions/sequence-actions";

interface Suggestion {
    id: string;
    suggestion_type: string;
    title: string;
    description: string;
    expected_improvement: number | null;
    confidence: string;
    status: string;
    evidence: Record<string, any>;
    created_at: string;
    sequence_steps?: { step_order: number; channel: string } | null;
}

interface OptimizationFeedProps {
    sequenceId: string;
}

const typeIcons: Record<string, any> = {
    remove_step: Trash2,
    add_step: Lightbulb,
    change_channel: ArrowRightLeft,
    change_timing: Clock,
    change_content: Pencil,
    reorder_steps: Shuffle,
    split_test: FlaskConical,
    merge_sequences: GitMerge,
    enable_mutation: Sparkles,
    adjust_aggressiveness: SlidersHorizontal,
};

const confidenceColors: Record<string, string> = {
    low: "text-yellow-600 bg-yellow-50 border-yellow-200",
    medium: "text-blue-600 bg-blue-50 border-blue-200",
    high: "text-green-600 bg-green-50 border-green-200",
};

export function OptimizationFeed({ sequenceId }: OptimizationFeedProps) {
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"pending" | "all">("pending");

    useEffect(() => {
        loadSuggestions();
    }, [sequenceId]);

    async function loadSuggestions() {
        setLoading(true);
        const result = await getOptimizationSuggestions(sequenceId);
        if (result.success) {
            setSuggestions(result.data || []);
        }
        setLoading(false);
    }

    async function handleAccept(id: string) {
        await updateSuggestionStatus(id, "accepted");
        setSuggestions(prev =>
            prev.map(s => s.id === id ? { ...s, status: "accepted" } : s)
        );
    }

    async function handleDismiss(id: string) {
        await updateSuggestionStatus(id, "dismissed");
        setSuggestions(prev =>
            prev.map(s => s.id === id ? { ...s, status: "dismissed" } : s)
        );
    }

    const filtered = filter === "pending"
        ? suggestions.filter(s => s.status === "pending")
        : suggestions;

    if (loading) {
        return (
            <div className="bg-white rounded-xl border p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-52 mb-4" />
                <div className="space-y-3">
                    {[1, 2].map(i => (
                        <div key={i} className="h-24 bg-gray-100 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <h3 className="text-sm font-semibold text-gray-900">AI Optimization Suggestions</h3>
                    {suggestions.filter(s => s.status === "pending").length > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full">
                            {suggestions.filter(s => s.status === "pending").length}
                        </span>
                    )}
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={() => setFilter("pending")}
                        className={`px-2 py-1 text-[10px] rounded ${filter === "pending" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
                    >
                        Pending
                    </button>
                    <button
                        onClick={() => setFilter("all")}
                        className={`px-2 py-1 text-[10px] rounded ${filter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
                    >
                        All
                    </button>
                </div>
            </div>

            {filtered.length === 0 ? (
                <p className="text-sm text-gray-500">
                    {filter === "pending"
                        ? "No pending suggestions. The system needs more data (50+ enrollments) to generate recommendations."
                        : "No optimization suggestions yet."}
                </p>
            ) : (
                <div className="space-y-3">
                    {filtered.map((s) => {
                        const Icon = typeIcons[s.suggestion_type] || Lightbulb;
                        const confClass = confidenceColors[s.confidence] || confidenceColors.medium;
                        const isActionable = s.status === "pending";

                        return (
                            <div
                                key={s.id}
                                className={`p-3 rounded-lg border transition-colors ${
                                    s.status === "accepted" ? "border-green-200 bg-green-50/50" :
                                    s.status === "dismissed" ? "border-gray-200 bg-gray-50 opacity-60" :
                                    "border-gray-200 hover:border-gray-300"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-2 flex-1">
                                        <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-900">{s.title}</h4>
                                            <p className="text-[11px] text-gray-600 mt-0.5">{s.description}</p>
                                        </div>
                                    </div>

                                    {s.expected_improvement && (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <TrendingUp className="w-3 h-3 text-green-500" />
                                            <span className="text-xs font-bold text-green-600">
                                                +{s.expected_improvement}%
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded border ${confClass}`}>
                                            {s.confidence} confidence
                                        </span>
                                        {s.status !== "pending" && (
                                            <span className={`text-[9px] font-medium ${
                                                s.status === "accepted" ? "text-green-600" : "text-gray-400"
                                            }`}>
                                                {s.status === "accepted" ? "Accepted" : "Dismissed"}
                                            </span>
                                        )}
                                    </div>

                                    {isActionable && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleAccept(s.id)}
                                                className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
                                                title="Accept suggestion"
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDismiss(s.id)}
                                                className="p-1 rounded hover:bg-red-100 text-red-400 transition-colors"
                                                title="Dismiss suggestion"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
