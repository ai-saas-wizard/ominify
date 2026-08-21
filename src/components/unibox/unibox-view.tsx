"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Headphones, Inbox, Mail, MessageSquare, Phone, Radio, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
    STATUS_META,
    type UniboxAgentOption,
    type UniboxChannel,
    type UniboxStatus,
    type UniboxThread,
} from "@/lib/unibox/types";
import { mergeLiveCalls, type ActiveCallRow } from "@/lib/unibox/live";
import { channelLine, formatPhone, initialsFor, threadDisplayName } from "@/lib/unibox/parse";
import { shortAgo } from "@/lib/unibox/format";
import { PulsingDot } from "./pulsing-dot";
import { ThreadDetail } from "./thread-detail";

type StatusFilter = "all" | "needs_reply" | UniboxStatus;
type ChannelFilter = "all" | UniboxChannel;
type SortKey = "activity" | "response" | "needs_reply" | "oldest";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
    { key: "all", label: "All threads" },
    { key: "needs_reply", label: "Needs reply" },
    { key: "responded", label: "Responded" },
    { key: "booked", label: "Booked" },
    { key: "awaiting_reply", label: "Awaiting reply" },
    { key: "no_answer", label: "No answer" },
    { key: "opted_out", label: "Opted out" },
];

const CHANNEL_FILTERS: Array<{ key: ChannelFilter; label: string; icon: React.ReactNode }> = [
    { key: "all", label: "All channels", icon: <Headphones className="w-3.5 h-3.5" /> },
    { key: "voice", label: "Voice", icon: <Phone className="w-3.5 h-3.5" /> },
    { key: "sms", label: "SMS", icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { key: "email", label: "Email", icon: <Mail className="w-3.5 h-3.5" /> },
];

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: "activity", label: "Latest activity" },
    { key: "response", label: "Latest response" },
    { key: "needs_reply", label: "Needs reply first" },
    { key: "oldest", label: "Oldest first" },
];

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

function matchesStatus(t: UniboxThread, f: StatusFilter): boolean {
    if (f === "all") return true;
    if (f === "needs_reply") return t.needsReply;
    return t.status === f;
}

function matchesChannel(t: UniboxThread, f: ChannelFilter): boolean {
    return f === "all" || (t.channelCounts[f] ?? 0) > 0;
}

function matchesAgent(t: UniboxThread, vapiId: string | null): boolean {
    return !vapiId || t.agentVapiId === vapiId;
}

function sortThreads(list: UniboxThread[], sort: SortKey): UniboxThread[] {
    return [...list].sort((a, b) => {
        if (a.hasLiveCall !== b.hasLiveCall) return a.hasLiveCall ? -1 : 1;
        switch (sort) {
            case "response":
                return ms(b.lastResponseAt) - ms(a.lastResponseAt) || ms(b.lastActivityAt) - ms(a.lastActivityAt);
            case "needs_reply":
                return Number(b.needsReply) - Number(a.needsReply) || ms(b.lastActivityAt) - ms(a.lastActivityAt);
            case "oldest":
                return ms(a.lastActivityAt) - ms(b.lastActivityAt);
            default:
                return ms(b.lastActivityAt) - ms(a.lastActivityAt);
        }
    });
}

interface UniboxViewProps {
    threads: UniboxThread[];
    agents: UniboxAgentOption[];
    activeCalls: ActiveCallRow[];
    clientId: string;
    initialAgentVapiId: string | null;
}

export function UniboxView({ threads: serverThreads, agents, activeCalls, clientId, initialAgentVapiId }: UniboxViewProps) {
    const [status, setStatus] = useState<StatusFilter>("all");
    const [channel, setChannel] = useState<ChannelFilter>("all");
    const [agentVapiId, setAgentVapiId] = useState<string | null>(initialAgentVapiId);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortKey>("activity");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, []);

    const threads = useMemo(
        () => mergeLiveCalls(serverThreads, activeCalls, agents),
        [serverThreads, activeCalls, agents]
    );

    const searchIndex = useMemo(() => {
        const index = new Map<string, string>();
        for (const t of threads) {
            index.set(
                t.id,
                [
                    t.name,
                    t.phone,
                    t.email,
                    t.location,
                    t.company,
                    t.agentName,
                    t.preview,
                    ...t.events.map((e) => e.body ?? e.subject ?? e.summary ?? ""),
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
            );
        }
        return index;
    }, [threads]);

    const q = query.trim().toLowerCase();

    const { visible, statusCounts, channelCounts, agentCounts } = useMemo(() => {
        const matchesQuery = (t: UniboxThread) => !q || (searchIndex.get(t.id) ?? "").includes(q);

        // Each rail group is counted against the *other* active filters, so the
        // number next to an option is what clicking it would actually show.
        const statusCounts = new Map<StatusFilter, number>();
        const channelCounts = new Map<ChannelFilter, number>();
        const agentCounts = new Map<string, number>();
        for (const t of threads) {
            if (!matchesQuery(t)) continue;
            const okStatus = matchesStatus(t, status);
            const okChannel = matchesChannel(t, channel);
            const okAgent = matchesAgent(t, agentVapiId);
            if (okChannel && okAgent) {
                for (const f of STATUS_FILTERS) if (matchesStatus(t, f.key)) statusCounts.set(f.key, (statusCounts.get(f.key) ?? 0) + 1);
            }
            if (okStatus && okAgent) {
                for (const f of CHANNEL_FILTERS) if (matchesChannel(t, f.key)) channelCounts.set(f.key, (channelCounts.get(f.key) ?? 0) + 1);
            }
            if (okStatus && okChannel) {
                agentCounts.set("all", (agentCounts.get("all") ?? 0) + 1);
                if (t.agentVapiId) agentCounts.set(t.agentVapiId, (agentCounts.get(t.agentVapiId) ?? 0) + 1);
            }
        }

        const visible = sortThreads(
            threads.filter(
                (t) => matchesQuery(t) && matchesStatus(t, status) && matchesChannel(t, channel) && matchesAgent(t, agentVapiId)
            ),
            sort
        );
        return { visible, statusCounts, channelCounts, agentCounts };
    }, [threads, searchIndex, q, status, channel, agentVapiId, sort]);

    // Fall back to the first visible thread when the selection is filtered out.
    const selected = visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;

    const liveCount = threads.filter((t) => t.hasLiveCall).length;
    const needsReplyCount = threads.filter((t) => t.needsReply).length;
    const recent = threads.filter((t) => ms(t.lastActivityAt) > now - 7 * 86_400_000);
    const responseRate = recent.length
        ? Math.round((100 * recent.filter((t) => t.lastResponseAt).length) / recent.length)
        : null;

    return (
        <div className="flex h-full bg-[#fafafa]">
            {/* Column 1: filter rail */}
            <aside className="w-[250px] shrink-0 border-r border-gray-200/80 flex flex-col bg-white">
                <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                            <Inbox className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[15px] font-bold text-gray-900 leading-tight tracking-wide">UNIBOX</h1>
                            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Voice · SMS · Email</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
                    <RailGroup label="Status">
                        {STATUS_FILTERS.map((f) => (
                            <RailItem
                                key={f.key}
                                label={f.label}
                                count={statusCounts.get(f.key) ?? 0}
                                selected={status === f.key}
                                onClick={() => setStatus(f.key)}
                                icon={
                                    <span
                                        className={cn(
                                            "block w-1.5 h-1.5 rounded-full",
                                            f.key === "all"
                                                ? "bg-gray-300"
                                                : f.key === "needs_reply"
                                                  ? "bg-emerald-500"
                                                  : STATUS_META[f.key].dot
                                        )}
                                    />
                                }
                            />
                        ))}
                    </RailGroup>

                    <RailGroup label="Channel">
                        {CHANNEL_FILTERS.map((f) => (
                            <RailItem
                                key={f.key}
                                label={f.label}
                                count={channelCounts.get(f.key) ?? 0}
                                selected={channel === f.key}
                                onClick={() => setChannel(f.key)}
                                icon={f.icon}
                            />
                        ))}
                    </RailGroup>

                    <RailGroup label="Agent">
                        <RailItem
                            label="All agents"
                            count={agentCounts.get("all") ?? 0}
                            selected={agentVapiId === null}
                            onClick={() => setAgentVapiId(null)}
                            icon={<Headphones className="w-3.5 h-3.5" />}
                        />
                        {agents.map((a) => (
                            <RailItem
                                key={a.id}
                                label={a.name}
                                count={agentCounts.get(a.vapiId) ?? 0}
                                selected={agentVapiId === a.vapiId}
                                onClick={() => setAgentVapiId(a.vapiId)}
                                icon={<Phone className="w-3.5 h-3.5" />}
                            />
                        ))}
                    </RailGroup>
                </div>

                <div className="px-4 py-3 border-t border-gray-100">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Response rate · 7 days</div>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-gray-900 tabular-nums" suppressHydrationWarning>
                            {responseRate === null ? "—" : `${responseRate}%`}
                        </span>
                        <span className="text-[11px] text-gray-400" suppressHydrationWarning>
                            {recent.length} lead{recent.length === 1 ? "" : "s"} touched
                        </span>
                    </div>
                </div>
            </aside>

            {/* Column 2: thread list */}
            <section className="w-[360px] shrink-0 border-r border-gray-200/80 flex flex-col bg-white h-full">
                <div className="px-4 pt-4 pb-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-gray-900">Threads</h2>
                            <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                                {visible.length}
                            </span>
                        </div>
                        {liveCount > 0 && (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1.5">
                                <PulsingDot />
                                {liveCount} live
                            </Badge>
                        )}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                        <input
                            type="text"
                            placeholder="Search leads, numbers, messages…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 placeholder:text-gray-300 transition-all"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-400 truncate">
                            {needsReplyCount > 0
                                ? `${needsReplyCount} lead${needsReplyCount === 1 ? "" : "s"} waiting on a reply`
                                : "No one is waiting on a reply"}
                        </span>
                        <label className="relative shrink-0">
                            <select
                                value={sort}
                                onChange={(e) => setSort(e.target.value as SortKey)}
                                className="appearance-none text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-lg pl-2.5 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 cursor-pointer"
                                aria-label="Sort threads"
                            >
                                {SORT_OPTIONS.map((o) => (
                                    <option key={o.key} value={o.key}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        </label>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                            <Inbox className="w-10 h-10 mb-3" />
                            <p className="text-sm font-medium">No threads match this filter</p>
                        </div>
                    ) : (
                        visible.map((t, index) => (
                            <ThreadRow
                                key={t.id}
                                thread={t}
                                index={index}
                                now={now}
                                selected={selected?.id === t.id}
                                onSelect={() => setSelectedId(t.id)}
                            />
                        ))
                    )}
                </div>
            </section>

            {/* Column 3: thread detail */}
            <ThreadDetail thread={selected} clientId={clientId} now={now} />
        </div>
    );
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
            <div className="space-y-0.5">{children}</div>
        </div>
    );
}

function RailItem({
    label,
    count,
    selected,
    onClick,
    icon,
}: {
    label: string;
    count: number;
    selected: boolean;
    onClick: () => void;
    icon?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors duration-150",
                selected ? "bg-emerald-50 text-emerald-900 font-semibold" : "text-gray-600 hover:bg-gray-50"
            )}
        >
            {icon && (
                <span className={cn("w-3.5 flex items-center justify-center shrink-0", selected ? "text-emerald-600" : "text-gray-400")}>
                    {icon}
                </span>
            )}
            <span className="flex-1 truncate text-left">{label}</span>
            <span
                className={cn(
                    "text-[11px] tabular-nums px-1.5 py-0.5 rounded-full font-medium",
                    selected ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
                )}
            >
                {count}
            </span>
        </button>
    );
}

function ThreadRow({
    thread,
    index,
    now,
    selected,
    onSelect,
}: {
    thread: UniboxThread;
    index: number;
    now: number;
    selected: boolean;
    onSelect: () => void;
}) {
    const meta = STATUS_META[thread.status];
    const sub = [thread.name ? formatPhone(thread.phone) : null, thread.location].filter(Boolean).join(" · ");

    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: index < 10 ? index * 0.03 : 0 }}
            onClick={onSelect}
            className={cn(
                "relative w-full text-left px-4 py-3.5 border-b border-gray-50 transition-colors duration-200",
                selected ? "bg-emerald-50/60" : "hover:bg-gray-50/80",
                thread.hasLiveCall && !selected && "bg-emerald-50/30"
            )}
        >
            <span
                className={cn(
                    "absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-emerald-500 transition-opacity duration-200",
                    selected ? "opacity-100" : "opacity-0"
                )}
            />
            <div className="flex items-start gap-3">
                <div
                    className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[12px] font-semibold",
                        thread.hasLiveCall
                            ? "bg-emerald-100 text-emerald-600"
                            : selected || thread.needsReply
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-100 text-gray-500"
                    )}
                >
                    {thread.hasLiveCall ? <Radio className="w-4 h-4 animate-pulse" /> : initialsFor(thread.name)}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span
                            className={cn(
                                "text-[13px] truncate",
                                thread.needsReply ? "font-bold" : "font-semibold",
                                selected ? "text-emerald-900" : "text-gray-900"
                            )}
                        >
                            {threadDisplayName(thread)}
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                            <span
                                className={cn("text-[11px]", thread.hasLiveCall ? "text-emerald-600 font-medium" : "text-gray-400")}
                                suppressHydrationWarning
                            >
                                {thread.hasLiveCall ? "Live" : shortAgo(thread.lastActivityAt, now)}
                            </span>
                            {thread.needsReply && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                        </span>
                    </div>
                    {sub && <div className="text-[11px] text-gray-400 truncate mt-0.5">{sub}</div>}
                    <p className="text-[12px] text-gray-600 mt-1 line-clamp-2 leading-snug">{thread.preview}</p>
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                        <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide", meta.text)}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                            {meta.label}
                        </span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide truncate">{channelLine(thread)}</span>
                    </div>
                </div>
            </div>
        </motion.button>
    );
}
