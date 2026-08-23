"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useCallback } from "react";
import {
    Bot,
    Brain,
    ChevronDown,
    ChevronRight,
    MessageSquare,
    MoreVertical,
    Phone,
    Plus,
    Power,
    Rocket,
    Search,
    Sparkles,
    Trash2,
    Zap,
} from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateSequenceDialog } from "@/components/sequences/create-sequence-dialog";
import { TaskDialog } from "@/components/sequences/task-dialog";
import { TestNowDialog } from "@/components/sequences/flow/panels/test-now-dialog";
import { SequenceWizard } from "@/components/sequences/wizard";
import {
    deleteSequence,
    toggleSequenceActive,
    type ChannelReadiness,
} from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SequenceCardData {
    id: string;
    name: string;
    description: string | null;
    trigger_type: string;
    urgency_tier: string;
    is_active: boolean;
    generation_mode: string | null;
    created_at: string;
    updated_at: string | null;
    step_count: number;
    /** Enrollments still running, the same in-flight set the detail page counts. */
    active_count: number;
    paused_count: number;
    completed_count: number;
    replied_count: number;
    booked_count: number;
    failed_count: number;
    total_enrolled: number;
    channels: string[];
    ai_mutation_steps: number;
    is_task?: boolean;
}

interface SequencesListClientProps {
    clientId: string;
    sequences: SequenceCardData[];
    /** Deployed outbound agents (server-fetched), gates the wizard and empty state. */
    outboundAgents: { id: string; name: string; vapi_id: string | null }[];
    /** Server-derived channel capability, passed to the wizard and task dialog. */
    channelReadiness: ChannelReadiness;
    metaAdsConnected?: boolean;
    googleAdsConnected?: boolean;
    tenantProfile?: {
        industry: string;
        phone: string;
        email: string;
        business_name: string;
    };
}

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * A sequence row has three readable states, derived rather than stored: it is
 * running, it ran and was switched off, or it never ran at all. Colors match
 * the detail page's palette (see observability/enrollment-status) so a
 * sequence does not change meaning when you click into it.
 */
type SeqStatus = "live" | "paused" | "draft";

const STATUS_STYLE: Record<SeqStatus, { dot: string; text: string; label: string }> = {
    live: { dot: "bg-emerald-500", text: "text-emerald-700", label: "Live" },
    paused: { dot: "bg-amber-500", text: "text-amber-700", label: "Paused" },
    draft: { dot: "bg-gray-400", text: "text-gray-500", label: "Draft" },
};

function statusOf(s: SequenceCardData): SeqStatus {
    if (s.is_active) return "live";
    return s.total_enrolled > 0 ? "paused" : "draft";
}

const FILTERS = ["All", "Live", "Paused", "Draft"] as const;
type Filter = (typeof FILTERS)[number];

const SORTS = [
    { id: "activity", label: "Last activity" },
    { id: "name", label: "Name" },
    { id: "enrolled", label: "Enrolled" },
    { id: "reply", label: "Reply rate" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/**
 * The one place the table's column geometry is written. Header and rows read
 * the same string, so a column can never drift out of alignment with its label.
 */
const COLS =
    "grid grid-cols-[minmax(240px,2.4fr)_88px_72px_minmax(140px,1fr)_72px_72px_66px_88px_30px] items-center gap-3";

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return "";
    const mins = Math.floor((Date.now() - then) / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pct(part: number, whole: number): number {
    if (!whole) return 0;
    return Math.round((part / whole) * 100);
}

// ── Toolbar pieces ───────────────────────────────────────────────────────────

const headerBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50";

function ColLabel({ children, right }: { children?: React.ReactNode; right?: boolean }) {
    return (
        <span
            className={cn(
                "text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500",
                right && "text-right"
            )}
        >
            {children}
        </span>
    );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function SequenceRow({
    sequence,
    clientId,
    onDelete,
    onToggleActive,
    onTest,
}: {
    sequence: SequenceCardData;
    clientId: string;
    onDelete: (id: string) => void;
    onToggleActive: (id: string, active: boolean) => void;
    onTest: (id: string) => void;
}) {
    const status = STATUS_STYLE[statusOf(sequence)];
    const done = sequence.completed_count;
    const total = sequence.total_enrolled;
    const rate = pct(done, total);
    const hasVoice = sequence.channels.includes("voice");
    const hasSms = sequence.channels.includes("sms");
    const isAi = sequence.generation_mode === "dynamic";

    return (
        <div className="group relative border-b border-gray-100">
            <Link
                href={`/client/${clientId}/sequences/${sequence.id}`}
                className={cn(
                    COLS,
                    "px-5 py-3 transition-colors hover:bg-gray-50",
                    seqFocusRing
                )}
            >
                {/* Sequence */}
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium tracking-[-0.005em] text-gray-900">
                        {sequence.name}
                    </span>
                    <span className="truncate text-[11.5px] text-gray-500">
                        {sequence.description || "No description"}
                    </span>
                </div>

                {/* Status */}
                <span
                    className={cn(
                        "inline-flex items-center gap-1.5 text-[11px] font-semibold",
                        status.text
                    )}
                >
                    <span className={cn("h-[5px] w-[5px] rounded-full", status.dot)} />
                    {status.label}
                </span>

                {/* Channels */}
                <span className="flex items-center gap-[7px] text-gray-500">
                    {hasVoice && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Phone className="h-3.5 w-3.5" />
                            </TooltipTrigger>
                            <TooltipContent>Places voice calls</TooltipContent>
                        </Tooltip>
                    )}
                    {hasSms && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <MessageSquare className="h-3.5 w-3.5" />
                            </TooltipTrigger>
                            <TooltipContent>Sends SMS</TooltipContent>
                        </Tooltip>
                    )}
                    {isAi && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Brain className="h-3.5 w-3.5 text-emerald-600" />
                            </TooltipTrigger>
                            <TooltipContent>
                                AI-driven: the next touch is decided per lead
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {sequence.is_task && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Rocket className="h-3.5 w-3.5" />
                            </TooltipTrigger>
                            <TooltipContent>One-off task</TooltipContent>
                        </Tooltip>
                    )}
                </span>

                {/* Progress */}
                <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[10.5px] tabular-nums">
                        <span className="text-gray-500">
                            {total ? `${done} of ${total} done` : "not enrolled"}
                        </span>
                        <span className="font-medium text-gray-900">{rate}%</span>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-sm bg-gray-100">
                        <div
                            className={cn(
                                "h-full transition-[width] duration-500 ease-out",
                                statusOf(sequence) === "paused"
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                            )}
                            style={{ width: `${rate}%` }}
                        />
                    </div>
                </div>

                {/* Counts, zero is muted so a live number carries the eye. */}
                <span className="text-right text-[12.5px] tabular-nums text-gray-900">
                    {sequence.active_count}
                </span>
                <span
                    className={cn(
                        "text-right text-[12.5px] tabular-nums",
                        sequence.replied_count ? "text-blue-700" : "text-gray-300"
                    )}
                >
                    {sequence.replied_count}
                </span>
                <span
                    className={cn(
                        "text-right text-[12.5px] tabular-nums",
                        sequence.booked_count ? "text-violet-700" : "text-gray-300"
                    )}
                >
                    {sequence.booked_count}
                </span>

                {/* Updated */}
                <span className="text-right text-[11px] tabular-nums text-gray-500">
                    {relativeTime(sequence.updated_at || sequence.created_at)}
                </span>

                <span className="grid place-items-center text-gray-300 group-hover:opacity-0">
                    <ChevronRight className="h-[15px] w-[15px]" />
                </span>
            </Link>

            {/* Row actions, a sibling of the Link so a menu click never navigates.
                Sits over the chevron, which fades out on hover. */}
            <div className="absolute right-[18px] top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            aria-label={`Actions for ${sequence.name}`}
                            className={cn(
                                "grid h-6 w-6 place-items-center rounded text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900",
                                seqFocusRing
                            )}
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onTest(sequence.id)}>
                            <Zap className="mr-2 h-3.5 w-3.5" />
                            Test
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => onToggleActive(sequence.id, !sequence.is_active)}
                        >
                            <Power className="mr-2 h-3.5 w-3.5" />
                            {sequence.is_active ? "Deactivate" : "Activate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-red-600 focus:bg-red-50 focus:text-red-700"
                            onSelect={() => {
                                if (
                                    confirm(
                                        "Delete this sequence? Active enrollments will be stopped and all data removed. This cannot be undone."
                                    )
                                ) {
                                    onDelete(sequence.id);
                                }
                            }}
                        >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function SequencesListClient({
    clientId,
    sequences,
    outboundAgents,
    channelReadiness,
    metaAdsConnected,
    googleAdsConnected,
    tenantProfile,
}: SequencesListClientProps) {
    const router = useRouter();
    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    // Which sequence the Test dialog is open for. One dialog at the root, not
    // one per row.
    const [testSequenceId, setTestSequenceId] = useState<string | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [advancedCreateOpen, setAdvancedCreateOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("All");
    const [sort, setSort] = useState<SortId>("activity");

    const hasOutboundAgent = outboundAgents.length > 0;

    const totals = useMemo(() => {
        const sum = (fn: (s: SequenceCardData) => number) =>
            sequences.reduce((a, s) => a + fn(s), 0);
        const enrolled = sum((s) => s.total_enrolled);
        const replied = sum((s) => s.replied_count);
        return {
            sequences: sequences.length,
            live: sequences.filter((s) => s.is_active).length,
            enrolled,
            active: sum((s) => s.active_count),
            replied,
            booked: sum((s) => s.booked_count),
            completed: sum((s) => s.completed_count),
            replyRate: enrolled ? Math.round((replied / enrolled) * 1000) / 10 : 0,
        };
    }, [sequences]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = sequences.filter((s) => {
            if (filter !== "All" && statusOf(s) !== (filter.toLowerCase() as SeqStatus))
                return false;
            if (!q) return true;
            return (
                s.name.toLowerCase().includes(q) ||
                (s.description || "").toLowerCase().includes(q)
            );
        });
        const sorted = [...filtered];
        sorted.sort((a, b) => {
            switch (sort) {
                case "name":
                    return a.name.localeCompare(b.name);
                case "enrolled":
                    return b.total_enrolled - a.total_enrolled;
                case "reply":
                    return pct(b.replied_count, b.total_enrolled) -
                        pct(a.replied_count, a.total_enrolled);
                default:
                    return (
                        new Date(b.updated_at || b.created_at).getTime() -
                        new Date(a.updated_at || a.created_at).getTime()
                    );
            }
        });
        return sorted;
    }, [sequences, query, filter, sort]);

    const handleTaskLaunch = useCallback(
        (sequenceId: string) => {
            router.push(`/client/${clientId}/sequences/${sequenceId}`);
            router.refresh();
        },
        [clientId, router]
    );

    const handleTestMode = useCallback(
        (sequenceId: string) => {
            router.push(`/client/${clientId}/sequences/${sequenceId}`);
            router.refresh();
        },
        [clientId, router]
    );

    const handleDeleteSequence = useCallback(
        async (sequenceId: string) => {
            const result = await deleteSequence(sequenceId);
            if (result.success) router.refresh();
            else alert(result.error || "Failed to delete sequence");
        },
        [router]
    );

    const handleToggleActive = useCallback(
        async (sequenceId: string, active: boolean) => {
            const result = await toggleSequenceActive(sequenceId, active);
            if (result.success) router.refresh();
            else alert(result.error || "Failed to update sequence");
        },
        [router]
    );

    const kpis = [
        {
            label: "Sequences",
            value: totals.sequences,
            sub: `${totals.live} live`,
            dot: "bg-gray-400",
        },
        {
            label: "Enrolled",
            value: totals.enrolled,
            sub: "contacts",
            dot: "bg-blue-600",
        },
        {
            label: "In flight",
            value: totals.active,
            sub: "active now",
            dot: "bg-emerald-500",
        },
        {
            label: "Replied",
            value: totals.replied,
            sub: `${totals.replyRate}%`,
            dot: "bg-blue-600",
        },
        {
            label: "Booked",
            value: totals.booked,
            sub: "meetings",
            dot: "bg-violet-600",
        },
        {
            label: "Completed",
            value: totals.completed,
            sub: "all time",
            dot: "bg-gray-300",
        },
    ];

    return (
        <TooltipProvider delayDuration={200}>
            {/* min-w keeps the nine columns readable; the layout's <main> scrolls
                horizontally rather than crushing them. */}
            <div className="flex h-full min-h-0 min-w-[1040px] flex-col bg-white">
                {/* ---- Header ---- */}
                <header className="flex flex-none items-center gap-4 border-b border-gray-200 bg-white px-5 pb-3 pt-3.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                            Sequences
                        </h1>
                        <p className="text-[11.5px] text-gray-500">
                            Automated multi-step outreach: voice and SMS, run by your agents.
                        </p>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className={cn(headerBtn, "text-gray-600", seqFocusRing)}>
                                    Advanced
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setAdvancedCreateOpen(true)}>
                                    Create manually (static)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <button
                            onClick={() => setTaskDialogOpen(true)}
                            className={cn(headerBtn, seqFocusRing)}
                        >
                            <Rocket className="h-3.5 w-3.5 text-gray-500" />
                            New task
                        </button>
                        <button
                            onClick={() => setWizardOpen(true)}
                            className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700",
                                seqFocusRing
                            )}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New sequence
                        </button>
                    </div>
                </header>

                {/* ---- KPI strip ---- */}
                <div className="grid flex-none grid-cols-6 border-b border-gray-200 bg-white">
                    {kpis.map((k) => (
                        <div
                            key={k.label}
                            className="flex flex-col gap-1.5 border-r border-gray-100 px-4 py-3 last:border-r-0"
                        >
                            <div className="flex items-center gap-1.5">
                                <span className={cn("h-[5px] w-[5px] rounded-full", k.dot)} />
                                <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500">
                                    {k.label}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span
                                    className={cn(
                                        "text-[21px] font-medium tabular-nums tracking-[-0.02em]",
                                        k.value === 0 ? "text-gray-400" : "text-gray-900"
                                    )}
                                >
                                    {k.value.toLocaleString()}
                                </span>
                                <span className="text-[10.5px] tabular-nums text-gray-500">
                                    {k.sub}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ---- Toolbar ---- */}
                <div className="flex flex-none items-center gap-3 border-b border-gray-200 bg-white px-5 py-2.5">
                    <div className="relative flex w-[280px] items-center">
                        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search sequences"
                            aria-label="Search sequences"
                            className="h-[30px] w-full rounded-md border border-gray-200 bg-white pl-[29px] pr-2.5 text-[12.5px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-emerald-600 focus:ring-[3px] focus:ring-emerald-600/10"
                        />
                    </div>

                    <div
                        className="flex gap-0.5 rounded-md bg-gray-100 p-0.5"
                        role="group"
                        aria-label="Filter sequences by status"
                    >
                        {FILTERS.map((f) => {
                            const on = filter === f;
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setFilter(f)}
                                    className={cn(
                                        "h-6 rounded px-2.5 text-[11px] font-medium transition-colors",
                                        seqFocusRing,
                                        on
                                            ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                                            : "text-gray-600 hover:text-gray-900"
                                    )}
                                >
                                    {f}
                                </button>
                            );
                        })}
                    </div>

                    <span className="text-[11px] tabular-nums text-gray-500">
                        {rows.length === sequences.length
                            ? `${sequences.length} sequence${sequences.length === 1 ? "" : "s"}`
                            : `${rows.length} of ${sequences.length}`}
                    </span>

                    <div className="ml-auto flex items-center gap-2">
                        <label
                            htmlFor="seq-sort"
                            className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500"
                        >
                            Sort
                        </label>
                        <select
                            id="seq-sort"
                            value={sort}
                            onChange={(e) => setSort(e.target.value as SortId)}
                            className="h-[30px] rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
                        >
                            {SORTS.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* ---- Table ---- */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {sequences.length > 0 && (
                        <div
                            className={cn(
                                COLS,
                                "sticky top-0 z-[1] border-b border-gray-200 bg-gray-50 px-5 py-2"
                            )}
                        >
                            <ColLabel>Sequence</ColLabel>
                            <ColLabel>Status</ColLabel>
                            <ColLabel>Channels</ColLabel>
                            <ColLabel>Progress</ColLabel>
                            <ColLabel right>Active</ColLabel>
                            <ColLabel right>Replied</ColLabel>
                            <ColLabel right>Booked</ColLabel>
                            <ColLabel right>Updated</ColLabel>
                            <ColLabel />
                        </div>
                    )}

                    {sequences.length === 0 ? (
                        <div className="flex flex-col items-center px-6 py-20 text-center">
                            <div className="grid h-12 w-12 place-items-center rounded-full border border-gray-200 bg-gray-50">
                                {hasOutboundAgent ? (
                                    <Sparkles className="h-5 w-5 text-gray-500" />
                                ) : (
                                    <Bot className="h-5 w-5 text-gray-500" />
                                )}
                            </div>
                            {hasOutboundAgent ? (
                                <>
                                    <h3 className="mt-4 text-base font-semibold text-gray-900">
                                        Create your first AI sequence
                                    </h3>
                                    <p className="mt-1 max-w-md text-sm text-gray-500">
                                        You set the goal, touchpoints, and contact windows, and the AI
                                        decides the channel, content, and timing of every touch.
                                    </p>
                                    <button
                                        onClick={() => setWizardOpen(true)}
                                        className={cn(
                                            "mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700",
                                            seqFocusRing
                                        )}
                                    >
                                        <Sparkles className="h-4 w-4" />
                                        Create AI sequence
                                    </button>
                                </>
                            ) : (
                                <>
                                    <h3 className="mt-4 text-base font-semibold text-gray-900">
                                        Set up your AI agent first
                                    </h3>
                                    <p className="mt-1 max-w-md text-sm text-gray-500">
                                        Sequences are run by your AI agent, which texts and calls
                                        leads for you. Deploy an agent to get started.
                                    </p>
                                    <Link
                                        href={`/client/${clientId}/agents/new`}
                                        className={cn(
                                            "mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700",
                                            seqFocusRing
                                        )}
                                    >
                                        <Bot className="h-4 w-4" />
                                        Set up your agent
                                    </Link>
                                </>
                            )}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="flex flex-col items-center gap-1.5 px-5 py-16">
                            <p className="text-[13px] font-medium text-gray-900">
                                No sequences match this filter.
                            </p>
                            <p className="text-xs text-gray-500">
                                Clear the search or switch to All.
                            </p>
                        </div>
                    ) : (
                        rows.map((sequence) => (
                            <SequenceRow
                                key={sequence.id}
                                sequence={sequence}
                                clientId={clientId}
                                onDelete={handleDeleteSequence}
                                onToggleActive={handleToggleActive}
                                onTest={setTestSequenceId}
                            />
                        ))
                    )}
                </div>

                {/* ---- Dialogs ---- */}
                <CreateSequenceDialog
                    clientId={clientId}
                    open={advancedCreateOpen}
                    onOpenChange={setAdvancedCreateOpen}
                    hideTrigger
                />
                <TaskDialog
                    open={taskDialogOpen}
                    onOpenChange={setTaskDialogOpen}
                    clientId={clientId}
                    channelReadiness={channelReadiness}
                    onLaunch={handleTaskLaunch}
                    onTestMode={handleTestMode}
                />
                {/* enrollments={[]} is intentional: the dialog's mode initializer
                    already falls back to manual entry and hides the switcher when
                    there's nothing to pick from, so the list page gets "test on my
                    own phone" with no extra fetch. The enrollment picker stays on
                    the detail page, which already loads those rows. */}
                {testSequenceId && (
                    <TestNowDialog
                        open
                        onOpenChange={(o) => {
                            if (!o) setTestSequenceId(null);
                        }}
                        sequenceId={testSequenceId}
                        clientId={clientId}
                        enrollments={[]}
                    />
                )}
                {wizardOpen && (
                    <SequenceWizard
                        clientId={clientId}
                        outboundAgents={outboundAgents}
                        channelReadiness={channelReadiness}
                        metaAdsConnected={metaAdsConnected ?? false}
                        googleAdsConnected={googleAdsConnected ?? false}
                        tenantProfile={
                            tenantProfile ?? {
                                industry: "general",
                                phone: "",
                                email: "",
                                business_name: "",
                            }
                        }
                        onClose={() => setWizardOpen(false)}
                    />
                )}
            </div>
        </TooltipProvider>
    );
}
