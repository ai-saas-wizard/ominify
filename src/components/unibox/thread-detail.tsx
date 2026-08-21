"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Ban,
    Bot,
    CalendarCheck,
    Clock,
    Inbox,
    Mail,
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
import { CHANNEL_LABEL, STATUS_META, type UniboxEvent, type UniboxThread } from "@/lib/unibox/types";
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
    voicemail: "bg-amber-50 text-amber-700",
    no_answer: "bg-gray-100 text-gray-500",
    busy: "bg-orange-50 text-orange-700",
    failed: "bg-red-50 text-red-600",
    live: "bg-emerald-500 text-white",
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
        <section className="flex-1 min-w-0 flex flex-col bg-[#fafafa] h-full overflow-hidden">
            <AnimatePresence mode="wait">
                {thread ? (
                    <motion.div
                        key={thread.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        className="flex flex-col h-full min-h-0"
                    >
                        <ThreadHeader thread={thread} onEndCall={liveEvent ? handleEndCall : undefined} isEnding={isEnding} />

                        <div className="flex-1 min-h-0 overflow-y-auto">
                            <div className="max-w-2xl mx-auto px-6 pt-6 pb-12 space-y-6">
                                <StatsStrip thread={thread} now={now} />
                                <Timeline thread={thread} />
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex-1 flex flex-col items-center justify-center text-gray-300"
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

    return (
        <div className="space-y-6">
            {groups.map((g) => (
                <div key={g.key} className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-gray-200/80" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400" suppressHydrationWarning>
                            {g.label}
                        </span>
                        <div className="h-px flex-1 bg-gray-200/80" />
                    </div>
                    {g.events.map((e, i) => (
                        <motion.div
                            key={e.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.04 }}
                            className="space-y-3"
                        >
                            <EventItem event={e} thread={thread} leadInitials={leadInitials} leadFirstName={leadFirstName} />
                            {e.appointmentBooked && <Marker tone="emerald" icon={<CalendarCheck className="w-3 h-3" />} text="Meeting booked" />}
                            {e.direction === "inbound" && e.intent === "stop" && (
                                <Marker tone="red" icon={<Ban className="w-3 h-3" />} text="Opted out · all channels stopped" />
                            )}
                        </motion.div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function EventItem({
    event,
    thread,
    leadInitials,
    leadFirstName,
}: {
    event: UniboxEvent;
    thread: UniboxThread;
    leadInitials: string;
    leadFirstName: string | null;
}) {
    const agentLabel = event.agentName ?? thread.agentName ?? "AI agent";
    const isLead = event.direction === "inbound";
    const who = isLead ? leadFirstName ?? "Lead" : agentLabel;

    if (event.kind === "voice") return <VoiceCard event={event} agentLabel={agentLabel} leadInitials={leadInitials} />;

    if (event.kind === "email") {
        const meta = [CHANNEL_LABEL.email, who, timeLabel(event.at), event.outcome ? titleCase(event.outcome) : null]
            .filter(Boolean)
            .join(" · ");
        return (
            <div className={cn("flex", isLead ? "justify-start" : "justify-end")}>
                <Card className="max-w-[85%] border-gray-100 overflow-hidden">
                    <div className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-400 mb-1.5" suppressHydrationWarning>
                            <Mail className="w-3 h-3" />
                            {meta}
                        </div>
                        {event.subject && <div className="text-[13px] font-semibold text-gray-900 mb-1">{event.subject}</div>}
                        <p className="text-[13px] text-gray-600 whitespace-pre-wrap leading-relaxed">{event.body || "(no body)"}</p>
                    </div>
                </Card>
            </div>
        );
    }

    const detail = isLead
        ? event.intent && event.intent !== "unknown"
            ? titleCase(event.intent)
            : null
        : event.outcome
          ? titleCase(event.outcome)
          : null;
    const meta = [CHANNEL_LABEL.sms, who, timeLabel(event.at), detail].filter(Boolean).join(" · ");

    return (
        <Bubble
            speaker={isLead ? "lead" : "agent"}
            text={event.body || "(empty message)"}
            leadInitials={leadInitials}
            meta={meta}
        />
    );
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
    const iconTone = isLive
        ? "bg-emerald-100 text-emerald-600"
        : disposition === "answered"
          ? "bg-emerald-50 text-emerald-600"
          : disposition === "voicemail"
            ? "bg-amber-50 text-amber-500"
            : disposition === "failed"
              ? "bg-red-50 text-red-500"
              : "bg-gray-100 text-gray-500";
    const transcript = event.transcript ?? [];

    return (
        <Card className="overflow-hidden border-gray-100">
            <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-50">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", iconTone)}>
                        {isLive ? (
                            <Radio className="w-4 h-4 animate-pulse" />
                        ) : inbound ? (
                            <PhoneIncoming className="w-4 h-4" />
                        ) : (
                            <PhoneOutgoing className="w-4 h-4" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-gray-900">{inbound ? "Inbound call" : "Voice call"}</div>
                        <div className="text-[11px] text-gray-400 truncate">{agentLabel}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide",
                            DISPOSITION_TONE[disposition]
                        )}
                    >
                        {isLive && <PulsingDot className="h-1.5 w-1.5" />}
                        {DISPOSITION_LABEL[disposition]}
                    </span>
                    <span className="text-[11px] text-gray-500 flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="w-3 h-3" />
                        {isLive ? <LiveDuration startedAt={event.at} /> : formatDuration(event.durationSeconds)}
                    </span>
                    <span className="text-[11px] text-gray-400" suppressHydrationWarning>
                        {timeLabel(event.at)}
                    </span>
                </div>
            </div>

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
