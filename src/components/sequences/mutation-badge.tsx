"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";

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
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
            >
                <Sparkles className="w-3 h-3" />
                AI Adapted
                {expanded ? (
                    <ChevronUp className="w-3 h-3" />
                ) : (
                    <ChevronDown className="w-3 h-3" />
                )}
            </button>

            {expanded && (
                <div className="mt-2 p-3 bg-violet-50 rounded-lg border border-violet-200 text-xs space-y-3 max-w-md">
                    {mutationReason && (
                        <div>
                            <span className="font-medium text-violet-700">Why:</span>{" "}
                            <span className="text-gray-600">{mutationReason}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        {/* Original */}
                        <div className="space-y-1">
                            <span className="font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                                Original
                            </span>
                            <div className="p-2 bg-white rounded border text-gray-600 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                {formatContent(originalContent)}
                            </div>
                        </div>

                        {/* Mutated */}
                        <div className="space-y-1">
                            <span className="font-medium text-violet-600 uppercase tracking-wide text-[10px]">
                                AI Version
                            </span>
                            <div className="p-2 bg-violet-50 rounded border border-violet-200 text-violet-800 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                {formatContent(mutatedContent)}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                        {confidence != null && (
                            <span>
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
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-600 border border-violet-100"
            title="AI Adaptive Mutation enabled for this step"
        >
            <Sparkles className="w-3 h-3" />
            AI
        </span>
    );
}

function formatContent(content: any): string {
    if (!content) return "—";
    if (typeof content === "string") return content;
    // For JSON content objects, extract the most readable field
    if (content.body) return content.body;
    if (content.body_text) return content.body_text;
    if (content.first_message) return content.first_message;
    if (content.subject) return `Subject: ${content.subject}`;
    return JSON.stringify(content, null, 2);
}
