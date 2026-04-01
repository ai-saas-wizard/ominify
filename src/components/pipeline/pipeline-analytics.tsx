"use client";

import { motion } from "framer-motion";
import {
    ArrowLeft,
    TrendingUp,
    Clock,
    Users,
    BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsData {
    stages: { id: string; name: string; color: string }[];
    funnel: { stageId: string; stageName: string; color: string; count: number; dropOffPercent: number }[];
    durations: { stageName: string; color: string; avgHours: number }[];
    velocity: { week: string; entered: number; exited: number }[];
    sources: { source: string; count: number }[];
    totalContacts: number;
}

const SOURCE_LABELS: Record<string, string> = {
    google_ads: "Google Ads",
    facebook: "Facebook",
    csv_upload: "CSV Upload",
    manual: "Manual",
    api: "API",
    webhook: "Webhook",
    form: "Form",
    auto_trigger: "Auto Trigger",
    unknown: "Unknown",
};

function formatDuration(hours: number): string {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 7) return `${Math.round(days * 10) / 10}d`;
    return `${Math.round(days / 7)}w`;
}

export function PipelineAnalytics({
    clientId,
    pipelineId,
    pipelineName,
    pipelineColor,
    data,
}: {
    clientId: string;
    pipelineId: string;
    pipelineName: string;
    pipelineColor: string;
    data: AnalyticsData;
}) {
    const maxFunnelCount = Math.max(...data.funnel.map((f) => f.count), 1);

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-5xl mx-auto px-8 py-8">
                {/* Header */}
                <div className="flex items-center gap-3 mb-8">
                    <a
                        href={`/client/${clientId}/pipeline?pipeline=${pipelineId}`}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5 text-gray-500" />
                    </a>
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pipelineColor }} />
                            <h1 className="text-2xl font-bold text-gray-900">{pipelineName} Analytics</h1>
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">Pipeline performance and conversion metrics</p>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-xl border border-gray-200 p-4"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Users className="w-4 h-4 text-emerald-600" />
                            <p className="text-xs text-gray-500">Total Contacts</p>
                        </div>
                        <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.totalContacts}</p>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.05 } }}
                        className="bg-white rounded-xl border border-gray-200 p-4"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-blue-600" />
                            <p className="text-xs text-gray-500">Stages</p>
                        </div>
                        <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.stages.length}</p>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
                        className="bg-white rounded-xl border border-gray-200 p-4"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-amber-600" />
                            <p className="text-xs text-gray-500">Sources</p>
                        </div>
                        <p className="text-2xl font-bold text-gray-900 tabular-nums">{data.sources.length}</p>
                    </motion.div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    {/* Conversion Funnel */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
                        className="bg-white rounded-xl border border-gray-200 p-5 col-span-2"
                    >
                        <h3 className="text-sm font-semibold text-gray-800 mb-4">Conversion Funnel</h3>
                        <div className="space-y-3">
                            {data.funnel.map((stage, i) => (
                                <div key={stage.stageId} className="flex items-center gap-3">
                                    <div className="w-24 text-right">
                                        <p className="text-xs font-medium text-gray-700 truncate">{stage.stageName}</p>
                                    </div>
                                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                                        <div
                                            className="h-full rounded-lg transition-all duration-700 flex items-center px-3"
                                            style={{
                                                width: `${Math.max((stage.count / maxFunnelCount) * 100, 4)}%`,
                                                backgroundColor: stage.color,
                                            }}
                                        >
                                            <span className="text-xs font-bold text-white tabular-nums">
                                                {stage.count}
                                            </span>
                                        </div>
                                    </div>
                                    {i > 0 && stage.dropOffPercent > 0 && (
                                        <span className="text-xs text-red-500 font-medium w-12 tabular-nums">
                                            -{stage.dropOffPercent}%
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Stage Durations */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }}
                        className="bg-white rounded-xl border border-gray-200 p-5"
                    >
                        <div className="flex items-center gap-2 mb-4">
                            <Clock className="w-4 h-4 text-gray-500" />
                            <h3 className="text-sm font-semibold text-gray-800">Avg. Time in Stage</h3>
                        </div>
                        {data.durations.length > 0 ? (
                            <div className="space-y-2.5">
                                {data.durations.filter((d) => d.avgHours > 0).map((d) => (
                                    <div key={d.stageName} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                                            <span className="text-sm text-gray-700">{d.stageName}</span>
                                        </div>
                                        <span className="text-sm font-medium text-gray-900 tabular-nums">
                                            {formatDuration(d.avgHours)}
                                        </span>
                                    </div>
                                ))}
                                {data.durations.every((d) => d.avgHours === 0) && (
                                    <p className="text-xs text-gray-400 italic">Not enough data yet</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 italic">Not enough data yet</p>
                        )}
                    </motion.div>

                    {/* Source Breakdown */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.25 } }}
                        className="bg-white rounded-xl border border-gray-200 p-5"
                    >
                        <h3 className="text-sm font-semibold text-gray-800 mb-4">Lead Sources</h3>
                        {data.sources.length > 0 ? (
                            <div className="space-y-2.5">
                                {data.sources.map((s) => {
                                    const total = data.sources.reduce((a, b) => a + b.count, 0);
                                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                                    return (
                                        <div key={s.source} className="flex items-center gap-3">
                                            <span className="text-sm text-gray-700 w-24 truncate">
                                                {SOURCE_LABELS[s.source] || s.source}
                                            </span>
                                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500 rounded-full"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-500 tabular-nums w-8 text-right">{pct}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 italic">No source data available</p>
                        )}
                    </motion.div>

                    {/* Weekly Velocity */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }}
                        className="bg-white rounded-xl border border-gray-200 p-5 col-span-2"
                    >
                        <h3 className="text-sm font-semibold text-gray-800 mb-4">Weekly Velocity</h3>
                        {data.velocity.length > 0 ? (
                            <div className="flex items-end gap-4 h-32">
                                {data.velocity.map((v) => {
                                    const maxVelocity = Math.max(...data.velocity.map((x) => x.entered), 1);
                                    const heightPct = (v.entered / maxVelocity) * 100;
                                    return (
                                        <div key={v.week} className="flex-1 flex flex-col items-center gap-1">
                                            <span className="text-xs font-medium text-gray-900 tabular-nums">{v.entered}</span>
                                            <div className="w-full bg-gray-100 rounded-t-lg relative" style={{ height: "80px" }}>
                                                <div
                                                    className="absolute bottom-0 left-0 right-0 bg-emerald-500 rounded-t-lg transition-all"
                                                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-500">{v.week}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 italic">Not enough data yet</p>
                        )}
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
