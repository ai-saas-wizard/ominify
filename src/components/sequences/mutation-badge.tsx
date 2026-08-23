"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Small inline badge indicating this execution was AI-mutated.
 * Click to expand and see original vs mutated content diff.
 */
export function MutationBadge({
    originalContent,
    mutatedContent,
    mutationReason,
    confidence,
    model,
}: {
    originalContent: any;
    mutatedContent: any;
    mutationReason?: string | null;
    confidence?: number | null;
    model?: string | null;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="inline-block">
            <button
                onClick={() => setExpanded(!expanded)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
                <Sparkles className="h-3 w-3 text-gray-400" />
                AI Adapted
                {expanded ? (
                    <ChevronUp className="h-3 w-3" />
                ) : (
                    <ChevronDown className="h-3 w-3" />
                )}
            </button>

            {expanded && (
                <div className="mt-2 max-w-md space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-xs">
                    {mutationReason && (
                        <div>
                            <span className="font-medium text-gray-700">Why:</span>{" "}
                            <span className="text-gray-600">{mutationReason}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        {/* Original */}
                        <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                Original
                            </span>
                            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-2 text-gray-600">
                                {formatContent(originalContent)}
                            </div>
                        </div>

                        {/* Mutated */}
                        <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                                AI Version
                            </span>
                            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-emerald-200 bg-emerald-50/40 p-2 text-gray-800">
                                {formatContent(mutatedContent)}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-xs text-gray-400">
                        {confidence != null && (
                            <span className="tabular-nums">
                                Confidence: {Math.round(confidence * 100)}%
                            </span>
                        )}
                        {model && <span>Model: {model}</span>}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Inline dot indicator for the step timeline showing mutation is enabled.
 */
export function MutationEnabledDot() {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-600"
            title="AI Adaptive Mutation enabled for this step"
        >
            <Sparkles className="h-3 w-3 text-gray-400" />
            AI
        </span>
    );
}

function formatContent(content: any): string {
    if (!content) return "-";
    if (typeof content === "string") return content;
    // For JSON content objects, extract the most readable field
    if (content.body) return content.body;
    if (content.body_text) return content.body_text;
    if (content.first_message) return content.first_message;
    if (content.subject) return `Subject: ${content.subject}`;
    return JSON.stringify(content, null, 2);
}
