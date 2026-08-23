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

// The page-wide palette, applied to a single touch rather than a whole lead:
// emerald=went out fine, red=failed, blue=the lead responded, amber=objection,
// neutral=queued or nothing yet. Blue never means "in flight" here, it belongs
// to the lead's own replies, exactly as in the lead list (see enrollment-status).
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
    // Queued, not yet dispatched, neutral says "nothing has happened" more
    // honestly than a color that implies an outcome.
    if (status === "pending" || status === "executing")
        return { dot: "bg-gray-300", text: "text-gray-500" };
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

/** Normalized channel key ('voice_call' → 'voice') for filtering. */
function channelKey(raw: string | null | undefined): string {
    return raw === "voice_call" ? "voice" : raw || "sms";
}

/** True when the AI visibly shaped this touch, generated, rewrote, or repaired it. */
function isAiEvent(event: JourneyEvent): boolean {
    if (event.kind !== "log") return false;
    const log = event.data;
    return !!(
        log.sequence_steps?.generated_dynamically ||
        log.was_mutated ||
        log.was_healed
    );
}

/** One row of the rail: the continuous line plus this event's node. */
function TimelineRow({
    dot,
    dashed,
    children,
}: {
    dot?: string;
    dashed?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3">
            <div className="relative flex justify-center">
                {!dashed && <div className="absolute inset-y-0 w-px bg-gray-200" />}
                <div
                    className={cn(
                        "relative mt-[13px] h-[9px] w-[9px] rounded-full ring-[3px] ring-gray-50",
                        dashed
                            ? "border-[1.5px] border-dashed border-gray-300 bg-gray-50 ring-0"
                            : dot
                    )}
                />
            </div>
            <div className="pb-2.5">{children}</div>
        </div>
    );
}

/** Uppercase channel label + icon, matching the card header treatment. */
function ChannelLabel({ channel, className }: { channel: string; className?: string }) {
    const meta = CHANNEL_META[channel] || CHANNEL_META.sms;
    const Icon = meta.icon;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]",
                className
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
        </span>
    );
}

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">
            {children}
        </span>
    );
}

function StateLabel({ dot, text, label }: { dot: string; text: string; label: string }) {
    return (
        <span
            className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold",
                text
            )}
        >
            <span className={cn("h-[5px] w-[5px] rounded-full", dot)} />
            {label}
        </span>
    );
}

/**
 * Per-lead merged timeline for the dynamic observability view: what the AI
 * decided and dispatched (sequence_execution_log + the generating step row)
 * interleaved with the lead's recorded interactions (replies, call outcomes).
 * Loaded lazily per selected enrollment.
 */
export function LeadJourneyTimeline({
    enrollmentId,
    channelFilter = "All",
    nextTouchAt,
}: {
    enrollmentId: string;
    /** "All", a channel label ("Voice"/"SMS"/"Email"), or "AI". */
    channelFilter?: string;
    /** ISO timestamp of the lead's next scheduled touch, if it has one. */
    nextTouchAt?: string | null;
}) {
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
            // with sentiment/intent), the signals that drive the AI's next
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

    const shown = events.filter((event) => {
        if (channelFilter === "All") return true;
        if (channelFilter === "AI") return isAiEvent(event);
        const raw = event.kind === "log" ? event.data.channel : event.data.channel;
        return CHANNEL_META[channelKey(raw)]?.label === channelFilter;
    });

    if (loading) {
        return (
            <div className="max-w-[760px]" aria-busy="true" aria-label="Loading journey">
                {[0, 1, 2].map((i) => (
                    <TimelineRow key={i} dot="bg-gray-200">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-16" />
                            </div>
                            <Skeleton className="mt-2.5 h-4 w-3/4" />
                            <Skeleton className="mt-2 h-3 w-40" />
                        </div>
                    </TimelineRow>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-16 text-center text-gray-500">
                <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm text-red-600">{error}</p>
                <p className="mt-1 text-xs">Select the lead again to retry.</p>
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div className="py-16 text-center text-gray-500">
                <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm">No activity yet for this lead.</p>
                <p className="mt-1 text-xs">
                    Touches appear here as the AI dispatches them.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-[760px]">
            {shown.length === 0 && (
                <p className="py-10 text-center text-[12px] text-gray-500">
                    Nothing on this lead&apos;s timeline matches the {channelFilter} filter.
                </p>
            )}

            {shown.map((event, idx) => {
                const key = `${event.kind}-${event.data.id ?? idx}`;
                const isExpanded = expandedKey === key;

                if (event.kind === "log") {
                    const log = event.data;
                    const step = log.sequence_steps;
                    const preview =
                        (log.provider_id && dispatchedByProviderId[log.provider_id]) ||
                        stepContentPreview(step);
                    const delay = formatDelay(step?.delay_minutes);
                    const status = statusStyle(log.status);
                    return (
                        <TimelineRow key={key} dot={status.dot}>
                            <div
                                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3.5 py-3 transition-colors duration-150 hover:border-gray-300"
                                onClick={() => setExpandedKey(isExpanded ? null : key)}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <ChannelLabel
                                        channel={channelKey(log.channel)}
                                        className="text-gray-700"
                                    />
                                    {step?.step_order != null && (
                                        <span className="text-[11px] tabular-nums text-gray-500">
                                            Touch {step.step_order}
                                        </span>
                                    )}
                                    {step?.generated_dynamically && (
                                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                                            <Brain className="h-3 w-3" />
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
                                    <StateLabel
                                        dot={status.dot}
                                        text={status.text}
                                        label={log.status}
                                    />
                                </div>

                                {preview && (
                                    <p className="mt-2 line-clamp-2 text-[13px] leading-[1.5] text-gray-900">
                                        {preview}
                                    </p>
                                )}

                                <div className="mt-2 flex items-center gap-2 text-[10.5px] tabular-nums text-gray-500">
                                    <span>{new Date(log.executed_at).toLocaleString()}</span>
                                    {delay && (
                                        <>
                                            <span className="text-gray-300">·</span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {delay}
                                            </span>
                                        </>
                                    )}
                                </div>

                                {log.was_healed && log.healing && (
                                    <div className="mt-2">
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
                                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                                                    Dispatched content
                                                </span>
                                                <p className="whitespace-pre-line rounded-md bg-gray-50 p-2 text-[13px] leading-[1.5] text-gray-700">
                                                    {preview.substring(0, 1500)}
                                                    {preview.length > 1500 && "..."}
                                                </p>
                                            </div>
                                        )}
                                        {(log.provider_id || log.error_message) && (
                                            <p
                                                className={cn(
                                                    "break-all text-[10.5px]",
                                                    log.provider_id ? "text-gray-400" : "text-red-600"
                                                )}
                                            >
                                                {log.provider_id || log.error_message}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </TimelineRow>
                    );
                }

                // Interaction event, the lead's side of the conversation.
                const interaction = event.data;
                const isOutbound = interaction.direction === "outbound";
                const preview =
                    interaction.content_summary ||
                    interaction.content_subject ||
                    interaction.content_body?.substring(0, 160) ||
                    (interaction.channel === "voice" ? "Voice call" : "No content");
                return (
                    <TimelineRow key={key} dot={isOutbound ? "bg-gray-300" : "bg-blue-600"}>
                        <div
                            className={cn(
                                "cursor-pointer rounded-lg border px-3.5 py-3 transition-colors duration-150",
                                isOutbound
                                    ? "border-gray-200 bg-gray-50/80 hover:border-gray-300"
                                    : "border-blue-200 bg-blue-50/40 hover:border-blue-300"
                            )}
                            onClick={() => setExpandedKey(isExpanded ? null : key)}
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <ChannelLabel
                                    channel={channelKey(interaction.channel)}
                                    className={isOutbound ? "text-gray-700" : "text-blue-700"}
                                />
                                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                                    {isOutbound ? (
                                        <ArrowUpRight className="h-3 w-3 text-gray-400" />
                                    ) : (
                                        <ArrowDownLeft className="h-3 w-3 text-blue-600" />
                                    )}
                                    {isOutbound ? "Sent" : "Lead replied"}
                                </span>
                                {interaction.appointment_booked && <Chip>Booked</Chip>}
                                <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-gray-500">
                                    {new Date(interaction.created_at).toLocaleString()}
                                </span>
                            </div>

                            <p className="mt-2 line-clamp-2 text-[13px] leading-[1.5] text-gray-900">
                                {preview}
                            </p>

                            {(interaction.outcome ||
                                interaction.sentiment ||
                                interaction.intent) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {interaction.outcome && (
                                        <span className="text-[11px] text-gray-500">
                                            {interaction.outcome}
                                        </span>
                                    )}
                                    {interaction.sentiment && (
                                        <span
                                            className={cn(
                                                "rounded px-1.5 py-0.5 text-[10.5px]",
                                                SENTIMENT_COLORS[interaction.sentiment] ||
                                                    "bg-gray-100 text-gray-600"
                                            )}
                                        >
                                            {interaction.sentiment}
                                        </span>
                                    )}
                                    {interaction.intent && (
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] text-gray-600">
                                            {interaction.intent}
                                        </span>
                                    )}
                                </div>
                            )}

                            {isExpanded && interaction.content_body && (
                                <div className="mt-3 border-t border-gray-100 pt-3">
                                    <p className="whitespace-pre-line rounded-md bg-white/60 p-2 text-[13px] leading-[1.5] text-gray-700">
                                        {interaction.content_body.substring(0, 1500)}
                                        {interaction.content_body.length > 1500 && "..."}
                                    </p>
                                </div>
                            )}
                        </div>
                    </TimelineRow>
                );
            })}

            {/* Open-ended terminator: the journey is not finished, it is waiting. */}
            {nextTouchAt && (
                <TimelineRow dashed>
                    <div className="flex items-center gap-2 pt-2 text-[12px] text-gray-500">
                        <span>Waiting on next scheduled touch</span>
                        <span className="font-medium tabular-nums text-gray-900">
                            {new Date(nextTouchAt).toLocaleString()}
                        </span>
                    </div>
                </TimelineRow>
            )}
        </div>
    );
}
