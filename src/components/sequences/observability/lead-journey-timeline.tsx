"use client";

import { useState, useEffect } from "react";
import {
    MessageSquare,
    Mail,
    Phone,
    ArrowUpRight,
    ArrowDownLeft,
    Loader2,
    Activity,
    Brain,
    Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MutationBadge } from "@/components/sequences/mutation-badge";
import { HealingBadge } from "@/components/sequences/healing-badge";
import { getEnrollmentJourney } from "@/app/actions/sequence-actions";

const CHANNEL_META: Record<string, { icon: typeof MessageSquare; label: string; dot: string; badge: string }> = {
    sms: { icon: MessageSquare, label: "SMS", dot: "bg-blue-500", badge: "text-blue-600 bg-blue-100" },
    email: { icon: Mail, label: "Email", dot: "bg-emerald-500", badge: "text-emerald-600 bg-emerald-100" },
    voice: { icon: Phone, label: "Voice", dot: "bg-violet-500", badge: "text-violet-600 bg-violet-100" },
    voice_call: { icon: Phone, label: "Voice", dot: "bg-violet-500", badge: "text-violet-600 bg-violet-100" },
};

const SENTIMENT_COLORS: Record<string, string> = {
    positive: "bg-green-100 text-green-700",
    interested: "bg-emerald-100 text-emerald-700",
    neutral: "bg-gray-100 text-gray-600",
    confused: "bg-yellow-100 text-yellow-700",
    objection: "bg-orange-100 text-orange-700",
    negative: "bg-red-100 text-red-700",
};

function statusClasses(status: string): string {
    if (status === "delivered" || status === "success" || status === "completed" || status === "sent")
        return "bg-green-50 text-green-700 border-green-200";
    if (status === "failed") return "bg-red-50 text-red-700 border-red-200";
    if (status === "pending" || status === "executing")
        return "bg-yellow-50 text-yellow-700 border-yellow-200";
    if (status === "skipped" || status === "blocked_placeholder")
        return "bg-gray-50 text-gray-500 border-gray-200";
    return "bg-gray-50 text-gray-600 border-gray-200";
}

/** Summarize the dispatched content from the joined step row (per channel shape). */
function stepContentPreview(step: any): string | null {
    const content = step?.content;
    if (!content) return null;
    if (typeof content === "string") return content;
    return (
        content.body ||
        content.body_text ||
        content.subject ||
        content.first_message ||
        content.system_prompt ||
        null
    );
}

function formatDelay(minutes: number | null | undefined): string | null {
    if (minutes == null || minutes <= 0) return null;
    if (minutes < 60) return `${minutes}m wait`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h wait`;
    return `${Math.round(hours / 24)}d wait`;
}

type JourneyEvent =
    | { kind: "log"; at: string; data: any }
    | { kind: "interaction"; at: string; data: any };

/**
 * Per-lead merged timeline for the dynamic observability view: what the AI
 * decided and dispatched (sequence_execution_log + the generating step row)
 * interleaved with the lead's recorded interactions (replies, call outcomes).
 * Loaded lazily per selected enrollment.
 */
export function LeadJourneyTimeline({ enrollmentId }: { enrollmentId: string }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [events, setEvents] = useState<JourneyEvent[]>([]);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setExpandedKey(null);
        getEnrollmentJourney(enrollmentId).then((result) => {
            if (cancelled) return;
            if (!result.success) {
                setError(result.error || "Failed to load journey");
                setEvents([]);
                setLoading(false);
                return;
            }
            const logs: JourneyEvent[] = (result.logs || []).map((l: any) => ({
                kind: "log" as const,
                at: l.executed_at,
                data: l,
            }));
            // Outbound sends are already represented by their log row; the
            // interaction stream adds the lead's side (replies, call outcomes
            // with sentiment/intent) — the signals that drive the AI's next
            // decision. Outbound voice interactions are kept because they carry
            // disposition/duration/summary the log row lacks.
            const interactions: JourneyEvent[] = (result.interactions || [])
                .filter((i: any) => i.direction === "inbound" || i.channel === "voice")
                .map((i: any) => ({
                    kind: "interaction" as const,
                    at: i.created_at,
                    data: i,
                }));
            const merged = [...logs, ...interactions].sort(
                (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
            );
            setEvents(merged);
            setLoading(false);
        }).catch(() => {
            if (cancelled) return;
            setError("Failed to load journey");
            setEvents([]);
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [enrollmentId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading journey...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-16 text-gray-400">
                <Activity className="w-8 h-8 mx-auto mb-2 text-red-300" />
                <p className="text-sm text-red-500">{error}</p>
                <p className="text-xs mt-1">Select the lead again to retry.</p>
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div className="text-center py-16 text-gray-400">
                <Activity className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No activity yet for this lead.</p>
                <p className="text-xs mt-1">
                    Touches appear here as the AI dispatches them.
                </p>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />
            <div className="space-y-3">
                {events.map((event, idx) => {
                    const key = `${event.kind}-${event.data.id ?? idx}`;
                    const isExpanded = expandedKey === key;

                    if (event.kind === "log") {
                        const log = event.data;
                        const step = log.sequence_steps;
                        const meta = CHANNEL_META[log.channel] || CHANNEL_META.sms;
                        const preview = stepContentPreview(step);
                        const delay = formatDelay(step?.delay_minutes);
                        return (
                            <div key={key} className="relative pl-10">
                                <div className={`absolute left-2.5 top-3 w-3 h-3 rounded-full ${meta.dot} ring-2 ring-white`} />
                                <div
                                    className="border rounded-lg p-3 bg-white cursor-pointer hover:shadow-sm transition-shadow"
                                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge variant="secondary" className={meta.badge}>
                                                {meta.label}
                                            </Badge>
                                            {step?.step_order != null && (
                                                <span className="text-xs text-gray-400">
                                                    Touch #{step.step_order}
                                                </span>
                                            )}
                                            {step?.generated_dynamically && (
                                                <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-600 border-emerald-100 text-[10px]">
                                                    <Brain className="w-3 h-3" />
                                                    AI-generated
                                                </Badge>
                                            )}
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
                                        <Badge variant="outline" className={statusClasses(log.status)}>
                                            {log.status}
                                        </Badge>
                                    </div>

                                    {preview && (
                                        <p className="text-sm text-gray-700 line-clamp-2 mt-1.5">
                                            {preview}
                                        </p>
                                    )}

                                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                                        <span>{new Date(log.executed_at).toLocaleString()}</span>
                                        {delay && (
                                            <span className="flex items-center gap-0.5">
                                                <Clock className="w-3 h-3" />
                                                {delay}
                                            </span>
                                        )}
                                    </div>

                                    {log.was_healed && log.healing && (
                                        <div className="mt-1.5">
                                            <HealingBadge
                                                failureType={log.healing.failure_type}
                                                healingAction={log.healing.healing_action}
                                                healingDetails={log.healing.healing_details}
                                                failureDetails={log.healing.failure_details}
                                            />
                                        </div>
                                    )}

                                    {isExpanded && (
                                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                                            {preview && (
                                                <div>
                                                    <span className="text-xs font-medium text-gray-500 block mb-1">
                                                        Dispatched content
                                                    </span>
                                                    <p className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded p-2">
                                                        {preview.substring(0, 1500)}
                                                        {preview.length > 1500 && "..."}
                                                    </p>
                                                </div>
                                            )}
                                            {(log.provider_id || log.error_message) && (
                                                <p className="text-[11px] text-gray-400 break-all">
                                                    {log.provider_id || log.error_message}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    // Interaction event — the lead's side of the conversation.
                    const interaction = event.data;
                    const meta = CHANNEL_META[interaction.channel] || CHANNEL_META.sms;
                    const Icon = meta.icon;
                    const isOutbound = interaction.direction === "outbound";
                    const preview =
                        interaction.content_summary ||
                        interaction.content_subject ||
                        interaction.content_body?.substring(0, 160) ||
                        (interaction.channel === "voice" ? "Voice call" : "No content");
                    return (
                        <div key={key} className="relative pl-10">
                            <div className={`absolute left-2.5 top-3 w-3 h-3 rounded-full ${meta.dot} ring-2 ring-white`} />
                            <div
                                className={`border rounded-lg p-3 cursor-pointer hover:shadow-sm transition-shadow ${
                                    isOutbound ? "bg-gray-50" : "bg-blue-50/60 border-blue-200"
                                }`}
                                onClick={() => setExpandedKey(isExpanded ? null : key)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <Icon className="w-3.5 h-3.5 text-gray-600" />
                                        <span className="text-xs font-medium text-gray-700">{meta.label}</span>
                                        {isOutbound ? (
                                            <ArrowUpRight className="w-3 h-3 text-gray-400" />
                                        ) : (
                                            <ArrowDownLeft className="w-3 h-3 text-blue-500" />
                                        )}
                                        <span className="text-xs text-gray-500">
                                            {isOutbound ? "Sent" : "Lead replied"}
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-gray-400">
                                        {new Date(interaction.created_at).toLocaleString()}
                                    </span>
                                </div>

                                <p className="text-sm text-gray-700 line-clamp-2 mt-1.5">{preview}</p>

                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                    {interaction.outcome && (
                                        <span className="text-xs text-gray-500">{interaction.outcome}</span>
                                    )}
                                    {interaction.sentiment && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${SENTIMENT_COLORS[interaction.sentiment] || "bg-gray-100 text-gray-600"}`}>
                                            {interaction.sentiment}
                                        </span>
                                    )}
                                    {interaction.intent && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                                            {interaction.intent}
                                        </span>
                                    )}
                                    {interaction.appointment_booked && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                                            Booked
                                        </span>
                                    )}
                                </div>

                                {isExpanded && interaction.content_body && (
                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                        <p className="text-sm text-gray-700 whitespace-pre-line bg-white/60 rounded p-2">
                                            {interaction.content_body.substring(0, 1500)}
                                            {interaction.content_body.length > 1500 && "..."}
                                        </p>
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
