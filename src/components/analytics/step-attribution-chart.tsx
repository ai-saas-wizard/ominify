"use client";

import { useEffect, useState } from "react";
import { BarChart3, MessageSquare, Mail, Phone, Trophy } from "lucide-react";
import { getStepAnalytics } from "@/app/actions/sequence-actions";

interface StepAnalyticsRow {
    step_id: string;
    reply_rate: number;
    conversion_rate: number;
    attribution_score: number;
    total_delivered: number;
    total_replies: number;
    total_conversions: number;
    attributed_conversions: number;
    mutated_executions: number;
    mutated_conversion_rate: number;
    cost_per_conversion: number;
    total_cost: number;
    sequence_steps?: {
        step_order: number;
        channel: string;
    };
}

interface StepAttributionChartProps {
    sequenceId: string;
}

const channelIcons: Record<string, any> = {
    sms: MessageSquare,
    email: Mail,
    voice: Phone,
};

const channelColors: Record<string, string> = {
    sms: "bg-blue-500",
    email: "bg-amber-500",
    voice: "bg-purple-500",
};

export function StepAttributionChart({ sequenceId }: StepAttributionChartProps) {
    const [analytics, setAnalytics] = useState<StepAnalyticsRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const result = await getStepAnalytics(sequenceId);
            if (result.success) {
                const sorted = (result.data || []).sort(
                    (a: any, b: any) =>
                        (a.sequence_steps?.step_order || 0) - (b.sequence_steps?.step_order || 0)
                );
                setAnalytics(sorted);
            }
            setLoading(false);
        }
        load();
    }, [sequenceId]);

    if (loading) {
        return (
            <div className="bg-white rounded-xl border p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-48 mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-100 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    if (analytics.length === 0) {
        return (
            <div className="bg-white rounded-xl border p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Step Attribution</h3>
                <p className="text-sm text-gray-500">
                    Analytics will appear once the sequence has enough execution data.
                </p>
            </div>
        );
    }

    const maxAttribution = Math.max(...analytics.map(a => parseFloat(String(a.attribution_score)) || 0), 0.01);

    return (
        <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">Step Attribution</h3>
            </div>

            <div className="space-y-3">
                {analytics.map((sa) => {
                    const step = sa.sequence_steps;
                    const channel = step?.channel || "sms";
                    const Icon = channelIcons[channel] || MessageSquare;
                    const barColor = channelColors[channel] || "bg-gray-500";
                    const attrScore = parseFloat(String(sa.attribution_score)) || 0;
                    const attrPct = maxAttribution > 0 ? (attrScore / maxAttribution) * 100 : 0;
                    const replyRate = parseFloat(String(sa.reply_rate)) || 0;
                    const convRate = parseFloat(String(sa.conversion_rate)) || 0;

                    return (
                        <div key={sa.step_id} className="p-3 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className={`p-1 rounded ${barColor} bg-opacity-10`}>
                                        <Icon className={`w-3.5 h-3.5 ${barColor.replace("bg-", "text-")}`} />
                                    </div>
                                    <span className="text-xs font-medium text-gray-700">
                                        Step {step?.step_order} &middot; {channel.toUpperCase()}
                                    </span>
                                    {attrScore >= 0.3 && (
                                        <Trophy className="w-3 h-3 text-amber-500" />
                                    )}
                                </div>
                                <span className="text-xs font-bold text-gray-900">
                                    {(attrScore * 100).toFixed(0)}% attribution
                                </span>
                            </div>

                            {/* Attribution bar */}
                            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                                <div
                                    className={`${barColor} h-2 rounded-full transition-all duration-500`}
                                    style={{ width: `${Math.max(attrPct, 2)}%` }}
                                />
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center gap-4 text-[10px] text-gray-500">
                                <span>Delivered: <b className="text-gray-700">{sa.total_delivered}</b></span>
                                <span>Reply: <b className="text-gray-700">{(replyRate * 100).toFixed(1)}%</b></span>
                                <span>Conv: <b className="text-gray-700">{(convRate * 100).toFixed(1)}%</b></span>
                                {sa.mutated_executions > 0 && (
                                    <span className="text-violet-500">
                                        AI: {(parseFloat(String(sa.mutated_conversion_rate)) * 100).toFixed(1)}%
                                    </span>
                                )}
                                {parseFloat(String(sa.total_cost)) > 0 && (
                                    <span>Cost: <b className="text-gray-700">${parseFloat(String(sa.total_cost)).toFixed(2)}</b></span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
