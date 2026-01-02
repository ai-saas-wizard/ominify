"use client";

import { VapiCall, VapiAgent, VapiPhoneNumber } from "@/lib/vapi";
import { format } from "date-fns";
import {
    Play,
    Pause,
    Clock,
    Phone,
    Calendar,
    User,
    Search,
    CheckCircle2,
    XCircle,
    MoreVertical,
    LayoutTemplate,
    PhoneForwarded,
    Sparkles
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface LogViewerProps {
    calls: VapiCall[];
    agents: VapiAgent[];
    phoneNumbers: VapiPhoneNumber[];
}

export const LogViewer = ({ calls, agents, phoneNumbers }: LogViewerProps) => {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [selectedCallId, setSelectedCallId] = useState<string | null>(calls[0]?.id || null);

    // Filter calls by selected agent
    const filteredCalls = selectedAgentId
        ? calls.filter(c => c.assistantId === selectedAgentId)
        : calls;

    const selectedCall = calls.find(c => c.id === selectedCallId);

    const getAgentName = (id?: string) => {
        if (!id) return 'Unknown Agent';
        const agent = agents.find(a => a.id === id);
        return agent ? agent.name : 'Unknown Agent';
    };

    const getAgentNumber = (agentId: string) => {
        const pn = phoneNumbers.find(p => p.assistantId === agentId);
        return pn ? pn.number : null;
    };

    return (
        <div className="flex h-[calc(100vh-64px)] bg-white">
            {/* Column 1: Agent Filter (Inbox Style) */}
            <div className="w-[300px] border-r border-gray-200 flex flex-col bg-gray-50/50">
                <div className="p-4 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Agents</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    <button
                        onClick={() => setSelectedAgentId(null)}
                        className={cn(
                            "w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors",
                            selectedAgentId === null ? "bg-white shadow-sm border border-gray-100" : "hover:bg-gray-100"
                        )}
                    >
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                            <LayoutTemplate className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="font-semibold text-gray-900 text-sm">All Calls</div>
                            <div className="text-xs text-gray-500">{calls.length} calls</div>
                        </div>
                    </button>
                    {agents.map(agent => (
                        <button
                            key={agent.id}
                            onClick={() => setSelectedAgentId(agent.id)}
                            className={cn(
                                "w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors",
                                selectedAgentId === agent.id ? "bg-white shadow-sm border border-gray-100" : "hover:bg-gray-100"
                            )}
                        >
                            <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600">
                                <Phone className="w-4 h-4" />
                            </div>
                            <div className="overflow-hidden">
                                <div className="font-semibold text-gray-900 text-sm truncate">{agent.name}</div>
                                <div className="text-xs text-gray-500 truncate">{getAgentNumber(agent.id) || 'No Number'}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Column 2: Call List */}
            <div className="w-[350px] border-r border-gray-200 flex flex-col bg-white h-full">
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-gray-900">Conversations</h2>
                        <span className="text-gray-400 font-medium text-sm">{filteredCalls.length}</span>
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredCalls.map((call) => {
                        const isSelected = call.id === selectedCallId;
                        return (
                            <div
                                key={call.id}
                                onClick={() => setSelectedCallId(call.id)}
                                className={cn(
                                    "px-5 py-4 cursor-pointer border-b border-gray-50 hover:bg-gray-50 transition-colors relative",
                                    isSelected && "bg-blue-50/50 hover:bg-blue-50/50 after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-violet-600"
                                )}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10 bg-gray-100 border border-gray-200 text-gray-500">
                                            <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <div className="font-bold text-gray-900 text-sm">
                                                {call.customer?.number || "Unknown Number"}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                                <span className={cn(
                                                    "capitalize",
                                                    call.status === 'ended' ? "text-gray-600" : "text-green-600 font-medium"
                                                )}>
                                                    {call.status === 'ended' ? (call.endedReason || 'Ended') : call.status}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-gray-400 font-medium mb-1">
                                            {call.startedAt ? format(new Date(call.startedAt), 'h:mm a') : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Column 3: Call Details */}
            <div className="flex-1 flex flex-col bg-gray-50 h-full overflow-hidden">
                {selectedCall ? (
                    <>
                        {/* Header */}
                        <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-10 w-10 bg-gray-100 border border-gray-200 text-gray-500">
                                    <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="font-bold text-gray-900">{selectedCall.customer?.number || "Unknown Number"}</h3>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-8 space-y-6">
                            <div className="text-center">
                                <span className="text-xs font-medium text-gray-400">
                                    {selectedCall.startedAt ? format(new Date(selectedCall.startedAt), 'MMM d, yyyy') : ''}
                                    <br />
                                    {selectedCall.startedAt ? format(new Date(selectedCall.startedAt), 'h:mm a') : ''}
                                </span>
                            </div>

                            <div className="flex items-start gap-4 mx-auto max-w-3xl">
                                <Avatar className="h-8 w-8 bg-gray-100 text-gray-400 mt-1">
                                    <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
                                </Avatar>

                                <div className="flex-1 space-y-4">
                                    {/* Status Card */}
                                    <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-600">
                                                <Phone className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="font-semibold text-gray-900 text-sm mb-1 capitalize">
                                                    {selectedCall.status}
                                                    {selectedCall.endedReason && <span className="text-gray-500 font-normal ml-1">({selectedCall.endedReason})</span>}
                                                </div>
                                                <div className="flex items-center gap-2 mb-3">
                                                    <div className="w-4 h-4 rounded-full bg-gray-200" /> {/* Agent Icon Placeholder */}
                                                    <span className="text-xs font-medium text-gray-600 bg-gray-200/50 px-2 py-0.5 rounded-full">
                                                        {getAgentName(selectedCall.assistantId)}
                                                    </span>
                                                </div>

                                                {/* Audio Player */}
                                                {selectedCall.recordingUrl && (
                                                    <div className="bg-white rounded-lg border border-blue-100 p-2 flex items-center gap-3 max-w-sm">
                                                        <audio
                                                            id="call-audio"
                                                            src={selectedCall.recordingUrl}
                                                            onEnded={(e) => {
                                                                const btn = document.getElementById('play-btn');
                                                                if (btn) btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-3 h-3 fill-current ml-0.5"><polygon points="6 3 20 12 6 21"></polygon></svg>';
                                                            }}
                                                        />
                                                        <button
                                                            id="play-btn"
                                                            className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors"
                                                            onClick={(e) => {
                                                                const audio = document.getElementById('call-audio') as HTMLAudioElement;
                                                                const btn = e.currentTarget;
                                                                if (audio.paused) {
                                                                    audio.play();
                                                                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pause w-3 h-3 fill-current"><rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" /></svg>';
                                                                } else {
                                                                    audio.pause();
                                                                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-3 h-3 fill-current ml-0.5"><polygon points="6 3 20 12 6 21"></polygon></svg>';
                                                                }
                                                            }}
                                                        >
                                                            <Play className="w-3 h-3 fill-current ml-0.5" />
                                                        </button>
                                                        <div className="flex-1 flex flex-col justify-center gap-1">
                                                            <div className="w-full bg-blue-50 rounded-full h-1 overflow-hidden">
                                                                <div className="bg-blue-500 h-full w-0 transition-all duration-100" id="progress-bar" />
                                                            </div>
                                                            <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                                                                <span id="current-time">0:00</span>
                                                                <span>
                                                                    {selectedCall?.endedAt && selectedCall?.startedAt
                                                                        ? (() => {
                                                                            const duration = Math.round((new Date(selectedCall.endedAt).getTime() - new Date(selectedCall.startedAt).getTime()) / 1000);
                                                                            const mins = Math.floor(duration / 60);
                                                                            const secs = duration % 60;
                                                                            return `${mins}:${secs.toString().padStart(2, '0')}`;
                                                                        })()
                                                                        : '0:00'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <script dangerouslySetInnerHTML={{
                                                            __html: `
                                                            const audio = document.getElementById('call-audio');
                                                            const progressBar = document.getElementById('progress-bar');
                                                            const currentTimeEl = document.getElementById('current-time');
                                                            if(audio) {
                                                                audio.ontimeupdate = () => {
                                                                    const percent = (audio.currentTime / audio.duration) * 100;
                                                                    progressBar.style.width = percent + '%';
                                                                    const mins = Math.floor(audio.currentTime / 60);
                                                                    const secs = Math.floor(audio.currentTime % 60);
                                                                    currentTimeEl.innerText = mins + ':' + secs.toString().padStart(2, '0');
                                                                };
                                                            }
                                                        `}} />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Summary Card */}
                                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <h4 className="font-bold text-xs text-gray-900 uppercase">Call Summary</h4>
                                            <Sparkles className="w-3 h-3 text-violet-500" />
                                        </div>
                                        <p className="text-sm text-gray-600 leading-relaxed">
                                            {selectedCall.analysis?.summary || "No summary available for this call."}
                                        </p>
                                    </div>

                                    {/* Transcript Bubbles */}
                                    {selectedCall.messages ? (
                                        <div className="space-y-4 pt-4">
                                            {selectedCall.messages
                                                .filter(msg => msg.role !== 'system') // Hide system prompt
                                                .map((msg, i) => (
                                                    <div key={i} className={cn(
                                                        "flex gap-3",
                                                        msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                                                    )}>
                                                        <div className={cn(
                                                            "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                                                            msg.role === 'user'
                                                                ? "bg-violet-600 text-white rounded-tr-none"
                                                                : "bg-white border border-gray-200 text-gray-700 rounded-tl-none shadow-sm"
                                                        )}>
                                                            {msg.message}
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-400 text-sm">
                                            No transcript available.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        Select a conversation to view details
                    </div>
                )}
            </div>
        </div>
    );
}
