"use client";

import { useEffect, useState } from "react";
import { Users, MessageSquare, Phone, CalendarCheck, UserX } from "lucide-react";
import { getConversionFunnel } from "@/app/actions/sequence-actions";

interface FunnelData {
    enrolled: number;
    engaged: number;
    replied: number;
    answered: number;
    converted: number;
    optedOut: number;
}

interface ConversionFunnelProps {
    sequenceId: string;
}

export function ConversionFunnel({ sequenceId }: ConversionFunnelProps) {
    const [funnel, setFunnel] = useState<FunnelData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const result = await getConversionFunnel(sequenceId);
            if (result.success && result.data) {
                setFunnel(result.data);
            }
            setLoading(false);
        }
        load();
    }, [sequenceId]);

    if (loading) {
        return (
            <div className="bg-white rounded-xl border p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-10 bg-gray-100 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    if (!funnel || funnel.enrolled === 0) {
        return (
            <div className="bg-white rounded-xl border p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Conversion Funnel</h3>
                <p className="text-sm text-gray-500">No enrollment data yet. Enroll contacts to see funnel metrics.</p>
            </div>
        );
    }

    const stages = [
        { label: "Enrolled", count: funnel.enrolled, icon: Users, color: "bg-blue-500" },
        { label: "Engaged", count: funnel.engaged, icon: MessageSquare, color: "bg-indigo-500" },
        { label: "Replied", count: funnel.replied, icon: MessageSquare, color: "bg-violet-500" },
        { label: "Answered Call", count: funnel.answered, icon: Phone, color: "bg-purple-500" },
        { label: "Converted", count: funnel.converted, icon: CalendarCheck, color: "bg-green-500" },
    ];

    const maxCount = funnel.enrolled;

    return (
        <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Conversion Funnel</h3>
                {funnel.optedOut > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-500">
                        <UserX className="w-3 h-3" />
                        <span>{funnel.optedOut} opted out</span>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {stages.map((stage, idx) => {
                    const pct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
                    const prevCount = idx > 0 ? stages[idx - 1].count : maxCount;
                    const dropoff = prevCount > 0 && idx > 0
                        ? ((prevCount - stage.count) / prevCount * 100).toFixed(0)
                        : null;

                    return (
                        <div key={stage.label}>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <div className="flex items-center gap-1.5">
                                    <stage.icon className="w-3.5 h-3.5 text-gray-500" />
                                    <span className="font-medium text-gray-700">{stage.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-gray-900">{stage.count}</span>
                                    <span className="text-gray-400">({pct.toFixed(0)}%)</span>
                                    {dropoff && parseInt(dropoff) > 0 && (
                                        <span className="text-red-400 text-[10px]">-{dropoff}%</span>
                                    )}
                                </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2.5">
                                <div
                                    className={`${stage.color} h-2.5 rounded-full transition-all duration-500`}
                                    style={{ width: `${Math.max(pct, 1)}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Overall conversion rate */}
            <div className="mt-4 pt-3 border-t flex items-center justify-between">
                <span className="text-xs text-gray-500">Overall Conversion Rate</span>
                <span className="text-sm font-bold text-green-600">
                    {maxCount > 0 ? ((funnel.converted / maxCount) * 100).toFixed(1) : "0.0"}%
                </span>
            </div>
        </div>
    );
}
