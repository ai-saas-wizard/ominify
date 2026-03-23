"use client";

import { VapiCall, VapiPhoneNumber } from "@/lib/vapi";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";
import {
    Phone,
    Clock,
    User,
    Search,
    PhoneIncoming,
    PhoneOutgoing,
    Sparkles,
    Radio,
    PhoneOff,
    Play,
    Pause,
    Bot,
    ChevronRight,
    Mic,
    PhoneMissed,
    Headphones,
} from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ActiveCall } from "./logs-page-client";
import { endActiveCall } from "@/app/actions/call-actions";
import type { ClientAgent } from "@/app/client/[clientId]/logs/page";

type DisplayCall = VapiCall & { isLive?: boolean };

interface LogViewerWithLiveProps {
    calls: VapiCall[];
    agents: ClientAgent[];
    phoneNumbers: VapiPhoneNumber[];
    activeCalls: ActiveCall[];
    clientId: string;
}

function activeCallToDisplayCall(activeCall: ActiveCall): DisplayCall {
    return {
        id: activeCall.vapi_call_id,
        assistantId: activeCall.assistant_id ?? undefined,
        status: activeCall.status,
        startedAt: activeCall.started_at ?? undefined,
        customer: { number: activeCall.customer_number ?? undefined },
        analysis: activeCall.summary ? { summary: activeCall.summary } : undefined,
        transcript: activeCall.transcript ?? undefined,
        type: activeCall.type,
        isLive: true,
        messages: activeCall.transcript ?
            activeCall.transcript.split('\n').filter(Boolean).map((line) => {
                const [role, ...msgParts] = line.split(': ');
                return {
                    role: role.toLowerCase() === 'user' ? 'user' : 'bot',
                    message: msgParts.join(': ') || line
                };
            }) : undefined
    } as DisplayCall;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
    const [duration, setDuration] = useState('0:00');

    useEffect(() => {
        const update = () => {
            const start = new Date(startedAt);
            const now = new Date();
            const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            setDuration(`${mins}:${secs.toString().padStart(2, '0')}`);
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [startedAt]);

    return <span className="font-mono tabular-nums">{duration}</span>;
}

function formatDuration(seconds?: number): string {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCallTime(dateStr: string): string {
    const date = new Date(dateStr);
    if (isToday(date)) return format(date, 'h:mm a');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMM d');
}

function getCallTypeIcon(type?: string, isLive?: boolean) {
    if (isLive) return <Radio className="w-3.5 h-3.5" />;
    if (type === 'inboundPhoneCall') return <PhoneIncoming className="w-3.5 h-3.5" />;
    if (type === 'outboundPhoneCall') return <PhoneOutgoing className="w-3.5 h-3.5" />;
    return <Phone className="w-3.5 h-3.5" />;
}

function getStatusConfig(status: string, endedReason?: string, isLive?: boolean) {
    if (isLive) return { label: 'Live', color: 'bg-emerald-500', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50' };

    const reason = endedReason?.toLowerCase() || '';
    if (reason.includes('customer-did-not-answer') || reason.includes('no-answer'))
        return { label: 'Missed', color: 'bg-amber-500', textColor: 'text-amber-700', bgColor: 'bg-amber-50' };
    if (reason.includes('customer-busy'))
        return { label: 'Busy', color: 'bg-orange-500', textColor: 'text-orange-700', bgColor: 'bg-orange-50' };
    if (reason.includes('error') || reason.includes('failed'))
        return { label: 'Failed', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50' };
    if (status === 'ended')
        return { label: 'Completed', color: 'bg-blue-500', textColor: 'text-blue-700', bgColor: 'bg-blue-50' };
    return { label: status, color: 'bg-gray-500', textColor: 'text-gray-700', bgColor: 'bg-gray-50' };
}

// Audio player component
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
        const onEnded = () => { setIsPlaying(false); setProgress(0); setCurrentTime(0); };

        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('ended', onEnded);

        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('ended', onEnded);
        };
    }, [src]);

    const toggle = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) { audio.pause(); } else { audio.play(); }
        setIsPlaying(!isPlaying);
    };

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * duration;
    };

    const fmtTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
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
                        ? "bg-violet-600 text-white shadow-lg shadow-violet-200"
                        : "bg-violet-100 text-violet-600 hover:bg-violet-200"
                )}
            >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </motion.button>
            <div className="flex-1 min-w-0">
                <div className="h-1.5 bg-gray-200 rounded-full cursor-pointer overflow-hidden" onClick={seek}>
                    <motion.div
                        className="h-full bg-violet-500 rounded-full"
                        style={{ width: `${progress}%` }}
                        transition={{ duration: 0.1 }}
                    />
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-gray-400 font-mono tabular-nums">{fmtTime(currentTime)}</span>
                    <span className="text-[10px] text-gray-400 font-mono tabular-nums">{fmtTime(duration)}</span>
                </div>
            </div>
        </div>
    );
}

// Pulsing dot for live indicator
function PulsingDot({ className }: { className?: string }) {
    return (
        <span className={cn("relative flex h-2.5 w-2.5", className)}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
    );
}

export const LogViewerWithLive = ({ calls, agents, phoneNumbers, activeCalls, clientId }: LogViewerWithLiveProps) => {
    const [selectedAgentVapiId, setSelectedAgentVapiId] = useState<string | null>(null);
    const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
    const [isEndingCall, setIsEndingCall] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const liveDisplayCalls: DisplayCall[] = activeCalls.map(activeCallToDisplayCall);
    const allCalls: DisplayCall[] = [...liveDisplayCalls, ...calls];

    useEffect(() => {
        if (!selectedCallId && allCalls.length > 0) {
            setSelectedCallId(allCalls[0].id);
        }
    }, [allCalls.length]);

    // Filter by agent (using vapi_id) and search
    const filteredCalls = useMemo(() => {
        let result = selectedAgentVapiId
            ? allCalls.filter(c => c.assistantId === selectedAgentVapiId)
            : allCalls;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(c =>
                c.customer?.number?.toLowerCase().includes(q) ||
                c.analysis?.summary?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [allCalls, selectedAgentVapiId, searchQuery]);

    const selectedCall = allCalls.find(c => c.id === selectedCallId);
    const isSelectedLive = selectedCall?.isLive === true;

    const getAgentName = (vapiId?: string) => {
        if (!vapiId) return 'Unknown Agent';
        const agent = agents.find(a => a.vapi_id === vapiId);
        return agent ? agent.name : 'Unknown Agent';
    };

    const getAgentNumber = (vapiId: string) => {
        const pn = phoneNumbers.find(p => p.assistantId === vapiId);
        return pn ? pn.number : null;
    };

    const getAgentCallCount = (vapiId: string) => {
        return allCalls.filter(c => c.assistantId === vapiId).length;
    };

    const handleEndCall = async () => {
        if (!selectedCallId || !isSelectedLive) return;
        setIsEndingCall(true);
        try {
            const result = await endActiveCall(clientId, selectedCallId);
            if (!result.success) {
                console.error("Failed to end call:", result.error);
            }
        } catch (error) {
            console.error("Error ending call:", error);
        } finally {
            setIsEndingCall(false);
        }
    };

    const liveCallCount = activeCalls.length;

    return (
        <div className="flex h-[calc(100vh-64px)] bg-[#fafafa]">
            {/* Column 1: Agent Sidebar */}
            <div className="w-[260px] border-r border-gray-200/80 flex flex-col bg-white">
                <div className="p-4 pb-3">
                    <h2 className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider">Agents</h2>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                    <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedAgentVapiId(null)}
                        className={cn(
                            "w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-all duration-200",
                            selectedAgentVapiId === null
                                ? "bg-violet-50 border border-violet-100 shadow-sm"
                                : "hover:bg-gray-50 border border-transparent"
                        )}
                    >
                        <div className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
                            selectedAgentVapiId === null ? "bg-violet-100 text-violet-600" : "bg-gray-100 text-gray-400"
                        )}>
                            <Headphones className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className={cn(
                                "font-semibold text-[13px] truncate",
                                selectedAgentVapiId === null ? "text-violet-900" : "text-gray-700"
                            )}>All Calls</div>
                            <div className="text-[11px] text-gray-400">{allCalls.length} total</div>
                        </div>
                        {liveCallCount > 0 && (
                            <div className="flex items-center gap-1.5">
                                <PulsingDot />
                                <span className="text-[11px] font-semibold text-emerald-600">{liveCallCount}</span>
                            </div>
                        )}
                    </motion.button>

                    {agents.map(agent => {
                        const isSelected = selectedAgentVapiId === agent.vapi_id;
                        const count = getAgentCallCount(agent.vapi_id);
                        const hasLive = liveDisplayCalls.some(c => c.assistantId === agent.vapi_id);
                        const number = getAgentNumber(agent.vapi_id);
                        const typeIcon = agent.agent_type === 'inbound'
                            ? <PhoneIncoming className="w-4 h-4" />
                            : agent.agent_type === 'outbound'
                                ? <PhoneOutgoing className="w-4 h-4" />
                                : <Phone className="w-4 h-4" />;

                        return (
                            <motion.button
                                key={agent.id}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setSelectedAgentVapiId(agent.vapi_id)}
                                className={cn(
                                    "w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-all duration-200",
                                    isSelected
                                        ? "bg-violet-50 border border-violet-100 shadow-sm"
                                        : "hover:bg-gray-50 border border-transparent"
                                )}
                            >
                                <div className={cn(
                                    "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
                                    isSelected ? "bg-violet-100 text-violet-600" : "bg-gray-100 text-gray-400"
                                )}>
                                    {typeIcon}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className={cn(
                                        "font-semibold text-[13px] truncate",
                                        isSelected ? "text-violet-900" : "text-gray-700"
                                    )}>{agent.name}</div>
                                    <div className="text-[11px] text-gray-400 truncate">
                                        {number || `${count} calls`}
                                    </div>
                                </div>
                                {hasLive && <PulsingDot />}
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            {/* Column 2: Call List */}
            <div className="w-[340px] border-r border-gray-200/80 flex flex-col bg-white h-full">
                {/* Search Header */}
                <div className="px-4 pt-4 pb-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-gray-900">Calls</h2>
                            <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                                {filteredCalls.length}
                            </span>
                        </div>
                        {liveCallCount > 0 && (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1.5">
                                <PulsingDot />
                                {liveCallCount} live
                            </Badge>
                        )}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                        <input
                            type="text"
                            placeholder="Search calls..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 placeholder:text-gray-300 transition-all"
                        />
                    </div>
                </div>

                {/* Call List */}
                <div className="flex-1 overflow-y-auto">
                    <AnimatePresence initial={false}>
                        {filteredCalls.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center justify-center py-20 text-gray-300"
                            >
                                <Phone className="w-10 h-10 mb-3" />
                                <p className="text-sm font-medium">No calls found</p>
                            </motion.div>
                        ) : (
                            filteredCalls.map((call, index) => {
                                const isSelected = call.id === selectedCallId;
                                const isLive = call.isLive === true;
                                const statusConfig = getStatusConfig(call.status, call.endedReason, isLive);
                                const agentName = getAgentName(call.assistantId);

                                return (
                                    <motion.div
                                        key={call.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{ duration: 0.2, delay: index < 10 ? index * 0.03 : 0 }}
                                        onClick={() => setSelectedCallId(call.id)}
                                        className={cn(
                                            "group relative px-4 py-3.5 cursor-pointer transition-all duration-200 border-b border-gray-50",
                                            isSelected
                                                ? "bg-violet-50/60"
                                                : "hover:bg-gray-50/80",
                                            isLive && !isSelected && "bg-emerald-50/30"
                                        )}
                                    >
                                        {/* Selection indicator */}
                                        <motion.div
                                            initial={false}
                                            animate={{
                                                opacity: isSelected ? 1 : 0,
                                                scaleY: isSelected ? 1 : 0.5,
                                            }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-violet-500"
                                        />

                                        <div className="flex items-center gap-3">
                                            {/* Call type icon */}
                                            <div className={cn(
                                                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                                                isLive
                                                    ? "bg-emerald-100 text-emerald-600"
                                                    : statusConfig.label === 'Missed'
                                                        ? "bg-amber-50 text-amber-500"
                                                        : statusConfig.label === 'Failed'
                                                            ? "bg-red-50 text-red-500"
                                                            : "bg-gray-100 text-gray-500"
                                            )}>
                                                {isLive ? (
                                                    <Radio className="w-4.5 h-4.5 animate-pulse" />
                                                ) : statusConfig.label === 'Missed' ? (
                                                    <PhoneMissed className="w-4.5 h-4.5" />
                                                ) : (
                                                    getCallTypeIcon(call.type)
                                                )}
                                            </div>

                                            {/* Call info */}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={cn(
                                                        "font-semibold text-[13px] truncate",
                                                        isSelected ? "text-violet-900" : "text-gray-900"
                                                    )}>
                                                        {call.customer?.number || "Unknown"}
                                                    </span>
                                                    {isLive && (
                                                        <Badge className="bg-emerald-500 text-white border-0 text-[9px] px-1.5 py-0 font-bold uppercase tracking-wide">
                                                            Live
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                                                    <span className="truncate">{agentName}</span>
                                                    {!isLive && call.durationSeconds != null && (
                                                        <>
                                                            <span className="text-gray-200">·</span>
                                                            <span className="font-mono tabular-nums">{formatDuration(call.durationSeconds)}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Time & status */}
                                            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                                                <span className={cn(
                                                    "text-[11px] font-medium",
                                                    isLive ? "text-emerald-600" : "text-gray-400"
                                                )}>
                                                    {isLive ? (
                                                        <LiveDuration startedAt={call.startedAt!} />
                                                    ) : (
                                                        call.startedAt && formatCallTime(call.startedAt)
                                                    )}
                                                </span>
                                                <div className={cn(
                                                    "w-1.5 h-1.5 rounded-full",
                                                    statusConfig.color
                                                )} />
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Column 3: Call Details */}
            <div className="flex-1 flex flex-col bg-[#fafafa] h-full overflow-hidden">
                <AnimatePresence mode="wait">
                    {selectedCall ? (
                        <motion.div
                            key={selectedCall.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.25 }}
                            className="flex flex-col h-full"
                        >
                            {/* Detail Header */}
                            <div className={cn(
                                "shrink-0 px-6 py-4 border-b flex items-center justify-between",
                                isSelectedLive
                                    ? "bg-emerald-50/80 border-emerald-100"
                                    : "bg-white border-gray-200/80"
                            )}>
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "w-11 h-11 rounded-full flex items-center justify-center",
                                        isSelectedLive
                                            ? "bg-emerald-100 text-emerald-600"
                                            : "bg-violet-100 text-violet-600"
                                    )}>
                                        {isSelectedLive ? <Radio className="w-5 h-5 animate-pulse" /> : <User className="w-5 h-5" />}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-gray-900 text-[15px] flex items-center gap-2">
                                            {selectedCall.customer?.number || "Unknown Number"}
                                            {isSelectedLive && (
                                                <Badge className="bg-emerald-500 text-white border-0 text-[10px] font-bold uppercase tracking-wide gap-1">
                                                    <PulsingDot />
                                                    Live
                                                </Badge>
                                            )}
                                        </h3>
                                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                            <span>{getAgentName(selectedCall.assistantId)}</span>
                                            <span className="text-gray-200">·</span>
                                            {isSelectedLive ? (
                                                <span className="text-emerald-600 font-medium flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    <LiveDuration startedAt={selectedCall.startedAt!} />
                                                </span>
                                            ) : (
                                                <span>{selectedCall.startedAt && format(new Date(selectedCall.startedAt), 'MMM d, yyyy · h:mm a')}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
                                    {!isSelectedLive && selectedCall.type && (
                                        <Badge variant="outline" className="text-[11px] gap-1 capitalize">
                                            {getCallTypeIcon(selectedCall.type)}
                                            {selectedCall.type === 'inboundPhoneCall' ? 'Inbound' : 'Outbound'}
                                        </Badge>
                                    )}
                                    {isSelectedLive && (
                                        <motion.button
                                            whileTap={{ scale: 0.95 }}
                                            onClick={handleEndCall}
                                            disabled={isEndingCall}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                                        >
                                            <PhoneOff className="w-3.5 h-3.5" />
                                            {isEndingCall ? "Ending..." : "End Call"}
                                        </motion.button>
                                    )}
                                </div>
                            </div>

                            {/* Detail Content */}
                            <div className="flex-1 overflow-y-auto">
                                <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
                                    {/* Status + Duration Card */}
                                    <Card className="overflow-hidden border-gray-100">
                                        <div className="p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {(() => {
                                                        const sc = getStatusConfig(selectedCall.status, selectedCall.endedReason, isSelectedLive);
                                                        return (
                                                            <>
                                                                <div className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold", sc.bgColor, sc.textColor)}>
                                                                    {sc.label}
                                                                </div>
                                                                {selectedCall.endedReason && !isSelectedLive && (
                                                                    <span className="text-xs text-gray-400">{selectedCall.endedReason}</span>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                                {!isSelectedLive && selectedCall.durationSeconds != null && (
                                                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        <span className="font-mono tabular-nums">{formatDuration(selectedCall.durationSeconds)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </Card>

                                    {/* Recording */}
                                    {!isSelectedLive && selectedCall.recordingUrl && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.1 }}
                                        >
                                            <Card className="overflow-hidden border-gray-100">
                                                <div className="px-4 pt-3 pb-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Mic className="w-3.5 h-3.5 text-violet-500" />
                                                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recording</h4>
                                                    </div>
                                                </div>
                                                <div className="px-4 pb-4">
                                                    <AudioPlayer src={selectedCall.recordingUrl} />
                                                </div>
                                            </Card>
                                        </motion.div>
                                    )}

                                    {/* Summary */}
                                    {(selectedCall.analysis?.summary || isSelectedLive) && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.15 }}
                                        >
                                            <Card className="overflow-hidden border-gray-100">
                                                <div className="p-4">
                                                    <div className="flex items-center gap-2 mb-2.5">
                                                        <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                                                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                            {isSelectedLive ? 'Live Summary' : 'Summary'}
                                                        </h4>
                                                    </div>
                                                    <p className="text-sm text-gray-600 leading-relaxed">
                                                        {selectedCall.analysis?.summary || (isSelectedLive ? "Summary will appear as the conversation progresses..." : "No summary available.")}
                                                    </p>
                                                </div>
                                            </Card>
                                        </motion.div>
                                    )}

                                    {/* Transcript */}
                                    <motion.div
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.2 }}
                                    >
                                        <Card className="overflow-hidden border-gray-100">
                                            <div className="px-4 pt-4 pb-2">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <Bot className="w-3.5 h-3.5 text-violet-500" />
                                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Transcript</h4>
                                                </div>
                                            </div>
                                            <div className="px-4 pb-5 space-y-3">
                                                {selectedCall.messages && selectedCall.messages.filter(m => m.role !== 'system').length > 0 ? (
                                                    <>
                                                        {selectedCall.messages
                                                            .filter(msg => msg.role !== 'system')
                                                            .map((msg, i) => (
                                                                <motion.div
                                                                    key={i}
                                                                    initial={{ opacity: 0, y: 6 }}
                                                                    animate={{ opacity: 1, y: 0 }}
                                                                    transition={{ duration: 0.2, delay: i * 0.04 }}
                                                                    className={cn(
                                                                        "flex gap-2.5",
                                                                        msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                                                                    )}
                                                                >
                                                                    <Avatar className={cn(
                                                                        "w-7 h-7 shrink-0 text-[10px]",
                                                                        msg.role === 'user'
                                                                            ? "bg-violet-100 text-violet-600"
                                                                            : "bg-gray-100 text-gray-500"
                                                                    )}>
                                                                        <AvatarFallback>
                                                                            {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <div className={cn(
                                                                        "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                                                                        msg.role === 'user'
                                                                            ? "bg-violet-600 text-white rounded-tr-md"
                                                                            : "bg-gray-100 text-gray-700 rounded-tl-md"
                                                                    )}>
                                                                        {msg.message}
                                                                    </div>
                                                                </motion.div>
                                                            ))}
                                                        {isSelectedLive && (
                                                            <motion.div
                                                                initial={{ opacity: 0 }}
                                                                animate={{ opacity: 1 }}
                                                                className="flex justify-center pt-2"
                                                            >
                                                                <span className="text-xs text-emerald-500 animate-pulse flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-full">
                                                                    <Radio className="w-3 h-3" />
                                                                    Listening...
                                                                </span>
                                                            </motion.div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <div className="text-center py-8 text-gray-300">
                                                        <Bot className="w-8 h-8 mx-auto mb-2" />
                                                        <p className="text-sm">
                                                            {isSelectedLive ? "Waiting for conversation..." : "No transcript available"}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    </motion.div>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex-1 flex flex-col items-center justify-center text-gray-300"
                        >
                            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                                <Phone className="w-7 h-7 text-gray-300" />
                            </div>
                            <p className="text-sm font-medium text-gray-400">Select a call to view details</p>
                            <p className="text-xs text-gray-300 mt-1">Choose from the list on the left</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
