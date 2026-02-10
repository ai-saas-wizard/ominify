"use client";

import { useState, useEffect } from "react";
import { Phone, MessageSquare, Mail, ArrowUpRight, ArrowDownLeft, Loader2 } from "lucide-react";
import { getInteractionTimeline } from "@/app/actions/sequence-actions";

interface Interaction {
    id: string;
    channel: "sms" | "email" | "voice";
    direction: "outbound" | "inbound";
    content_body: string | null;
    content_subject: string | null;
    content_summary: string | null;
    outcome: string | null;
    sentiment: string | null;
    intent: string | null;
    call_duration_seconds: number | null;
    call_disposition: string | null;
    appointment_booked: boolean;
    objections_raised: string[] | null;
    key_topics: string[] | null;
    created_at: string;
}

const channelConfig = {
    sms: {
        icon: MessageSquare,
        label: "SMS",
        outboundColor: "bg-blue-50 border-blue-200",
        inboundColor: "bg-blue-100 border-blue-300",
        dotColor: "bg-blue-500",
    },
    email: {
        icon: Mail,
        label: "Email",
        outboundColor: "bg-green-50 border-green-200",
        inboundColor: "bg-green-100 border-green-300",
        dotColor: "bg-green-500",
    },
    voice: {
        icon: Phone,
        label: "Voice",
        outboundColor: "bg-purple-50 border-purple-200",
        inboundColor: "bg-purple-100 border-purple-300",
        dotColor: "bg-purple-500",
    },
};

const sentimentColors: Record<string, string> = {
    positive: "bg-green-100 text-green-700",
    interested: "bg-emerald-100 text-emerald-700",
    neutral: "bg-gray-100 text-gray-600",
    confused: "bg-yellow-100 text-yellow-700",
    objection: "bg-orange-100 text-orange-700",
    negative: "bg-red-100 text-red-700",
};

const outcomeColors: Record<string, string> = {
    delivered: "text-green-600",
    replied: "text-blue-600",
    answered: "text-green-600",
    voicemail: "text-orange-600",
    no_answer: "text-yellow-600",
    bounced: "text-red-600",
    opened: "text-blue-600",
    clicked: "text-indigo-600",
    failed: "text-red-600",
};

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimeAgo(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function InteractionTimeline({ contactId }: { contactId: string }) {
    const [interactions, setInteractions] = useState<Interaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        loadInteractions();
    }, [contactId]);

    const loadInteractions = async () => {
        setLoading(true);
        try {
            const result = await getInteractionTimeline(contactId, 50);
            if (result.success) {
                setInteractions(result.data as Interaction[]);
            }
        } catch (error) {
            console.error("Error loading interactions:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading timeline...</span>
            </div>
        );
    }

    if (interactions.length === 0) {
        return (
            <div className="text-center py-6 text-sm text-gray-500">
                No interactions yet. Interactions will appear here as sequences run.
            </div>
        );
    }

    return (
        <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />

            <div className="space-y-3">
                {interactions.map((interaction) => {
                    const config = channelConfig[interaction.channel];
                    const Icon = config.icon;
                    const isOutbound = interaction.direction === "outbound";
                    const isExpanded = expandedId === interaction.id;
                    const bgColor = isOutbound ? config.outboundColor : config.inboundColor;

                    return (
                        <div key={interaction.id} className="relative pl-10">
                            {/* Timeline dot */}
                            <div
                                className={`absolute left-2.5 top-3 w-3 h-3 rounded-full ${config.dotColor} ring-2 ring-white`}
                            />

                            {/* Interaction card */}
                            <div
                                className={`border rounded-lg p-3 cursor-pointer transition-colors hover:shadow-sm ${bgColor}`}
                                onClick={() => setExpandedId(isExpanded ? null : interaction.id)}
                            >
                                {/* Header row */}
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <Icon className="w-3.5 h-3.5 text-gray-600" />
                                        <span className="text-xs font-medium text-gray-700">
                                            {config.label}
                                        </span>
                                        {isOutbound ? (
                                            <ArrowUpRight className="w-3 h-3 text-gray-400" />
                                        ) : (
                                            <ArrowDownLeft className="w-3 h-3 text-blue-500" />
                                        )}
                                        <span className="text-xs text-gray-500">
                                            {isOutbound ? "Sent" : "Received"}
                                        </span>
                                    </div>
                                    <span className="text-xs text-gray-400">
                                        {formatTimeAgo(interaction.created_at)}
                                    </span>
                                </div>

                                {/* Content preview */}
                                <p className="text-sm text-gray-700 line-clamp-2">
                                    {interaction.content_summary ||
                                        interaction.content_subject ||
                                        (interaction.content_body
                                            ? interaction.content_body.substring(0, 120) + (interaction.content_body.length > 120 ? "..." : "")
                                            : interaction.channel === "voice"
                                            ? `Voice call${interaction.call_duration_seconds ? ` (${formatDuration(interaction.call_duration_seconds)})` : ""}`
                                            : "No content")}
                                </p>

                                {/* Tags row */}
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                    {interaction.outcome && (
                                        <span className={`text-xs font-medium ${outcomeColors[interaction.outcome] || "text-gray-500"}`}>
                                            {interaction.outcome}
                                        </span>
                                    )}
                                    {interaction.sentiment && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${sentimentColors[interaction.sentiment] || "bg-gray-100 text-gray-600"}`}>
                                            {interaction.sentiment}
                                        </span>
                                    )}
                                    {interaction.intent && interaction.direction === "inbound" && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">
                                            {interaction.intent}
                                        </span>
                                    )}
                                    {interaction.appointment_booked && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                                            Booked
                                        </span>
                                    )}
                                    {interaction.call_duration_seconds != null && interaction.call_duration_seconds > 0 && (
                                        <span className="text-xs text-gray-500">
                                            {formatDuration(interaction.call_duration_seconds)}
                                        </span>
                                    )}
                                </div>

                                {/* Expanded content */}
                                {isExpanded && (
                                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                                        {interaction.content_body && (
                                            <div>
                                                <span className="text-xs font-medium text-gray-500 block mb-1">
                                                    Full Content
                                                </span>
                                                <p className="text-sm text-gray-700 whitespace-pre-line bg-white/50 rounded p-2">
                                                    {interaction.content_body.substring(0, 1000)}
                                                    {interaction.content_body.length > 1000 && "..."}
                                                </p>
                                            </div>
                                        )}
                                        {interaction.objections_raised && interaction.objections_raised.length > 0 && (
                                            <div>
                                                <span className="text-xs font-medium text-gray-500 block mb-1">
                                                    Objections
                                                </span>
                                                <div className="flex gap-1 flex-wrap">
                                                    {interaction.objections_raised.map((obj, i) => (
                                                        <span key={i} className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-600">
                                                            {obj}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {interaction.key_topics && interaction.key_topics.length > 0 && (
                                            <div>
                                                <span className="text-xs font-medium text-gray-500 block mb-1">
                                                    Topics
                                                </span>
                                                <div className="flex gap-1 flex-wrap">
                                                    {interaction.key_topics.map((topic, i) => (
                                                        <span key={i} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600">
                                                            {topic}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-xs text-gray-400">
                                            {new Date(interaction.created_at).toLocaleString()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
