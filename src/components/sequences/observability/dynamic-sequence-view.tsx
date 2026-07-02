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
    Pause,
    CheckCircle2,
    MessageSquare,
    XCircle,
    Bot,
    Loader2,
    UserMinus,
    FlaskConical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    toggleSequenceActive,
    deleteSequence,
    unenrollContact,
    listOutboundAgents,
    updateSequence,
} from "@/app/actions/sequence-actions";

// Dynamic enrollments spend most of their life awaiting an outcome or
// generating the next step — give those states honest colors.
const STATUS_COLORS: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    awaiting_outcome: "bg-sky-100 text-sky-700",
    generating_next_step: "bg-violet-100 text-violet-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-blue-100 text-blue-700",
    replied: "bg-emerald-100 text-emerald-700",
    booked: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    unenrolled: "bg-gray-100 text-gray-500",
    manual_stop: "bg-gray-100 text-gray-500",
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

    return (
        <TooltipProvider delayDuration={200}>
            <div className="h-full w-full flex flex-col bg-gray-50">
                {/* Header bar */}
                <div className="flex-shrink-0 bg-white border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Link
                            href={`/client/${clientId}/sequences`}
                            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <h2 className="text-sm font-semibold text-gray-900 max-w-[280px] truncate">
                            {sequence.name}
                        </h2>
                        <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-600 border-emerald-100">
                            <Brain className="w-3 h-3" />
                            AI-Driven
                        </Badge>

                        <Separator orientation="vertical" className="h-6" />

                        {/* Active toggle */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={handleToggleActive}
                                    disabled={toggling}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 hover:bg-gray-100"
                                >
                                    <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
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
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm hover:shadow-md transition-shadow"
                                >
                                    <Zap className="w-3.5 h-3.5" />
                                    Test now
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Fire a test to a phone number — bypasses pacing &amp; quiet-hours</TooltipContent>
                        </Tooltip>

                        <div className="flex-1" />

                        {/* Learning Dashboard */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link
                                    href={`/client/${clientId}/sequences/${sequenceId}/learning`}
                                    className="flex items-center justify-center w-8 h-8 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                >
                                    <Brain className="w-4 h-4" />
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
                                    className="w-8 h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete sequence</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* Info strip: strategy + agent + stats */}
                <div className="flex-shrink-0 px-4 pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <StrategyOverviewCard sequence={sequence} />

                    <div className="bg-white rounded-xl border shadow-sm p-4">
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5" />
                                Bound Agent
                            </h4>
                            {savingAgent && (
                                <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Saving
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                            Drives voice calls and the SMS persona for this sequence&apos;s texts.
                        </p>
                        {/* AI sequences require an agent — swapping is allowed,
                            unbinding is not (also enforced in updateSequenceCore). */}
                        <select
                            value={boundAgentId}
                            onChange={(e) => e.target.value && handleAgentChange(e.target.value)}
                            disabled={savingAgent || !agentsLoaded}
                            className="w-full p-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
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

                    <div className="bg-white rounded-xl border shadow-sm p-4">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                            Enrollment Stats
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: "Active", value: stats.active, icon: Zap, color: "text-green-600", bg: "bg-green-50" },
                                { label: "Paused", value: stats.paused, icon: Pause, color: "text-yellow-600", bg: "bg-yellow-50" },
                                { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-blue-600", bg: "bg-blue-50" },
                                { label: "Replied", value: stats.replied, icon: MessageSquare, color: "text-emerald-600", bg: "bg-emerald-50" },
                                { label: "Booked", value: stats.booked, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
                                { label: "Failed", value: stats.failed, icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
                            ].map((stat) => (
                                <div
                                    key={stat.label}
                                    className={`flex items-center gap-2 px-3 py-2 ${stat.bg} rounded-lg`}
                                >
                                    <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
                                    <div>
                                        <p className={`text-[10px] font-medium ${stat.color}`}>{stat.label}</p>
                                        <p className={`text-sm font-bold ${stat.color}`}>{stat.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Master/detail: lead list + journey timeline */}
                <div className="flex-1 min-h-0 p-4 flex gap-4">
                    {/* Lead list */}
                    <div className="w-80 flex-shrink-0 bg-white rounded-xl border shadow-sm flex flex-col overflow-hidden">
                        <div className="px-4 py-3 border-b flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-900">Leads</h3>
                            <span className="text-xs text-gray-400">{enrollments.length}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                            {enrollments.length === 0 && (
                                <div className="text-center py-12 text-gray-400 px-4">
                                    <Users className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-sm">No leads enrolled yet.</p>
                                    <p className="text-xs mt-1">
                                        Each lead&apos;s AI journey will appear here once enrolled.
                                    </p>
                                </div>
                            )}
                            {enrollments.map((e) => {
                                const isSelected = e.id === selectedEnrollmentId;
                                const contact = e.contacts;
                                return (
                                    <button
                                        key={e.id}
                                        onClick={() => setSelectedEnrollmentId(e.id)}
                                        className={`w-full text-left px-4 py-3 transition-colors ${
                                            isSelected ? "bg-emerald-50/70" : "hover:bg-gray-50"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                                {contact?.name || contact?.phone || `Lead ${e.id.substring(0, 8)}`}
                                            </p>
                                            <span
                                                className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                                    STATUS_COLORS[e.status] || STATUS_COLORS.active
                                                }`}
                                            >
                                                {STATUS_LABELS[e.status] || e.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-[11px] text-gray-400">
                                                Touch #{e.current_step_order || 1}
                                                {e.is_test && (
                                                    <span className="inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded-full text-[9px] font-semibold bg-amber-100 text-amber-700">
                                                        <FlaskConical className="w-2 h-2" />
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
                                                    className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700"
                                                >
                                                    {unenrollingId === e.id ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <UserMinus className="w-3 h-3" />
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
                    <div className="flex-1 min-w-0 bg-white rounded-xl border shadow-sm flex flex-col overflow-hidden">
                        <div className="px-4 py-3 border-b">
                            <h3 className="text-sm font-semibold text-gray-900">
                                {selectedEnrollment
                                    ? `Journey — ${
                                          selectedEnrollment.contacts?.name ||
                                          selectedEnrollment.contacts?.phone ||
                                          "Lead"
                                      }`
                                    : "Journey"}
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                                What the AI decided and did for this lead, step by step.
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {selectedEnrollmentId ? (
                                <LeadJourneyTimeline enrollmentId={selectedEnrollmentId} />
                            ) : (
                                <div className="text-center py-16 text-gray-400">
                                    <Brain className="w-8 h-8 mx-auto mb-2" />
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
