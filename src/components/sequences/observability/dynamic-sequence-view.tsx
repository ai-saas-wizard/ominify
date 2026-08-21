"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Brain,
    Trash2,
    Zap,
    Users,
    Bot,
    Loader2,
    UserMinus,
    FlaskConical,
    CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { TestNowDialog } from "@/components/sequences/flow/panels/test-now-dialog";
import { StrategyOverviewCard } from "./strategy-overview-card";
import { LeadJourneyTimeline } from "./lead-journey-timeline";
import {
    CallingScheduleCard,
    callingScheduleSummary,
} from "@/components/sequences/calling-schedule-card";
import { EnrollListCard } from "@/components/sequences/enroll-list-card";
import {
    toggleSequenceActive,
    deleteSequence,
    unenrollContact,
    listOutboundAgents,
    updateSequence,
} from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";
import { seqFocusRing, seqBtnSecondary, seqCardStatic } from "@/components/sequences/theme";

// Dynamic enrollments spend most of their life awaiting an outcome or
// generating the next step — those are in-flight (sky). Terminal outcomes
// stay neutral ink; only paused/failed carry warning/error color.
const ENROLLMENT_STATUS: Record<string, { dot: string; text: string }> = {
    active: { dot: "bg-sky-500", text: "text-sky-700" },
    awaiting_outcome: { dot: "bg-sky-500", text: "text-sky-700" },
    generating_next_step: { dot: "bg-sky-500", text: "text-sky-700" },
    paused: { dot: "bg-amber-500", text: "text-amber-700" },
    completed: { dot: "bg-gray-900", text: "text-gray-700" },
    replied: { dot: "bg-gray-900", text: "text-gray-700" },
    booked: { dot: "bg-gray-900", text: "text-gray-700" },
    failed: { dot: "bg-red-500", text: "text-red-700" },
    unenrolled: { dot: "bg-gray-300", text: "text-gray-500" },
    manual_stop: { dot: "bg-gray-300", text: "text-gray-500" },
};

const STATUS_LABELS: Record<string, string> = {
    awaiting_outcome: "awaiting outcome",
    generating_next_step: "thinking...",
    manual_stop: "stopped",
};

interface DynamicSequenceViewProps {
    clientId: string;
    sequenceId: string;
    sequence: any;
    enrollments: any[];
    isActive: boolean;
}

/**
 * Read-only observability view for AI-driven (generation_mode='dynamic')
 * sequences: the strategy the AI follows, plus a per-lead timeline of what it
 * actually decided and did. There is no step authoring here by design — steps
 * are generated per lead at runtime. Operational controls (activate, test,
 * agent binding, unenroll, delete) remain available.
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
    const [unenrollingId, setUnenrollingId] = useState<string | null>(null);

    // Bound-agent picker (operational, not authoring — same optimistic pattern
    // as the flow sidebar's Info tab).
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    const [agentsLoaded, setAgentsLoaded] = useState(false);
    const [boundAgentId, setBoundAgentId] = useState<string>(sequence.agent_id || "");
    const [savingAgent, setSavingAgent] = useState(false);

    useEffect(() => {
        listOutboundAgents(clientId).then((list) => {
            setAgents(list);
            setAgentsLoaded(true);
        });
    }, [clientId]);

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
        if (!confirm("Are you sure you want to delete this sequence? This cannot be undone.")) return;
        setDeleting(true);
        try {
            await deleteSequence(sequenceId);
            router.push(`/client/${clientId}/sequences`);
        } catch (err) {
            console.error("Delete error:", err);
            setDeleting(false);
        }
    }

    async function handleAgentChange(newAgentId: string) {
        const prev = boundAgentId;
        setBoundAgentId(newAgentId); // optimistic
        setSavingAgent(true);
        const fd = new FormData();
        fd.set("agent_id", newAgentId); // "" → unbind
        const res = await updateSequence(sequenceId, fd);
        setSavingAgent(false);
        if (!res?.success) {
            setBoundAgentId(prev);
            alert(res?.error || "Failed to update the bound agent");
        }
    }

    async function handleUnenroll(enrollmentId: string) {
        if (!confirm("Are you sure you want to unenroll this contact?")) return;
        setUnenrollingId(enrollmentId);
        const res = await unenrollContact(enrollmentId);
        setUnenrollingId(null);
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
    const IN_FLIGHT = ["active", "awaiting_outcome", "generating_next_step"];
    const stats = {
        active: enrollments.filter((e) => IN_FLIGHT.includes(e.status)).length,
        paused: enrollments.filter((e) => e.status === "paused").length,
        completed: enrollments.filter((e) => e.status === "completed").length,
        replied: enrollments.filter((e) => e.status === "replied").length,
        booked: enrollments.filter((e) => e.status === "booked").length,
        failed: enrollments.filter((e) => e.status === "failed").length,
        total: enrollments.length,
    };

    const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);
    const scheduleSummary = callingScheduleSummary(sequence);

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex h-full w-full flex-col bg-gray-50">
                {/* Header bar */}
                <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-2.5">
                        <Link
                            href={`/client/${clientId}/sequences`}
                            className={cn(
                                "rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900",
                                seqFocusRing
                            )}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <h2 className="max-w-[280px] truncate text-sm font-semibold text-gray-900">
                            {sequence.name}
                        </h2>
                        <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-500">
                            <Brain className="h-3 w-3 text-gray-400" />
                            AI-driven
                        </span>

                        <Separator orientation="vertical" className="h-5" />

                        {/* Active toggle */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={handleToggleActive}
                                    disabled={toggling}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50",
                                        seqFocusRing
                                    )}
                                >
                                    <div className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-gray-300"}`} />
                                    {toggling ? "..." : isActive ? "Active" : "Inactive"}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Toggle sequence active/inactive</TooltipContent>
                        </Tooltip>

                        {/* Test now */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={() => setTestOpen(true)}
                                    className={cn(seqBtnSecondary, "px-2.5 py-1 text-xs")}
                                >
                                    <Zap className="h-3.5 w-3.5 text-gray-400" />
                                    Test now
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Fire a test to a phone number — bypasses pacing &amp; quiet-hours</TooltipContent>
                        </Tooltip>

                        {/* Read-only calling-schedule summary */}
                        {scheduleSummary && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium tabular-nums text-gray-600">
                                        <CalendarClock className="h-3 w-3 text-gray-400" />
                                        {scheduleSummary}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Voice dialing limit &amp; window (business timezone)
                                </TooltipContent>
                            </Tooltip>
                        )}

                        <div className="flex-1" />

                        {/* Learning Dashboard */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link
                                    href={`/client/${clientId}/sequences/${sequenceId}/learning`}
                                    className={cn(
                                        "flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900",
                                        seqFocusRing
                                    )}
                                >
                                    <Brain className="h-4 w-4" />
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent>Learning Dashboard</TooltipContent>
                        </Tooltip>

                        {/* Delete */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete sequence</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* Info strip: strategy + agent + stats */}
                <div className="grid flex-shrink-0 grid-cols-1 gap-4 px-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StrategyOverviewCard sequence={sequence} />

                    <div className={cn(seqCardStatic, "p-4")}>
                        <div className="mb-1 flex items-center justify-between">
                            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                <Bot className="h-3.5 w-3.5 text-gray-400" />
                                Bound Agent
                            </h4>
                            {savingAgent && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Saving
                                </span>
                            )}
                        </div>
                        <p className="mb-2 text-xs text-gray-500">
                            Drives voice calls and the SMS persona for this sequence&apos;s texts.
                        </p>
                        {/* AI sequences require an agent — swapping is allowed,
                            unbinding is not (also enforced in updateSequenceCore). */}
                        <select
                            value={boundAgentId}
                            onChange={(e) => e.target.value && handleAgentChange(e.target.value)}
                            disabled={savingAgent || !agentsLoaded}
                            className={cn(
                                "w-full rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:ring-2 focus:ring-emerald-600/50 disabled:opacity-60"
                            )}
                        >
                            {!boundAgentId && (
                                <option value="" disabled>
                                    Select an agent
                                </option>
                            )}
                            {boundAgentId && !agents.some((a) => a.id === boundAgentId) && (
                                <option value={boundAgentId}>Current agent</option>
                            )}
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <CallingScheduleCard sequenceId={sequenceId} sequence={sequence} />
                    <EnrollListCard sequenceId={sequenceId} clientId={clientId} />

                    <div className={cn(seqCardStatic, "p-4")}>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                            Enrollment Stats
                        </h4>
                        <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3">
                            {[
                                { label: "Active", value: stats.active, dot: "bg-sky-500" },
                                { label: "Paused", value: stats.paused, dot: "bg-amber-500" },
                                { label: "Completed", value: stats.completed },
                                { label: "Replied", value: stats.replied },
                                { label: "Booked", value: stats.booked },
                                { label: "Failed", value: stats.failed, dot: "bg-red-500" },
                            ].map((stat) => (
                                <div key={stat.label}>
                                    <p className="flex items-center gap-1.5 text-xs text-gray-500">
                                        {stat.dot && (
                                            <span className={cn("h-1.5 w-1.5 rounded-full", stat.dot)} />
                                        )}
                                        {stat.label}
                                    </p>
                                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                                        {stat.value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Master/detail: lead list + journey timeline */}
                <div className="flex min-h-0 flex-1 gap-4 p-4">
                    {/* Lead list */}
                    <div className={cn(seqCardStatic, "flex w-80 flex-shrink-0 flex-col overflow-hidden")}>
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                            <h3 className="text-sm font-semibold text-gray-900">Leads</h3>
                            <span className="text-xs tabular-nums text-gray-400">{enrollments.length}</span>
                        </div>
                        <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
                            {enrollments.length === 0 && (
                                <div className="px-4 py-12 text-center text-gray-400">
                                    <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                                    <p className="text-sm">No leads enrolled yet.</p>
                                    <p className="mt-1 text-xs">
                                        Each lead&apos;s AI journey will appear here once enrolled.
                                    </p>
                                </div>
                            )}
                            {enrollments.map((e) => {
                                const isSelected = e.id === selectedEnrollmentId;
                                const contact = e.contacts;
                                const status = ENROLLMENT_STATUS[e.status] || ENROLLMENT_STATUS.active;
                                return (
                                    <button
                                        key={e.id}
                                        onClick={() => setSelectedEnrollmentId(e.id)}
                                        className={cn(
                                            "w-full border-l-2 px-4 py-3 text-left transition-colors",
                                            isSelected
                                                ? "border-l-gray-900 bg-gray-50"
                                                : "border-l-transparent hover:bg-gray-50"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="truncate text-sm font-medium text-gray-900">
                                                {contact?.name || contact?.phone || `Lead ${e.id.substring(0, 8)}`}
                                            </p>
                                            <span
                                                className={cn(
                                                    "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
                                                    status.text
                                                )}
                                            >
                                                <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                                                {STATUS_LABELS[e.status] || e.status}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between">
                                            <span className="text-xs tabular-nums text-gray-400">
                                                Touch #{e.current_step_order || 1}
                                                {e.is_test && (
                                                    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-1 py-px text-xs font-medium text-amber-700">
                                                        <FlaskConical className="h-2.5 w-2.5" />
                                                        Test
                                                    </span>
                                                )}
                                            </span>
                                            {(e.status === "active" ||
                                                e.status === "paused" ||
                                                e.status === "awaiting_outcome") && (
                                                <span
                                                    role="button"
                                                    onClick={(ev) => {
                                                        ev.stopPropagation();
                                                        handleUnenroll(e.id);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-700"
                                                >
                                                    {unenrollingId === e.id ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <UserMinus className="h-3 w-3" />
                                                    )}
                                                    Unenroll
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Journey timeline */}
                    <div className={cn(seqCardStatic, "flex min-w-0 flex-1 flex-col overflow-hidden")}>
                        <div className="border-b border-gray-100 px-4 py-3">
                            <h3 className="text-sm font-semibold text-gray-900">
                                {selectedEnrollment
                                    ? `Journey — ${
                                          selectedEnrollment.contacts?.name ||
                                          selectedEnrollment.contacts?.phone ||
                                          "Lead"
                                      }`
                                    : "Journey"}
                            </h3>
                            <p className="mt-0.5 text-xs text-gray-400">
                                What the AI decided and did for this lead, step by step.
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {selectedEnrollmentId ? (
                                <LeadJourneyTimeline enrollmentId={selectedEnrollmentId} />
                            ) : (
                                <div className="py-16 text-center text-gray-400">
                                    <Brain className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                                    <p className="text-sm">Select a lead to see its AI journey.</p>
                                </div>
                            )}
                        </div>
                    </div>
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
