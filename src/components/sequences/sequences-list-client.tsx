"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
    Zap,
    ToggleRight,
    Users,
    CheckCircle2,
    ListOrdered,
    Sparkles,
    Mail,
    MessageSquare,
    Phone,
    Clock,
    GitBranch,
    Brain,
    TrendingUp,
    Calendar,
    ArrowRight,
    Activity,
    Reply,
    CalendarCheck,
    XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateSequenceDialog } from "@/components/sequences/create-sequence-dialog";
import { AIGenerateSequenceDialog } from "@/components/sequences/ai-generate-sequence-dialog";

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
}

interface SequencesListClientProps {
    clientId: string;
    sequences: SequenceCardData[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
    critical: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
    high: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
    medium: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-amber-500" },
    low: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
};

const TRIGGER_LABELS: Record<string, string> = {
    new_lead: "New Lead",
    missed_call: "Missed Call",
    form_submission: "Form Submission",
    manual: "Manual",
    tag_added: "Tag Added",
    status_change: "Status Change",
    schedule: "Schedule",
};

const CHANNEL_ICONS: Record<string, { icon: typeof MessageSquare; color: string; label: string }> = {
    sms: { icon: MessageSquare, color: "text-blue-500", label: "SMS" },
    email: { icon: Mail, color: "text-violet-500", label: "Email" },
    voice: { icon: Phone, color: "text-emerald-500", label: "Voice" },
    wait: { icon: Clock, color: "text-amber-500", label: "Wait" },
    condition: { icon: GitBranch, color: "text-pink-500", label: "Condition" },
};

// ── Animation Variants ───────────────────────────────────────────────────────

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.06, delayChildren: 0.1 },
    },
};

const cardVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.97 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
};

const statCardVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { delay: i * 0.08, type: "spring" as const, stiffness: 400, damping: 25 },
    }),
};

const emptyVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: {
        opacity: 1,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 200, damping: 20 },
    },
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
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="tabular-nums"
        >
            {value.toLocaleString()}
        </motion.span>
    );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
    icon: Icon,
    label,
    value,
    iconBg,
    iconColor,
    index,
}: {
    icon: typeof Zap;
    label: string;
    value: number;
    iconBg: string;
    iconColor: string;
    index: number;
}) {
    return (
        <motion.div custom={index} variants={statCardVariants} initial="hidden" animate="visible">
            <Card className="overflow-hidden border-gray-200/60 hover:border-gray-300 transition-colors">
                <CardContent className="p-5">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 ${iconBg} rounded-xl`}>
                            <Icon className={`w-5 h-5 ${iconColor}`} />
                        </div>
                        <div>
                            <p className="text-[13px] font-medium text-gray-500">{label}</p>
                            <p className="text-2xl font-bold text-gray-900">
                                <AnimatedNumber value={value} />
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ── Channel Pills ────────────────────────────────────────────────────────────

function ChannelPills({ channels }: { channels: string[] }) {
    const unique = [...new Set(channels)];
    if (unique.length === 0) return null;

    return (
        <div className="flex items-center gap-1">
            {unique.map((ch) => {
                const config = CHANNEL_ICONS[ch];
                if (!config) return null;
                const Icon = config.icon;
                const count = channels.filter((c) => c === ch).length;
                return (
                    <Tooltip key={ch}>
                        <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors cursor-default">
                                <Icon className={`w-3 h-3 ${config.color}`} />
                                <span className="text-[10px] font-semibold text-gray-500">{count}</span>
                            </div>
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

function SequenceCard({ sequence, clientId }: { sequence: SequenceCardData; clientId: string }) {
    const rate = completionRate(sequence.completed_count, sequence.total_enrolled);
    const urgency = URGENCY_CONFIG[sequence.urgency_tier] || URGENCY_CONFIG.medium;

    return (
        <motion.div variants={cardVariants} layout>
            <Link href={`/client/${clientId}/sequences/${sequence.id}`} className="block h-full">
                <Card className="h-full overflow-hidden border-gray-200/60 hover:border-violet-300 hover:shadow-lg transition-all duration-200 group cursor-pointer">
                    {/* Active indicator bar */}
                    <div
                        className={`h-1 w-full ${
                            sequence.is_active
                                ? "bg-gradient-to-r from-green-400 to-emerald-500"
                                : "bg-gray-200"
                        }`}
                    />

                    <CardContent className="p-5 flex flex-col gap-3.5">
                        {/* Row 1: Title + Status */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-gray-900 group-hover:text-violet-700 transition-colors truncate text-[15px]">
                                    {sequence.name}
                                </h3>
                                {sequence.description && (
                                    <p className="text-[13px] text-gray-500 mt-0.5 line-clamp-1">
                                        {sequence.description}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                {sequence.generation_mode === "dynamic" && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="p-1 rounded-md bg-violet-50">
                                                <Brain className="w-3.5 h-3.5 text-violet-500" />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>Dynamic (AI-driven) sequence</TooltipContent>
                                    </Tooltip>
                                )}
                                {sequence.ai_mutation_steps > 0 && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="p-1 rounded-md bg-amber-50">
                                                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {sequence.ai_mutation_steps} step{sequence.ai_mutation_steps !== 1 ? "s" : ""} with AI mutation
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                                {sequence.is_active ? (
                                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                        </span>
                                        Live
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary" className="gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                        Draft
                                    </Badge>
                                )}
                            </div>
                        </div>

                        {/* Row 2: Badges (trigger + urgency + channels) */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="outline" className="text-[11px] px-2 py-0 h-5 bg-violet-50/50 border-violet-100 text-violet-600">
                                    {TRIGGER_LABELS[sequence.trigger_type] || sequence.trigger_type}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={`text-[11px] px-2 py-0 h-5 ${urgency.bg} border-transparent ${urgency.text}`}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full ${urgency.dot} mr-1`} />
                                    {sequence.urgency_tier}
                                </Badge>
                            </div>
                            <ChannelPills channels={sequence.channels} />
                        </div>

                        {/* Row 3: Enrollment funnel stats */}
                        {sequence.total_enrolled > 0 && (
                            <div className="grid grid-cols-4 gap-1.5">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-blue-50/60 border border-blue-100/50">
                                            <Activity className="w-3 h-3 text-blue-500 mb-0.5" />
                                            <span className="text-xs font-bold text-gray-900">{sequence.enrolled_count}</span>
                                            <span className="text-[9px] text-gray-500">Active</span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Currently enrolled contacts</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-violet-50/60 border border-violet-100/50">
                                            <Reply className="w-3 h-3 text-violet-500 mb-0.5" />
                                            <span className="text-xs font-bold text-gray-900">{sequence.replied_count}</span>
                                            <span className="text-[9px] text-gray-500">Replied</span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Contacts who replied</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-emerald-50/60 border border-emerald-100/50">
                                            <CalendarCheck className="w-3 h-3 text-emerald-500 mb-0.5" />
                                            <span className="text-xs font-bold text-gray-900">{sequence.booked_count}</span>
                                            <span className="text-[9px] text-gray-500">Booked</span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Contacts who booked</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-red-50/60 border border-red-100/50">
                                            <XCircle className="w-3 h-3 text-red-400 mb-0.5" />
                                            <span className="text-xs font-bold text-gray-900">{sequence.failed_count}</span>
                                            <span className="text-[9px] text-gray-500">Failed</span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Contacts who failed</TooltipContent>
                                </Tooltip>
                            </div>
                        )}

                        {/* Row 4: Completion progress */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-gray-500">Completion</span>
                                <span className="text-[11px] font-semibold text-gray-700">{rate}%</span>
                            </div>
                            <Progress value={rate} className="h-1.5" />
                        </div>

                        {/* Row 5: Footer meta */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <div className="flex items-center gap-3 text-[12px] text-gray-500">
                                <span className="flex items-center gap-1">
                                    <ListOrdered className="w-3.5 h-3.5" />
                                    {sequence.step_count} step{sequence.step_count !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5" />
                                    {sequence.total_enrolled} total
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {relativeTime(sequence.created_at)}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-violet-500 group-hover:translate-x-0.5 transition-all" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </Link>
        </motion.div>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SequencesListClient({ clientId, sequences }: SequencesListClientProps) {
    const totalSequences = sequences.length;
    const activeSequences = sequences.filter((s) => s.is_active).length;
    const totalEnrolled = sequences.reduce((sum, s) => sum + s.enrolled_count, 0);
    const totalCompleted = sequences.reduce((sum, s) => sum + s.completed_count, 0);

    return (
        <TooltipProvider delayDuration={200}>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="p-4 lg:p-8 space-y-6"
            >
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="flex items-center justify-between"
                >
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <div className="p-1.5 bg-violet-100 rounded-lg">
                                <Zap className="w-5 h-5 text-violet-600" />
                            </div>
                            Sequences
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">
                            Automated multi-step outreach workflows
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <AIGenerateSequenceDialog clientId={clientId} />
                        <CreateSequenceDialog clientId={clientId} variant="secondary" />
                    </div>
                </motion.div>

                {/* Summary Stat Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        icon={ListOrdered}
                        label="Total Sequences"
                        value={totalSequences}
                        iconBg="bg-violet-100"
                        iconColor="text-violet-600"
                        index={0}
                    />
                    <StatCard
                        icon={ToggleRight}
                        label="Active Sequences"
                        value={activeSequences}
                        iconBg="bg-green-100"
                        iconColor="text-green-600"
                        index={1}
                    />
                    <StatCard
                        icon={Users}
                        label="Total Enrolled"
                        value={totalEnrolled}
                        iconBg="bg-blue-100"
                        iconColor="text-blue-600"
                        index={2}
                    />
                    <StatCard
                        icon={TrendingUp}
                        label="Completed"
                        value={totalCompleted}
                        iconBg="bg-emerald-100"
                        iconColor="text-emerald-600"
                        index={3}
                    />
                </div>

                {/* Sequence Cards Grid */}
                {sequences.length === 0 ? (
                    <motion.div variants={emptyVariants} initial="hidden" animate="visible">
                        <Card className="border-dashed border-2 border-gray-200">
                            <CardContent className="p-12 text-center">
                                <motion.div
                                    animate={{
                                        rotate: [0, 5, -5, 0],
                                        scale: [1, 1.05, 1],
                                    }}
                                    transition={{
                                        duration: 3,
                                        repeat: Infinity,
                                        repeatType: "reverse",
                                    }}
                                    className="inline-flex p-4 bg-gradient-to-br from-violet-100 to-purple-100 rounded-2xl mb-4"
                                >
                                    <Sparkles className="w-8 h-8 text-violet-600" />
                                </motion.div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                    Describe your first sequence
                                </h3>
                                <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                                    Tell our AI what you need and it will build a complete multi-channel
                                    outreach sequence for you.
                                </p>
                                <div className="flex flex-col items-center gap-3">
                                    <AIGenerateSequenceDialog clientId={clientId} variant="hero" />
                                    <CreateSequenceDialog clientId={clientId} variant="link" />
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                ) : (
                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                    >
                        {sequences.map((sequence) => (
                            <SequenceCard key={sequence.id} sequence={sequence} clientId={clientId} />
                        ))}
                    </motion.div>
                )}
            </motion.div>
        </TooltipProvider>
    );
}
