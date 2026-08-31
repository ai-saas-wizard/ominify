"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Ban,
    Bot,
    CalendarCheck,
    Clock,
    Inbox,
    Mail,
    MessageSquare,
    Pause,
    PhoneIncoming,
    PhoneOff,
    PhoneOutgoing,
    Play,
    Radio,
    Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { endActiveCall } from "@/app/actions/call-actions";
import { STATUS_META, type UniboxEvent, type UniboxThread } from "@/lib/unibox/types";
import {
    DISPOSITION_LABEL,
    channelLine,
    formatDuration,
    formatPhone,
    initialsFor,
    threadDisplayName,
    titleCase,
    type Disposition,
} from "@/lib/unibox/parse";
import { dateLabel, dayKey, dayLabel, longAgo, timeLabel } from "@/lib/unibox/format";
import { PulsingDot } from "./pulsing-dot";

const DISPOSITION_TONE: Record<Disposition, string> = {
    answered: "bg-emerald-50 text-emerald-700",
    transferred: "bg-blue-50 text-blue-700",
    voicemail: "bg-amber-50 text-amber-700",
    no_answer: "bg-gray-100 text-gray-500",
    busy: "bg-orange-50 text-orange-700",
    failed: "bg-red-50 text-red-600",
    live: "bg-emerald-500 text-white",
};

const DISPOSITION_ICON_TONE: Record<Disposition, string> = {
    answered: "bg-emerald-50 text-emerald-600",
    transferred: "bg-blue-50 text-blue-600",
    voicemail: "bg-amber-50 text-amber-500",
    no_answer: "bg-gray-100 text-gray-500",
    busy: "bg-orange-50 text-orange-500",
    failed: "bg-red-50 text-red-500",
    live: "bg-emerald-100 text-emerald-600",
};

interface ThreadDetailProps {
    thread: UniboxThread | null;
    clientId: string;
    now: number;
}

export function ThreadDetail({ thread, clientId, now }: ThreadDetailProps) {
    const [isEnding, setIsEnding] = useState(false);
    const liveEvent = thread?.events.find((e) => e.isLive);

    const handleEndCall = async () => {
        if (!liveEvent?.providerId) return;
        setIsEnding(true);
        try {
            const result = await endActiveCall(clientId, liveEvent.providerId);
            if (!result.success) console.error("Failed to end call:", result.error);
        } catch (error) {
            console.error("Error ending call:", error);
        } finally {
            setIsEnding(false);
        }
    };

    return (
        <section className="relative flex-1 min-w-0 h-full overflow-hidden bg-[#fafafa]">
            <AnimatePresence mode="wait">
                {thread ? (
                    <motion.div
                        key={thread.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        className="absolute inset-0 flex flex-col"
                    >
                        <ThreadHeader thread={thread} onEndCall={liveEvent ? handleEndCall : undefined} isEnding={isEnding} />

                        <div className="shrink-0 px-6 pt-5">
                            <div className="max-w-2xl mx-auto">
                                <StatsStrip thread={thread} now={now} />
                            </div>
                        </div>

                        <TimelineScroller thread={thread} />
                    </motion.div>
                ) : (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex flex-col items-center justify-center text-gray-300"
                    >
                        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                            <Inbox className="w-7 h-7 text-gray-300" />
                        </div>
                        <p className="text-sm font-medium text-gray-400">Select a thread</p>
                        <p className="text-xs text-gray-300 mt-1">Every call, text and email with a lead lives here</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}

/**
 * The timeline opens on the newest touch, like a chat — that is what the
 * operator came to see. It stays pinned to the bottom while the content is
 * still settling (fonts, late layout) or growing (a live transcript), and
 * lets go the moment the operator scrolls up to read history.
 */
function TimelineScroller({ thread }: { thread: UniboxThread }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        const content = contentRef.current;
        if (!el || !content) return;

        let pinned = true;
        const anchor = () => {
            if (pinned) el.scrollTop = el.scrollHeight;
        };
        const onScroll = () => {
            pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        };

        anchor();
        const observer = new ResizeObserver(anchor);
        observer.observe(content);
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            observer.disconnect();
            el.removeEventListener("scroll", onScroll);
        };
    }, [thread.id]);

    return (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div ref={contentRef} className="max-w-2xl mx-auto px-6 pt-6 pb-10">
                <Timeline thread={thread} />
            </div>
        </div>
    );
}

function Dot() {
    return <span className="text-gray-200">·</span>;
}

function ThreadHeader({
    thread,
    onEndCall,
    isEnding,
}: {
    thread: UniboxThread;
    onEndCall?: () => void;
    isEnding: boolean;
}) {
    const meta = STATUS_META[thread.status];
    return (
        <div
            className={cn(
                "shrink-0 px-6 py-4 border-b flex items-center justify-between gap-4",
                thread.hasLiveCall ? "bg-emerald-50/80 border-emerald-100" : "bg-white border-gray-200/80"
            )}
        >
            <div className="flex items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-[13px] shrink-0">
                    {thread.hasLiveCall ? <Radio className="w-5 h-5 animate-pulse" /> : initialsFor(thread.name)}
                </div>
                <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 text-[15px] flex items-center gap-2 flex-wrap">
                        <span className="truncate">{threadDisplayName(thread)}</span>
                        <span
                            className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                meta.chip
                            )}
                        >
                            {meta.label}
                        </span>
                        {thread.hasLiveCall && (
                            <Badge className="bg-emerald-500 text-white border-0 text-[10px] font-bold uppercase tracking-wide gap-1">
                                <PulsingDot />
                                Live
                            </Badge>
                        )}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                        {thread.name && <span>{formatPhone(thread.phone)}</span>}
                        {thread.location && (
                            <>
                                <Dot />
                                <span>{thread.location}</span>
                            </>
                        )}
                        {thread.company && (
                            <>
                                <Dot />
                                <span className="truncate max-w-[220px]">{thread.company}</span>
                            </>
                        )}
                        {thread.agentName && (
                            <>
                                <Dot />
                                <span>{thread.agentName}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {thread.pipelineStage && (
                    <Badge variant="outline" className="text-[11px]">
                        {thread.pipelineStage}
                    </Badge>
                )}
                {thread.email && (
                    <a
                        href={`mailto:${thread.email}`}
                        className="hidden lg:inline text-[11px] text-gray-500 hover:text-emerald-700 hover:underline underline-offset-2 truncate max-w-[200px]"
                    >
                        {thread.email}
                    </a>
                )}
                {onEndCall && (
                    <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={onEndCall}
                        disabled={isEnding}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                    >
                        <PhoneOff className="w-3.5 h-3.5" />
                        {isEnding ? "Ending..." : "End Call"}
                    </motion.button>
                )}
            </div>
        </div>
    );
}

function StatsStrip({ thread, now }: { thread: UniboxThread; now: number }) {
    return (
        <Card className="overflow-hidden border-gray-100">
            <div className="grid grid-cols-[max-content_max-content_max-content_max-content_minmax(0,1fr)] divide-x divide-gray-100">
                <Stat label="Touches" value={String(thread.touches)} />
                <Stat label="Channels" value={channelLine(thread) || "—"} />
                <Stat label="First touch" value={thread.firstTouchAt ? dateLabel(thread.firstTouchAt) : "—"} />
                <Stat label="Last response" value={longAgo(thread.lastResponseAt, now)} accent={!!thread.lastResponseAt} />
                <Stat label="Sequence" value={thread.sequenceProgress ?? "—"} hint={thread.sequenceName ?? undefined} />
            </div>
        </Card>
    );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
    return (
        <div className="px-4 py-3 min-w-0">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
            <div
                className={cn("text-[13px] font-semibold mt-1 truncate", accent ? "text-emerald-700" : "text-gray-900")}
                title={hint}
                suppressHydrationWarning
            >
                {value}
            </div>
            {hint && <div className="text-[10px] text-gray-400 truncate mt-0.5">{hint}</div>}
        </div>
    );
}

type TimelineBlock =
    | { kind: "voice"; event: UniboxEvent }
    | { kind: "email"; event: UniboxEvent }
    | { kind: "sms"; events: UniboxEvent[] };

/**
 * Consecutive texts collapse into one SMS card, so the timeline reads as a
 * flow of channel boxes (call → texts → email …) rather than loose bubbles
 * next to cards. A call or email in between splits the run, keeping order.
 */
function blocksFor(events: UniboxEvent[]): TimelineBlock[] {
    const blocks: TimelineBlock[] = [];
    for (const e of events) {
        const last = blocks[blocks.length - 1];
        if (e.kind === "sms") {
            if (last?.kind === "sms") last.events.push(e);
            else blocks.push({ kind: "sms", events: [e] });
        } else {
            blocks.push({ kind: e.kind, event: e });
        }
    }
    return blocks;
}

function Timeline({ thread }: { thread: UniboxThread }) {
    const groups: Array<{ key: string; label: string; events: UniboxEvent[] }> = [];
    for (const e of thread.events) {
        const key = dayKey(e.at);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.events.push(e);
        else groups.push({ key, label: dayLabel(e.at), events: [e] });
    }

    const leadInitials = initialsFor(thread.name);
    const leadFirstName = thread.name?.split(/\s+/)[0] ?? null;
    const agentLabel = thread.agentName ?? "AI agent";

    return (
        <div className="space-y-6">
            {groups.map((g) => (
                <div key={g.key} className="space-y-3">
                    <DaySeparator label={g.label} />
                    {blocksFor(g.events).map((block, i) => {
                        const key = block.kind === "sms" ? block.events[0].id : block.event.id;
                        return (
                            <motion.div
                                key={key}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.04 }}
                            >
                                {block.kind === "voice" ? (
                                    <VoiceCard
                                        event={block.event}
                                        agentLabel={block.event.agentName ?? agentLabel}
                                        leadInitials={leadInitials}
                                    />
                                ) : block.kind === "email" ? (
                                    <EmailCard event={block.event} agentLabel={agentLabel} leadFirstName={leadFirstName} />
                                ) : (
                                    <SmsCard
                                        events={block.events}
                                        agentLabel={agentLabel}
                                        leadInitials={leadInitials}
                                    />
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

function DaySeparator({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200/80" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400" suppressHydrationWarning>
                {label}
            </span>
            <div className="h-px flex-1 bg-gray-200/80" />
        </div>
    );
}

/** One header shape for every channel box: icon · title · who, then status · time on the right. */
function ChannelHeader({
    icon,
    tone,
    title,
    subtitle,
    right,
}: {
    icon: React.ReactNode;
    tone: string;
    title: string;
    subtitle?: string | null;
    right?: React.ReactNode;
}) {
    return (
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-50">
            <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", tone)}>{icon}</div>
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900">{title}</div>
                    {subtitle && <div className="text-[11px] text-gray-400 truncate">{subtitle}</div>}
                </div>
            </div>
            {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
        </div>
    );
}

function StatusChip({ label, tone, live }: { label: string; tone: string; live?: boolean }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide",
                tone
            )}
        >
            {live && <PulsingDot className="h-1.5 w-1.5" />}
            {label}
        </span>
    );
}

function TimeStamp({ iso }: { iso: string }) {
    return (
        <span className="text-[11px] text-gray-400" suppressHydrationWarning>
            {timeLabel(iso)}
        </span>
    );
}

const OUTCOME_TONE = {
    replied: "bg-emerald-50 text-emerald-700",
    ok: "bg-gray-100 text-gray-500",
    pending: "bg-amber-50 text-amber-700",
    failed: "bg-red-50 text-red-600",
};

const FAILED_OUTCOMES = new Set(["failed", "undelivered", "bounced", "error"]);
const PENDING_OUTCOMES = new Set(["queued", "sending", "pending", "accepted", "scheduled"]);

function outcomeTone(outcome: string): string {
    if (outcome === "replied") return OUTCOME_TONE.replied;
    if (FAILED_OUTCOMES.has(outcome)) return OUTCOME_TONE.failed;
    if (PENDING_OUTCOMES.has(outcome)) return OUTCOME_TONE.pending;
    return OUTCOME_TONE.ok;
}

/** Lead on the left, the AI agent on the right — the operator reads it like their own inbox. */
function Bubble({
    speaker,
    text,
    leadInitials,
    meta,
}: {
    speaker: "lead" | "agent";
    text: string;
    leadInitials: string;
    meta?: string;
}) {
    const isLead = speaker === "lead";
    return (
        <div className={cn("flex gap-2.5", isLead ? "flex-row" : "flex-row-reverse")}>
            <div
                className={cn(
                    "w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold",
                    isLead ? "bg-gray-100 text-gray-600" : "bg-emerald-100 text-emerald-700"
                )}
            >
                {isLead ? leadInitials : <Bot className="w-3.5 h-3.5" />}
            </div>
            <div className={cn("max-w-[78%] flex flex-col gap-1", isLead ? "items-start" : "items-end")}>
                <div
                    className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap",
                        isLead ? "bg-gray-100 text-gray-700 rounded-tl-md" : "bg-emerald-600 text-white rounded-tr-md"
                    )}
                >
                    {text}
                </div>
                {meta && (
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 px-1" suppressHydrationWarning>
                        {meta}
                    </div>
                )}
            </div>
        </div>
    );
}

function VoiceCard({ event, agentLabel, leadInitials }: { event: UniboxEvent; agentLabel: string; leadInitials: string }) {
    const isLive = !!event.isLive;
    const disposition = (event.disposition as Disposition | undefined) ?? (isLive ? "live" : "answered");
    const inbound = event.direction === "inbound";
    const iconTone = isLive ? "bg-emerald-100 text-emerald-600" : DISPOSITION_ICON_TONE[disposition];
    const transcript = event.transcript ?? [];

    return (
        <Card className="overflow-hidden border-gray-100">
            <ChannelHeader
                icon={
                    isLive ? (
                        <Radio className="w-4 h-4 animate-pulse" />
                    ) : inbound ? (
                        <PhoneIncoming className="w-4 h-4" />
                    ) : (
                        <PhoneOutgoing className="w-4 h-4" />
                    )
                }
                tone={iconTone}
                title={inbound ? "Inbound call" : "Voice call"}
                subtitle={agentLabel}
                right={
                    <>
                        <StatusChip label={DISPOSITION_LABEL[disposition]} tone={DISPOSITION_TONE[disposition]} live={isLive} />
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="w-3 h-3" />
                            {isLive ? <LiveDuration startedAt={event.at} /> : formatDuration(event.durationSeconds)}
                        </span>
                        <TimeStamp iso={event.at} />
                    </>
                }
            />

            {event.recordingUrl && !isLive && (
                <div className="px-4 pt-3">
                    <AudioPlayer src={event.recordingUrl} />
                </div>
            )}

            {event.summary && (
                <div className="px-4 pt-3 flex gap-2 text-[13px] text-gray-600 leading-relaxed">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500 mt-1 shrink-0" />
                    <p>{event.summary}</p>
                </div>
            )}

            <div className="px-4 py-4 space-y-2.5">
                {transcript.length > 0 ? (
                    transcript.map((line, i) => (
                        <Bubble key={i} speaker={line.speaker} text={line.text} leadInitials={leadInitials} />
                    ))
                ) : (
                    <p className="text-xs text-gray-300 text-center py-2">
                        {isLive ? "Waiting for conversation…" : "No transcript"}
                    </p>
                )}
                {isLive && (
                    <div className="flex justify-center pt-1">
                        <span className="text-xs text-emerald-500 animate-pulse flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-full">
                            <Radio className="w-3 h-3" />
                            Listening…
                        </span>
                    </div>
                )}
                {event.appointmentBooked && <Marker tone="emerald" icon={<CalendarCheck className="w-3 h-3" />} text="Meeting booked" />}
            </div>
        </Card>
    );
}

function SmsCard({ events, agentLabel, leadInitials }: { events: UniboxEvent[]; agentLabel: string; leadInitials: string }) {
    const replied = events.some((e) => e.direction === "inbound");
    const last = events[events.length - 1];
    const outcome = replied ? "replied" : (last.outcome ?? "sent").toLowerCase();

    return (
        <Card className="overflow-hidden border-gray-100">
            <ChannelHeader
                icon={<MessageSquare className="w-4 h-4" />}
                tone={replied ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}
                title="Text messages"
                subtitle={`${agentLabel} · ${events.length} message${events.length === 1 ? "" : "s"}`}
                right={
                    <>
                        <StatusChip label={titleCase(outcome)} tone={outcomeTone(outcome)} />
                        <TimeStamp iso={last.at} />
                    </>
                }
            />
            <div className="px-4 py-4 space-y-2.5">
                {events.map((e) => {
                    const isLead = e.direction === "inbound";
                    const detail = isLead
                        ? e.intent && e.intent !== "unknown"
                            ? titleCase(e.intent)
                            : null
                        : e.outcome
                          ? titleCase(e.outcome)
                          : null;
                    const meta = [timeLabel(e.at), detail].filter(Boolean).join(" · ");
                    return (
                        <div key={e.id} className="space-y-2.5">
                            <Bubble
                                speaker={isLead ? "lead" : "agent"}
                                text={e.body || "(empty message)"}
                                leadInitials={leadInitials}
                                meta={meta}
                            />
                            {e.appointmentBooked && <Marker tone="emerald" icon={<CalendarCheck className="w-3 h-3" />} text="Meeting booked" />}
                            {isLead && e.intent === "stop" && (
                                <Marker tone="red" icon={<Ban className="w-3 h-3" />} text="Opted out · all channels stopped" />
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

function EmailCard({
    event,
    agentLabel,
    leadFirstName,
}: {
    event: UniboxEvent;
    agentLabel: string;
    leadFirstName: string | null;
}) {
    const isLead = event.direction === "inbound";
    const outcome = (event.outcome ?? (isLead ? "replied" : "sent")).toLowerCase();

    return (
        <Card className="overflow-hidden border-gray-100">
            <ChannelHeader
                icon={<Mail className="w-4 h-4" />}
                tone={isLead ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}
                title="Email"
                subtitle={isLead ? `From ${leadFirstName ?? "the lead"}` : agentLabel}
                right={
                    <>
                        <StatusChip label={titleCase(outcome)} tone={isLead ? OUTCOME_TONE.replied : outcomeTone(outcome)} />
                        <TimeStamp iso={event.at} />
                    </>
                }
            />
            <div className="px-4 py-4 space-y-3">
                <div>
                    {event.subject && <div className="text-[13px] font-semibold text-gray-900 mb-1.5">{event.subject}</div>}
                    <p className="text-[13px] text-gray-600 whitespace-pre-wrap leading-relaxed">{event.body || "(no body)"}</p>
                </div>
                {event.appointmentBooked && <Marker tone="emerald" icon={<CalendarCheck className="w-3 h-3" />} text="Meeting booked" />}
            </div>
        </Card>
    );
}

function Marker({ tone, icon, text }: { tone: "emerald" | "red"; icon: React.ReactNode; text: string }) {
    return (
        <div className="flex justify-center">
            <span
                className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide",
                    tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                )}
            >
                {icon}
                {text}
            </span>
        </div>
    );
}

function LiveDuration({ startedAt }: { startedAt: string }) {
    const [duration, setDuration] = useState("0:00");

    useEffect(() => {
        const update = () => {
            const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
            setDuration(formatDuration(seconds));
        };
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [startedAt]);

    return <span>{duration}</span>;
}

function AudioPlayer({ src }: { src: string }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
            setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
        };
        const onLoadedMetadata = () => setDuration(audio.duration);
        const onEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        };

        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("loadedmetadata", onLoadedMetadata);
        audio.addEventListener("ended", onEnded);

        return () => {
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            audio.removeEventListener("ended", onEnded);
        };
    }, [src]);

    const toggle = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) audio.pause();
        else audio.play();
        setIsPlaying(!isPlaying);
    };

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
    };

    return (
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
            <audio ref={audioRef} src={src} preload="metadata" />
            <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={toggle}
                className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
                    isPlaying
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-200"
                        : "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                )}
            >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </motion.button>
            <div className="flex-1 min-w-0">
                <div className="h-1.5 bg-gray-200 rounded-full cursor-pointer overflow-hidden" onClick={seek}>
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-gray-400 font-mono tabular-nums">{formatDuration(currentTime)}</span>
                    <span className="text-[10px] text-gray-400 font-mono tabular-nums">{formatDuration(duration)}</span>
                </div>
            </div>
        </div>
    );
}
