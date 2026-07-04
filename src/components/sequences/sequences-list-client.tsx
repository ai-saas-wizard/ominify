"use client";

import { motion, MotionConfig } from "framer-motion";
import Link from "next/link";
import {
    Sparkles,
    Mail,
    MessageSquare,
    Phone,
    Clock,
    GitBranch,
    Brain,
    Rocket,
    Trash2,
    MoreVertical,
    Power,
    ChevronDown,
    Bot,
    Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateSequenceDialog } from "@/components/sequences/create-sequence-dialog";
import { TaskDialog } from "@/components/sequences/task-dialog";
import { SequenceWizard } from "@/components/sequences/wizard";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteSequence, toggleSequenceActive, type ChannelReadiness } from "@/app/actions/sequence-actions";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
    seqFocusRing,
    seqBtnPrimary,
    seqBtnSecondary,
    seqBtnGhost,
    seqCardInteractive,
    seqCardStatic,
    SEQ_STATUS,
} from "@/components/sequences/theme";

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
    enrolled_count: number;
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
    /** Deployed outbound agents (server-fetched) — gates the wizard and empty state. */
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

// ── Constants ────────────────────────────────────────────────────────────────

/** Only critical/high urgency surfaces on the card; the rest lives in the detail view. */
const URGENCY_MARKERS: Record<string, { dot: string; label: string } | undefined> = {
    critical: { dot: "bg-red-500", label: "Critical" },
    high: { dot: "bg-amber-500", label: "High urgency" },
};

const TRIGGER_LABELS: Record<string, string> = {
    new_lead: "New Lead",
    missed_call: "Missed Call",
    form_submission: "Form Submission",
    manual: "Manual",
    tag_added: "Tag Added",
    status_change: "Status Change",
    schedule: "Schedule",
    meta_ads_lead: "Meta Ads Lead",
    google_ads_lead: "Google Ads Lead",
};

const CHANNEL_ICONS: Record<string, { icon: typeof MessageSquare; label: string }> = {
    sms: { icon: MessageSquare, label: "SMS" },
    email: { icon: Mail, label: "Email" },
    voice: { icon: Phone, label: "Voice" },
    wait: { icon: Clock, label: "Wait" },
    condition: { icon: GitBranch, label: "Condition" },
};

// ── Animation Variants ───────────────────────────────────────────────────────

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.04, delayChildren: 0.05 },
    },
};

const cardVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 300, damping: 30 },
    },
};

const statCardVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { delay: i * 0.05, type: "spring" as const, stiffness: 300, damping: 30 },
    }),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function completionRate(completed: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
}

// ── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: number }) {
    return (
        <motion.span
            key={value}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="tabular-nums"
        >
            {value.toLocaleString()}
        </motion.span>
    );
}

// ── Status Dot ───────────────────────────────────────────────────────────────

function StatusLabel({ active }: { active: boolean }) {
    const status = active ? SEQ_STATUS.live : SEQ_STATUS.draft;
    return (
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", status.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
            {status.label}
        </span>
    );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    dotClass,
    index,
}: {
    label: string;
    value: number;
    /** Semantic marker dot — only for live (emerald) and in-flight (sky) stats. */
    dotClass?: string;
    index: number;
}) {
    return (
        <motion.div custom={index} variants={statCardVariants} initial="hidden" animate="visible">
            <div className={cn(seqCardStatic, "px-4 py-3.5")}>
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {dotClass && <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />}
                    {label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                    <AnimatedNumber value={value} />
                </p>
            </div>
        </motion.div>
    );
}

// ── Channel Icons ────────────────────────────────────────────────────────────

function ChannelIcons({ channels }: { channels: string[] }) {
    const unique = [...new Set(channels)];
    if (unique.length === 0) return null;

    return (
        <div className="flex items-center gap-2">
            {unique.map((ch) => {
                const config = CHANNEL_ICONS[ch];
                if (!config) return null;
                const Icon = config.icon;
                const count = channels.filter((c) => c === ch).length;
                return (
                    <Tooltip key={ch}>
                        <TooltipTrigger asChild>
                            <span className="cursor-default text-gray-400 transition-colors hover:text-gray-600">
                                <Icon className="h-3.5 w-3.5" />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            {count} {config.label} step{count !== 1 ? "s" : ""}
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </div>
    );
}

// ── Sequence Card ────────────────────────────────────────────────────────────

function SequenceCard({
    sequence,
    clientId,
    onDelete,
    onToggleActive,
}: {
    sequence: SequenceCardData;
    clientId: string;
    onDelete: (id: string) => void;
    onToggleActive: (id: string, active: boolean) => void;
}) {
    const rate = completionRate(sequence.completed_count, sequence.total_enrolled);
    const urgency = URGENCY_MARKERS[sequence.urgency_tier];
    const [menuOpen, setMenuOpen] = useState(false);

    const metrics: { value: number; label: string; className?: string }[] = [
        { value: sequence.enrolled_count, label: "active" },
        { value: sequence.replied_count, label: "replied" },
        { value: sequence.booked_count, label: "booked" },
    ];
    if (sequence.failed_count > 0) {
        metrics.push({ value: sequence.failed_count, label: "failed", className: "text-red-600" });
    }

    return (
        <motion.div variants={cardVariants} layout className="group relative h-full">
            <Link
                href={`/client/${clientId}/sequences/${sequence.id}`}
                className={cn("block h-full rounded-xl", seqFocusRing)}
            >
                <Card className={cn(seqCardInteractive, "h-full cursor-pointer")}>
                    <CardContent className="flex h-full flex-col gap-4 p-5">
                        {/* Name + status */}
                        <div className="flex items-start justify-between gap-3 pr-6">
                            <div className="min-w-0">
                                <h3 className="truncate text-base font-semibold text-gray-900">
                                    {sequence.name}
                                </h3>
                                {sequence.description && (
                                    <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">
                                        {sequence.description}
                                    </p>
                                )}
                            </div>
                            <span className="mt-1">
                                <StatusLabel active={sequence.is_active} />
                            </span>
                        </div>

                        {/* Metric row */}
                        {sequence.total_enrolled > 0 ? (
                            <div className="space-y-2.5">
                                <div className="flex items-center gap-4">
                                    {metrics.map((m) => (
                                        <span key={m.label} className="flex items-baseline gap-1">
                                            <span
                                                className={cn(
                                                    "text-sm font-semibold tabular-nums text-gray-900",
                                                    m.className
                                                )}
                                            >
                                                {m.value.toLocaleString()}
                                            </span>
                                            <span className={cn("text-xs text-gray-500", m.className && "text-red-600/70")}>
                                                {m.label}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex cursor-default items-center gap-2">
                                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
                                                <div
                                                    className="h-full rounded-full bg-gray-900 transition-[width] duration-500 ease-out"
                                                    style={{ width: `${rate}%` }}
                                                />
                                            </div>
                                            <span className="text-xs font-medium tabular-nums text-gray-500">
                                                {rate}%
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {sequence.completed_count.toLocaleString()} of{" "}
                                        {sequence.total_enrolled.toLocaleString()} enrolled contacts completed
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400">No contacts enrolled yet</p>
                        )}

                        {/* Footer: markers + channels left, meta right */}
                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                            <div className="flex items-center gap-2">
                                {sequence.generation_mode === "dynamic" && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-default text-gray-400 transition-colors hover:text-gray-600">
                                                <Brain className="h-3.5 w-3.5" />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>Dynamic (AI-driven) sequence</TooltipContent>
                                    </Tooltip>
                                )}
                                {sequence.ai_mutation_steps > 0 && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-default text-gray-400 transition-colors hover:text-gray-600">
                                                <Sparkles className="h-3.5 w-3.5" />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {sequence.ai_mutation_steps} step
                                            {sequence.ai_mutation_steps !== 1 ? "s" : ""} with AI mutation
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                                {sequence.is_task && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-default text-gray-400 transition-colors hover:text-gray-600">
                                                <Rocket className="h-3.5 w-3.5" />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>One-off task</TooltipContent>
                                    </Tooltip>
                                )}
                                {urgency && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span
                                                className={cn(
                                                    "h-1.5 w-1.5 cursor-default rounded-full",
                                                    urgency.dot
                                                )}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent>{urgency.label}</TooltipContent>
                                    </Tooltip>
                                )}
                                {(sequence.generation_mode === "dynamic" ||
                                    sequence.ai_mutation_steps > 0 ||
                                    sequence.is_task ||
                                    urgency) && <span className="h-3 w-px bg-gray-200" />}
                                <ChannelIcons channels={sequence.channels} />
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
                                <span className="truncate">
                                    {TRIGGER_LABELS[sequence.trigger_type] || sequence.trigger_type}
                                </span>
                                <span aria-hidden>·</span>
                                <span className="whitespace-nowrap tabular-nums">
                                    {sequence.step_count} step{sequence.step_count !== 1 ? "s" : ""}
                                </span>
                                <span aria-hidden>·</span>
                                <span className="whitespace-nowrap">{relativeTime(sequence.created_at)}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </Link>

            {/* Context menu — sibling of the Link so menu clicks never navigate */}
            <div className="absolute right-3 top-3 z-10">
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(!menuOpen);
                    }}
                    aria-label="Sequence actions"
                    className={cn(
                        "rounded-md p-1 text-gray-400 opacity-0 transition-opacity duration-150 hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100",
                        menuOpen && "opacity-100",
                        seqFocusRing
                    )}
                >
                    <MoreVertical className="h-4 w-4" />
                </button>
                {menuOpen && (
                    <div
                        className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-md"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                        <button
                            onClick={() => {
                                onToggleActive(sequence.id, !sequence.is_active);
                                setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                        >
                            <Power className="h-3.5 w-3.5" />
                            {sequence.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm("Delete this sequence? Active enrollments will be stopped and all data removed. This cannot be undone.")) {
                                    onDelete(sequence.id);
                                }
                                setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SequencesListClient({ clientId, sequences, outboundAgents, channelReadiness, metaAdsConnected, googleAdsConnected, tenantProfile }: SequencesListClientProps) {
    const router = useRouter();
    const totalSequences = sequences.length;
    const activeSequences = sequences.filter((s) => s.is_active).length;
    const totalEnrolled = sequences.reduce((sum, s) => sum + s.enrolled_count, 0);
    const totalCompleted = sequences.reduce((sum, s) => sum + s.completed_count, 0);

    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [advancedCreateOpen, setAdvancedCreateOpen] = useState(false);
    const hasOutboundAgent = outboundAgents.length > 0;

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
            if (result.success) {
                router.refresh();
            } else {
                alert(result.error || "Failed to delete sequence");
            }
        },
        [router]
    );

    const handleToggleActive = useCallback(
        async (sequenceId: string, active: boolean) => {
            const result = await toggleSequenceActive(sequenceId, active);
            if (result.success) {
                router.refresh();
            } else {
                alert(result.error || "Failed to update sequence");
            }
        },
        [router]
    );

    return (
        <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={200}>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-8 p-4 lg:p-8"
            >
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="flex flex-wrap items-start justify-between gap-4"
                >
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                            Sequences
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">
                            Automated multi-step outreach workflows
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className={cn(seqBtnGhost, "px-3 py-2")}>
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
                            className={cn(seqBtnSecondary, "px-4 py-2")}
                        >
                            <Rocket className="h-4 w-4 text-gray-400" />
                            New Task
                        </button>
                        <button
                            onClick={() => setWizardOpen(true)}
                            className={cn(seqBtnPrimary, "px-4 py-2")}
                        >
                            <Plus className="h-4 w-4" />
                            New Sequence
                        </button>
                        <CreateSequenceDialog
                            clientId={clientId}
                            open={advancedCreateOpen}
                            onOpenChange={setAdvancedCreateOpen}
                            hideTrigger
                        />
                    </div>
                    <TaskDialog
                        open={taskDialogOpen}
                        onOpenChange={setTaskDialogOpen}
                        clientId={clientId}
                        channelReadiness={channelReadiness}
                        onLaunch={handleTaskLaunch}
                        onTestMode={handleTestMode}
                    />
                    {wizardOpen && (
                        <SequenceWizard
                            clientId={clientId}
                            outboundAgents={outboundAgents}
                            channelReadiness={channelReadiness}
                            metaAdsConnected={metaAdsConnected ?? false}
                            googleAdsConnected={googleAdsConnected ?? false}
                            tenantProfile={tenantProfile ?? { industry: "general", phone: "", email: "", business_name: "" }}
                            onClose={() => setWizardOpen(false)}
                        />
                    )}
                </motion.div>

                {/* Summary Stat Cards */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard label="Sequences" value={totalSequences} index={0} />
                    <StatCard
                        label="Active"
                        value={activeSequences}
                        dotClass="bg-emerald-500"
                        index={1}
                    />
                    <StatCard
                        label="Enrolled"
                        value={totalEnrolled}
                        dotClass="bg-sky-500"
                        index={2}
                    />
                    <StatCard label="Completed" value={totalCompleted} index={3} />
                </div>

                {/* Sequence Cards Grid */}
                {sequences.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                        <Card className="border-dashed border-gray-200 shadow-none">
                            <CardContent className="flex flex-col items-center px-6 py-16 text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                                    {hasOutboundAgent ? (
                                        <Sparkles className="h-5 w-5 text-gray-400" />
                                    ) : (
                                        <Bot className="h-5 w-5 text-gray-400" />
                                    )}
                                </div>
                                {hasOutboundAgent ? (
                                    <>
                                        <h3 className="mt-4 text-base font-semibold text-gray-900">
                                            Create your first AI sequence
                                        </h3>
                                        <p className="mt-1 max-w-md text-sm text-gray-500">
                                            You set the goal, touchpoints, and contact windows —
                                            the AI decides the channel, content, and timing of
                                            every touch.
                                        </p>
                                        <button
                                            onClick={() => setWizardOpen(true)}
                                            className={cn(seqBtnPrimary, "mt-6 px-5 py-2.5")}
                                        >
                                            <Sparkles className="h-4 w-4" />
                                            Create AI Sequence
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="mt-4 text-base font-semibold text-gray-900">
                                            Set up your AI agent first
                                        </h3>
                                        <p className="mt-1 max-w-md text-sm text-gray-500">
                                            Sequences are run by your AI agent — it texts and
                                            calls leads for you. Deploy an agent to get started.
                                        </p>
                                        <Link
                                            href={`/client/${clientId}/agents/new`}
                                            className={cn(seqBtnPrimary, "mt-6 px-5 py-2.5")}
                                        >
                                            <Bot className="h-4 w-4" />
                                            Set up your agent
                                        </Link>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                ) : (
                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                    >
                        {sequences.map((sequence) => (
                            <SequenceCard
                                key={sequence.id}
                                sequence={sequence}
                                clientId={clientId}
                                onDelete={handleDeleteSequence}
                                onToggleActive={handleToggleActive}
                            />
                        ))}
                    </motion.div>
                )}
            </motion.div>
        </TooltipProvider>
        </MotionConfig>
    );
}
