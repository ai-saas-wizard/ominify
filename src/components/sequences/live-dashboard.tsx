"use client";

import { motion } from "framer-motion";
import {
    Users,
    MessageSquare,
    Reply,
    CalendarCheck,
    Activity,
    Brain,
    Phone,
    Mail,
    Clock,
    ArrowRight,
    Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ───

interface LiveDashboardProps {
    sequence: {
        id: string;
        name: string;
        is_active: boolean;
        generation_mode: string | null;
    };
    metrics: {
        enrolled: number;
        messagesSentThisWeek: number;
        replies: number;
        booked: number;
        activeConversations: number;
    };
    recentActivity: ActivityEntry[];
    clientId: string;
}

interface ActivityEntry {
    id: string;
    timestamp: string;
    type: "sms_sent" | "voice_call" | "email_sent" | "reply_received" | "booked" | "paused" | "handoff";
    contactName: string;
    description: string;
    aiReasoning?: string;
}

// ─── Helpers ───

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
    return `${days}d ago`;
}

const ACTIVITY_ICONS: Record<string, { icon: typeof MessageSquare; color: string; bg: string }> = {
    sms_sent: { icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-50" },
    voice_call: { icon: Phone, color: "text-violet-500", bg: "bg-violet-50" },
    email_sent: { icon: Mail, color: "text-blue-500", bg: "bg-blue-50" },
    reply_received: { icon: Reply, color: "text-emerald-600", bg: "bg-emerald-50" },
    booked: { icon: CalendarCheck, color: "text-green-600", bg: "bg-green-50" },
    paused: { icon: Clock, color: "text-amber-500", bg: "bg-amber-50" },
    handoff: { icon: Activity, color: "text-red-500", bg: "bg-red-50" },
};

const statCardVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { delay: i * 0.08, type: "spring" as const, stiffness: 400, damping: 25 },
    }),
};

// ─── Metric Card ───

function MetricCard({
    icon: Icon,
    label,
    value,
    iconColor,
    iconBg,
    index,
}: {
    icon: typeof Users;
    label: string;
    value: number;
    iconColor: string;
    iconBg: string;
    index: number;
}) {
    return (
        <motion.div custom={index} variants={statCardVariants} initial="hidden" animate="visible">
            <Card className="border-gray-200/60">
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-xl", iconBg)}>
                            <Icon className={cn("w-4 h-4", iconColor)} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-gray-500">{label}</p>
                            <p className="text-xl font-bold text-gray-900">{value}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ─── Main Component ───

export function LiveDashboard({
    sequence,
    metrics,
    recentActivity,
    clientId,
}: LiveDashboardProps) {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {sequence.generation_mode === "dynamic" && (
                        <div className="p-1.5 bg-emerald-100 rounded-lg">
                            <Brain className="w-5 h-5 text-emerald-600" />
                        </div>
                    )}
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            {sequence.name}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            {sequence.is_active ? (
                                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-xs">
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                    </span>
                                    Live
                                </Badge>
                            ) : (
                                <Badge variant="secondary" className="text-xs">Draft</Badge>
                            )}
                            {sequence.generation_mode === "dynamic" && (
                                <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 text-xs">
                                    AI-Powered
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <MetricCard
                    icon={Users}
                    label="Leads in Sequence"
                    value={metrics.enrolled}
                    iconColor="text-blue-600"
                    iconBg="bg-blue-100"
                    index={0}
                />
                <MetricCard
                    icon={MessageSquare}
                    label="Sent This Week"
                    value={metrics.messagesSentThisWeek}
                    iconColor="text-emerald-600"
                    iconBg="bg-emerald-100"
                    index={1}
                />
                <MetricCard
                    icon={Reply}
                    label="Replies"
                    value={metrics.replies}
                    iconColor="text-emerald-600"
                    iconBg="bg-emerald-100"
                    index={2}
                />
                <MetricCard
                    icon={CalendarCheck}
                    label="Booked"
                    value={metrics.booked}
                    iconColor="text-green-600"
                    iconBg="bg-green-100"
                    index={3}
                />
                <MetricCard
                    icon={Activity}
                    label="Active Conversations"
                    value={metrics.activeConversations}
                    iconColor="text-violet-600"
                    iconBg="bg-violet-100"
                    index={4}
                />
            </div>

            {/* Recent Activity Feed */}
            <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Recent Activity
                </h3>
                <Card className="border-gray-200/60">
                    <CardContent className="p-0 divide-y divide-gray-100">
                        {recentActivity.length === 0 ? (
                            <div className="p-6 text-center text-sm text-gray-400">
                                No activity yet. Enroll leads to get started.
                            </div>
                        ) : (
                            recentActivity.map((entry, i) => {
                                const actCfg = ACTIVITY_ICONS[entry.type] || ACTIVITY_ICONS.sms_sent;
                                const Icon = actCfg.icon;

                                return (
                                    <motion.div
                                        key={entry.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        className="flex items-start gap-3 p-4 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                                    >
                                        <div className={cn("p-1.5 rounded-lg flex-shrink-0", actCfg.bg)}>
                                            <Icon className={cn("w-3.5 h-3.5", actCfg.color)} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-gray-800">
                                                <span className="font-medium">{entry.contactName}</span>
                                                {" · "}
                                                {entry.description}
                                            </p>
                                            {entry.aiReasoning && (
                                                <div className="flex items-center gap-1 mt-1">
                                                    <Brain className="w-3 h-3 text-emerald-400" />
                                                    <p className="text-xs text-emerald-600">
                                                        {entry.aiReasoning}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-xs text-gray-400">
                                                {relativeTime(entry.timestamp)}
                                            </span>
                                            <Eye className="w-3.5 h-3.5 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                                        </div>
                                    </motion.div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
