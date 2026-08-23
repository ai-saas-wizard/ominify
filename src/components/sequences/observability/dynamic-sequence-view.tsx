"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Brain,
    Loader2,
    Pause,
    Play,
    Trash2,
    UserMinus,
    Zap,
} from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { TestNowDialog } from "@/components/sequences/flow/panels/test-now-dialog";
import { LeadJourneyTimeline } from "./lead-journey-timeline";
import { EnrolledLeadsPanel, leadName } from "./enrolled-leads-panel";
import { SequenceConfigRail } from "./sequence-config-rail";
import { ENROLLMENT_STATUS, STATUS_LABELS, isInFlight } from "./enrollment-status";
import { callingScheduleSummary } from "@/components/sequences/calling-schedule-card";
import {
    toggleSequenceActive,
    deleteSequence,
    unenrollContact,
    resumeSequenceEnrollments,
} from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";

const CHANNEL_TAB_LABELS: Record<string, string> = {
    voice: "Voice",
    sms: "SMS",
    email: "Email",
};

/** Header chip button — the three actions share one shape. */
const headerBtn =
    "inline-flex h-[30px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50";

interface DynamicSequenceViewProps {
    clientId: string;
    sequenceId: string;
    sequence: any;
    enrollments: any[];
    isActive: boolean;
}

/**
 * Observability + operations view for AI-driven (generation_mode='dynamic')
 * sequences, laid out as three fixed columns: who is enrolled, what happened to
 * the selected lead, and how the campaign is configured. There is no step
 * authoring here by design — steps are generated per lead at runtime, so any
 * shared step graph would be fiction.
 */
export function DynamicSequenceView({
    clientId,
    sequenceId,
    sequence,
    enrollments,
    isActive,
}: DynamicSequenceViewProps) {
    const router = useRouter();
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [testOpen, setTestOpen] = useState(false);
    const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(
        enrollments[0]?.id ?? null
    );
    const [unenrolling, setUnenrolling] = useState(false);
    const [resuming, setResuming] = useState(false);
    const [resumeMsg, setResumeMsg] = useState<string | null>(null);
    const [journeyFilter, setJourneyFilter] = useState("All");

    async function handleToggleActive() {
        setToggling(true);
        try {
            await toggleSequenceActive(sequenceId, !isActive);
            router.refresh();
        } catch (err) {
            console.error("Toggle error:", err);
        } finally {
            setToggling(false);
        }
    }

    async function handleDelete() {
        if (!confirm("Are you sure you want to delete this sequence? This cannot be undone."))
            return;
        setDeleting(true);
        try {
            await deleteSequence(sequenceId);
            router.push(`/client/${clientId}/sequences`);
        } catch (err) {
            console.error("Delete error:", err);
            setDeleting(false);
        }
    }

    async function handleResume() {
        setResuming(true);
        setResumeMsg(null);
        const res = await resumeSequenceEnrollments(sequenceId);
        setResuming(false);
        if (res?.success) {
            const n = res.data?.resumed ?? 0;
            // Leads with no step left to run stay paused rather than being
            // revived into a silent "completed" — say so instead of implying
            // everything came back.
            const stranded = res.data?.stranded ?? 0;
            setResumeMsg(
                `Resumed ${n} lead${n === 1 ? "" : "s"}` +
                    (stranded
                        ? ` · ${stranded} left paused (no next step — they have finished their touches)`
                        : "")
            );
            router.refresh();
        } else {
            setResumeMsg(res?.error || "Could not resume");
        }
    }

    async function handleUnenroll(enrollmentId: string) {
        if (!confirm("Are you sure you want to unenroll this contact?")) return;
        setUnenrolling(true);
        const res = await unenrollContact(enrollmentId);
        setUnenrolling(false);
        if (res.success) {
            router.refresh();
        } else {
            alert(res.error || "Failed to unenroll contact");
        }
    }

    // Computed from the enrollments prop (not the page's enrollment_stats):
    // dynamic enrollments spend most of their life in awaiting_outcome /
    // generating_next_step, which must count as active or a live sequence
    // shows "Active: 0".
    const stats = useMemo(() => {
        const by = (fn: (e: any) => boolean) => enrollments.filter(fn).length;
        return {
            total: enrollments.length,
            active: by((e) => isInFlight(e.status)),
            paused: by((e) => e.status === "paused"),
            completed: by((e) => e.status === "completed"),
            replied: by((e) => e.status === "replied"),
            booked: by((e) => e.status === "booked"),
            failed: by((e) => e.status === "failed"),
        };
    }, [enrollments]);

    /** "45" over "50" → "90%"; blank when there is nothing to divide by. */
    function share(n: number): string {
        if (!stats.total || n === 0) return "—";
        return `${Math.round((n / stats.total) * 100)}%`;
    }

    const kpis = [
        { label: "Enrolled", value: stats.total, sub: "leads", dot: "bg-gray-300" },
        { label: "Active", value: stats.active, sub: share(stats.active), dot: "bg-sky-500" },
        { label: "Replied", value: stats.replied, sub: share(stats.replied), dot: "bg-gray-900" },
        { label: "Booked", value: stats.booked, sub: share(stats.booked), dot: "bg-emerald-500" },
        {
            label: "Completed",
            value: stats.completed,
            sub: share(stats.completed),
            dot: "bg-gray-300",
        },
        { label: "Failed", value: stats.failed, sub: share(stats.failed), dot: "bg-red-500" },
    ];

    const strategy = sequence.sequence_strategy || {};
    const channels: string[] = strategy.available_channels || [];
    const maxTouches = Math.max(Number(strategy.max_steps) || 4, 1);

    // "50/day · 09:00–16:00 · Weekdays" split back into its own segments so the
    // numeric ones can carry tabular figures.
    const scheduleParts = (callingScheduleSummary(sequence) || "").split(" · ").filter(Boolean);
    const channelSummary = channels
        .map((c) => CHANNEL_TAB_LABELS[c])
        .filter(Boolean)
        .join(" + ");

    const headerMeta: Array<{ text: string; mono?: boolean }> = [
        ...scheduleParts.map((p) => ({ text: p, mono: /\d/.test(p) })),
        ...(channelSummary ? [{ text: channelSummary }] : []),
        ...(strategy.max_steps != null
            ? [{ text: `up to ${strategy.max_steps} touchpoints` }]
            : []),
    ];

    const journeyTabs = ["All", ...channels.map((c) => CHANNEL_TAB_LABELS[c]).filter(Boolean), "AI"];

    const selected = enrollments.find((e) => e.id === selectedEnrollmentId);
    const selectedStatus = selected
        ? ENROLLMENT_STATUS[selected.status] || ENROLLMENT_STATUS.active
        : null;
    const canUnenroll =
        selected && (isInFlight(selected.status) || selected.status === "paused");

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex h-full w-full flex-col bg-gray-50">
                {/* ---- Header ---- */}
                <header className="flex flex-none items-start gap-3.5 border-b border-gray-200 bg-white py-3 pl-4 pr-5">
                    <Link
                        href={`/client/${clientId}/sequences`}
                        aria-label="Back to sequences"
                        className={cn(
                            "mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900",
                            seqFocusRing
                        )}
                    >
                        <ArrowLeft className="h-[15px] w-[15px]" />
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <h1 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                                {sequence.name}
                            </h1>
                            <span
                                className={cn(
                                    "inline-flex h-[21px] flex-none items-center gap-1.5 rounded px-2 text-[11px] font-semibold",
                                    isActive
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-gray-100 text-gray-500"
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-[5px] w-[5px] rounded-full",
                                        isActive ? "bg-emerald-500" : "bg-gray-400"
                                    )}
                                />
                                {isActive ? "Active" : "Inactive"}
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-gray-500">
                            <span className="inline-flex items-center gap-1.5">
                                <Brain className="h-3.5 w-3.5 text-emerald-600" />
                                AI-driven
                            </span>
                            {headerMeta.map((m) => (
                                <span key={m.text} className="flex items-center gap-2.5">
                                    <span className="text-gray-300">·</span>
                                    <span className={cn(m.mono && "font-mono tabular-nums")}>
                                        {m.text}
                                    </span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="mt-0.5 flex flex-none items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => setTestOpen(true)}
                                    className={cn(headerBtn, seqFocusRing)}
                                >
                                    <Zap className="h-3.5 w-3.5 text-emerald-600" />
                                    Test now
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Fire a test to a phone number — bypasses pacing &amp; quiet-hours
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link
                                    href={`/client/${clientId}/sequences/${sequenceId}/learning`}
                                    className={cn(headerBtn, seqFocusRing)}
                                >
                                    <Brain className="h-3.5 w-3.5 text-gray-500" />
                                    Learning
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                                Learning dashboard — what is working across this sequence
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={handleToggleActive}
                                    disabled={toggling}
                                    className={cn(headerBtn, "text-gray-600", seqFocusRing)}
                                >
                                    {toggling ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : isActive ? (
                                        <Pause className="h-3.5 w-3.5" />
                                    ) : (
                                        <Play className="h-3.5 w-3.5" />
                                    )}
                                    {isActive ? "Pause" : "Activate"}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {isActive
                                    ? "Stop dispatching — in-flight leads are parked as paused"
                                    : "Resume dispatching on the sequence schedule"}
                            </TooltipContent>
                        </Tooltip>

                        <div className="h-5 w-px bg-gray-200" />

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    aria-label="Delete sequence"
                                    className={cn(
                                        "grid h-[30px] w-[30px] place-items-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50",
                                        seqFocusRing
                                    )}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Delete sequence</TooltipContent>
                        </Tooltip>
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
                                        "font-mono text-[21px] font-medium tabular-nums tracking-[-0.02em]",
                                        k.value === 0 ? "text-gray-400" : "text-gray-900"
                                    )}
                                >
                                    {k.value}
                                </span>
                                <span className="font-mono text-[10.5px] tabular-nums text-gray-400">
                                    {k.sub}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Deactivating parks in-flight leads at status=paused and re-activating
                    deliberately does not undo it, so paused leads need an explicit way
                    back into rotation. */}
                {stats.paused > 0 && (
                    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-100 bg-amber-50/70 px-4 py-2 text-[11.5px] text-amber-900">
                        <span className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            <span className="font-mono tabular-nums">{stats.paused}</span> lead
                            {stats.paused === 1 ? "" : "s"} paused — outreach is stopped for them.
                        </span>
                        <button
                            type="button"
                            onClick={handleResume}
                            disabled={resuming}
                            className={cn(
                                "rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50",
                                seqFocusRing
                            )}
                        >
                            {resuming ? "Resuming…" : "Put them back in rotation"}
                        </button>
                        {resumeMsg && <span className="text-amber-800">{resumeMsg}</span>}
                    </div>
                )}

                {/* ---- Leads | Journey | Config ----
                    grid-rows-[minmax(0,1fr)] pins the single row to the container's
                    height instead of letting it size to the tallest column. Without
                    it the lead list grows to its full content height and the whole
                    page scrolls, rather than each column scrolling on its own. */}
                <div className="grid min-h-0 flex-1 grid-cols-[288px_minmax(0,1fr)_372px] grid-rows-[minmax(0,1fr)] overflow-hidden">
                    <EnrolledLeadsPanel
                        enrollments={enrollments}
                        maxTouches={maxTouches}
                        selectedId={selectedEnrollmentId}
                        onSelect={setSelectedEnrollmentId}
                    />

                    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-gray-50">
                        {selected ? (
                            <>
                                <div className="flex flex-none items-end gap-4 border-b border-gray-200 bg-white px-4.5 py-3">
                                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        <div className="flex items-center gap-2.5">
                                            <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-gray-900">
                                                {leadName(selected)}
                                            </span>
                                            {selectedStatus && (
                                                <span
                                                    className={cn(
                                                        "inline-flex flex-none items-center gap-1 text-[10.5px] font-semibold",
                                                        selectedStatus.text
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "h-[5px] w-[5px] rounded-full",
                                                            selectedStatus.dot
                                                        )}
                                                    />
                                                    {STATUS_LABELS[selected.status] || selected.status}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gray-500">
                                            {selected.contacts?.phone && (
                                                <span className="font-mono tabular-nums">
                                                    {selected.contacts.phone}
                                                </span>
                                            )}
                                            {selected.contacts?.email && (
                                                <>
                                                    <span className="text-gray-300">·</span>
                                                    <span className="truncate">
                                                        {selected.contacts.email}
                                                    </span>
                                                </>
                                            )}
                                            {selected.next_step_at && (
                                                <>
                                                    <span className="text-gray-300">·</span>
                                                    <span>
                                                        Next:{" "}
                                                        <span className="font-medium text-gray-900">
                                                            {new Date(
                                                                selected.next_step_at
                                                            ).toLocaleString()}
                                                        </span>
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-none items-center gap-1.5">
                                        <div
                                            className="flex gap-0.5 rounded-md bg-gray-100 p-0.5"
                                            role="group"
                                            aria-label="Filter journey by channel"
                                        >
                                            {journeyTabs.map((t) => {
                                                const on = journeyFilter === t;
                                                return (
                                                    <button
                                                        key={t}
                                                        type="button"
                                                        aria-pressed={on}
                                                        onClick={() => setJourneyFilter(t)}
                                                        className={cn(
                                                            "h-6 rounded px-2.5 text-[11px] font-medium transition-colors",
                                                            seqFocusRing,
                                                            on
                                                                ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                                                                : "text-gray-500 hover:text-gray-700"
                                                        )}
                                                    >
                                                        {t}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {canUnenroll && (
                                            <button
                                                type="button"
                                                onClick={() => handleUnenroll(selected.id)}
                                                disabled={unenrolling}
                                                className={cn(
                                                    "inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-[11.5px] font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50",
                                                    seqFocusRing
                                                )}
                                            >
                                                {unenrolling ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <UserMinus className="h-3 w-3" />
                                                )}
                                                Unenroll
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto px-4.5 pb-7 pt-4.5">
                                    <LeadJourneyTimeline
                                        enrollmentId={selected.id}
                                        channelFilter={journeyFilter}
                                        nextTouchAt={selected.next_step_at}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="grid flex-1 place-items-center px-6 text-center text-gray-400">
                                <div>
                                    <Brain className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                                    <p className="text-sm">
                                        {enrollments.length === 0
                                            ? "Nothing enrolled yet — enroll a list to start."
                                            : "Select a lead to see its AI journey."}
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>

                    <SequenceConfigRail
                        clientId={clientId}
                        sequenceId={sequenceId}
                        sequence={sequence}
                    />
                </div>

                <TestNowDialog
                    open={testOpen}
                    onOpenChange={setTestOpen}
                    sequenceId={sequenceId}
                    clientId={clientId}
                    enrollments={enrollments}
                />
            </div>
        </TooltipProvider>
    );
}
