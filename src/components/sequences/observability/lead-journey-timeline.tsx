"use client";

import { useState, useEffect } from "react";
import {
    MessageSquare,
    Mail,
    Phone,
    ArrowUpRight,
    ArrowDownLeft,
    Activity,
    Brain,
    Clock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MutationBadge } from "@/components/sequences/mutation-badge";
import { HealingBadge } from "@/components/sequences/healing-badge";
import { getEnrollmentJourney } from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";

const CHANNEL_META: Record<string, { icon: typeof MessageSquare; label: string }> = {
    sms: { icon: MessageSquare, label: "SMS" },
    email: { icon: Mail, label: "Email" },
    voice: { icon: Phone, label: "Voice" },
    voice_call: { icon: Phone, label: "Voice" },
};

// One hue per meaning: emerald=success, red=failed, amber=confusion/objection,
// sky=in-flight, neutral for the rest.
const SENTIMENT_COLORS: Record<string, string> = {
    positive: "bg-emerald-50 text-emerald-700",
    interested: "bg-emerald-50 text-emerald-700",
    neutral: "bg-gray-100 text-gray-600",
    confused: "bg-amber-50 text-amber-700",
    objection: "bg-amber-50 text-amber-700",
    negative: "bg-red-50 text-red-700",
};

function statusStyle(status: string): { dot: string; text: string } {
    if (status === "delivered" || status === "success" || status === "completed" || status === "sent")
        return { dot: "bg-emerald-500", text: "text-emerald-700" };
    if (status === "failed") return { dot: "bg-red-500", text: "text-red-700" };
    if (status === "pending" || status === "executing")
        return { dot: "bg-sky-500", text: "text-sky-700" };
    return { dot: "bg-gray-300", text: "text-gray-500" };
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
    const [dispatchedByProviderId, setDispatchedByProviderId] = useState<
        Record<string, string>
    >({});
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
            // Outbound sends store the ACTUAL dispatched text on the
            // interaction row (sms-worker records contentBody). The step row
            // keeps the "[AI-generated at dispatch]" template, because dynamic
            // content is generated per lead at send time and never written
            // back. Key the real text by provider id so the log row can show
            // what the lead actually received instead of the template.
            const sentByProviderId: Record<string, string> = {};
            for (const i of result.interactions || []) {
                if (i.direction === "outbound" && i.provider_id && i.content_body) {
                    sentByProviderId[i.provider_id] = i.content_body;
                }
            }
            setDispatchedByProviderId(sentByProviderId);

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
            <div className="relative" aria-busy="true" aria-label="Loading journey">
                <div className="absolute bottom-2 left-4 top-2 w-px bg-gray-100" />
                <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="relative pl-10">
                            <Skeleton className="absolute left-3 top-4 h-2 w-2 rounded-full" />
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-4 w-16" />
                                </div>
                                <Skeleton className="mt-2.5 h-4 w-3/4" />
                                <Skeleton className="mt-2 h-3 w-40" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-16 text-center text-gray-400">
                <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm text-red-600">{error}</p>
                <p className="mt-1 text-xs">Select the lead again to retry.</p>
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div className="py-16 text-center text-gray-400">
                <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm">No activity yet for this lead.</p>
                <p className="mt-1 text-xs">
                    Touches appear here as the AI dispatches them.
                </p>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="absolute bottom-2 left-4 top-2 w-px bg-gray-200" />
            <div className="space-y-3">
                {events.map((event, idx) => {
                    const key = `${event.kind}-${event.data.id ?? idx}`;
                    const isExpanded = expandedKey === key;

                    if (event.kind === "log") {
                        const log = event.data;
                        const step = log.sequence_steps;
                        const meta = CHANNEL_META[log.channel] || CHANNEL_META.sms;
                        const Icon = meta.icon;
                        const preview =
                            (log.provider_id && dispatchedByProviderId[log.provider_id]) ||
                            stepContentPreview(step);
                        const delay = formatDelay(step?.delay_minutes);
                        const status = statusStyle(log.status);
                        return (
                            <div key={key} className="relative pl-10">
                                <div
                                    className={cn(
                                        "absolute left-3 top-4 h-2 w-2 rounded-full ring-2 ring-white",
                                        status.dot
                                    )}
                                />
                                <div
                                    className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 transition-colors duration-150 hover:border-gray-300"
                                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="flex items-center gap-1.5">
                                                <Icon className="h-3.5 w-3.5 text-gray-400" />
                                                <span className="text-xs font-medium text-gray-700">
                                                    {meta.label}
                                                </span>
                                            </span>
                                            {step?.step_order != null && (
                                                <span className="text-xs tabular-nums text-gray-400">
                                                    Touch #{step.step_order}
                                                </span>
                                            )}
                                            {step?.generated_dynamically && (
                                                <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500">
                                                    <Brain className="h-3 w-3 text-gray-400" />
                                                    AI-generated
                                                </span>
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
                                        <span
                                            className={cn(
                                                "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
                                                status.text
                                            )}
                                        >
                                            <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                                            {log.status}
                                        </span>
                                    </div>

                                    {preview && (
                                        <p className="mt-1.5 line-clamp-2 text-sm text-gray-700">
                                            {preview}
                                        </p>
                                    )}

                                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                                        <span className="font-mono">
                                            {new Date(log.executed_at).toLocaleString()}
                                        </span>
                                        {delay && (
                                            <span className="flex items-center gap-0.5">
                                                <Clock className="h-3 w-3" />
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
                                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                                            {preview && (
                                                <div>
                                                    <span className="mb-1 block text-xs font-medium text-gray-500">
                                                        Dispatched content
                                                    </span>
                                                    <p className="whitespace-pre-line rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                                                        {preview.substring(0, 1500)}
                                                        {preview.length > 1500 && "..."}
                                                    </p>
                                                </div>
                                            )}
                                            {(log.provider_id || log.error_message) && (
                                                <p
                                                    className={cn(
                                                        "break-all font-mono text-xs",
                                                        log.provider_id ? "text-gray-400" : "text-red-600"
                                                    )}
                                                >
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
                            <div
                                className={cn(
                                    "absolute left-3 top-4 h-2 w-2 rounded-full ring-2 ring-white",
                                    isOutbound ? "bg-gray-300" : "bg-sky-500"
                                )}
                            />
                            <div
                                className={cn(
                                    "cursor-pointer rounded-lg border p-3 transition-colors duration-150",
                                    isOutbound
                                        ? "border-gray-200 bg-gray-50 hover:border-gray-300"
                                        : "border-sky-200 bg-sky-50/40 hover:border-sky-300"
                                )}
                                onClick={() => setExpandedKey(isExpanded ? null : key)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <Icon className="h-3.5 w-3.5 text-gray-400" />
                                        <span className="text-xs font-medium text-gray-700">{meta.label}</span>
                                        {isOutbound ? (
                                            <ArrowUpRight className="h-3 w-3 text-gray-400" />
                                        ) : (
                                            <ArrowDownLeft className="h-3 w-3 text-sky-600" />
                                        )}
                                        <span className="text-xs text-gray-500">
                                            {isOutbound ? "Sent" : "Lead replied"}
                                        </span>
                                    </div>
                                    <span className="font-mono text-xs text-gray-400">
                                        {new Date(interaction.created_at).toLocaleString()}
                                    </span>
                                </div>

                                <p className="mt-1.5 line-clamp-2 text-sm text-gray-700">{preview}</p>

                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                    {interaction.outcome && (
                                        <span className="text-xs text-gray-500">{interaction.outcome}</span>
                                    )}
                                    {interaction.sentiment && (
                                        <span
                                            className={cn(
                                                "rounded-md px-1.5 py-0.5 text-xs",
                                                SENTIMENT_COLORS[interaction.sentiment] ||
                                                    "bg-gray-100 text-gray-600"
                                            )}
                                        >
                                            {interaction.sentiment}
                                        </span>
                                    )}
                                    {interaction.intent && (
                                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                                            {interaction.intent}
                                        </span>
                                    )}
                                    {interaction.appointment_booked && (
                                        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                                            Booked
                                        </span>
                                    )}
                                </div>

                                {isExpanded && interaction.content_body && (
                                    <div className="mt-3 border-t border-gray-100 pt-3">
                                        <p className="whitespace-pre-line rounded-md bg-white/60 p-2 text-sm text-gray-700">
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
