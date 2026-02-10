"use client";

import { useEffect, useState } from "react";
import { Globe, TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { getIndustryBenchmarks, getSequenceLearningAnalytics } from "@/app/actions/sequence-actions";

interface IndustryBenchmarksProps {
    sequenceId: string;
    clientId: string;
}

interface BenchmarkData {
    avg_conversion_rate: number;
    avg_reply_rate: number;
    avg_opt_out_rate: number;
    avg_time_to_conversion_hours: number;
    avg_steps_to_conversion: number;
    avg_cost_per_conversion: number;
    sample_size: number;
    tenant_count: number;
}

interface SequenceMetrics {
    conversion_rate: number;
    reply_rate: number;
    opt_out_rate: number;
    avg_time_to_conversion_hours: number;
    avg_steps_to_conversion: number;
    cost_per_conversion: number;
}

export function IndustryBenchmarks({ sequenceId, clientId }: IndustryBenchmarksProps) {
    const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
    const [metrics, setMetrics] = useState<SequenceMetrics | null>(null);
    const [industry, setIndustry] = useState<string>("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const [benchResult, analyticsResult] = await Promise.all([
                getIndustryBenchmarks(clientId),
                getSequenceLearningAnalytics(sequenceId),
            ]);

            if (benchResult.success && benchResult.data) {
                setBenchmark(benchResult.data);
                setIndustry(benchResult.industry || "");
            }

            if (analyticsResult.success && analyticsResult.data) {
                setMetrics({
                    conversion_rate: parseFloat(analyticsResult.data.conversion_rate),
                    reply_rate: parseFloat(analyticsResult.data.reply_rate),
                    opt_out_rate: parseFloat(analyticsResult.data.opt_out_rate),
                    avg_time_to_conversion_hours: parseFloat(analyticsResult.data.avg_time_to_conversion_hours),
                    avg_steps_to_conversion: parseFloat(analyticsResult.data.avg_steps_to_conversion),
                    cost_per_conversion: parseFloat(analyticsResult.data.cost_per_conversion),
                });
            }

            setLoading(false);
        }
        load();
    }, [sequenceId, clientId]);

    if (loading) {
        return (
            <div className="bg-white rounded-xl border p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-44 mb-4" />
                <div className="grid grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-16 bg-gray-100 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    if (!benchmark) {
        return (
            <div className="bg-white rounded-xl border p-6">
                <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900">Industry Benchmarks</h3>
                </div>
                <p className="text-sm text-gray-500">
                    Benchmarks are not yet available. They are computed weekly when enough cross-tenant data exists.
                </p>
            </div>
        );
    }

    const comparisons = [
        {
            label: "Conversion Rate",
            yours: metrics?.conversion_rate || 0,
            industry: parseFloat(String(benchmark.avg_conversion_rate)),
            format: (v: number) => `${(v * 100).toFixed(1)}%`,
            higherIsBetter: true,
        },
        {
            label: "Reply Rate",
            yours: metrics?.reply_rate || 0,
            industry: parseFloat(String(benchmark.avg_reply_rate)),
            format: (v: number) => `${(v * 100).toFixed(1)}%`,
            higherIsBetter: true,
        },
        {
            label: "Opt-Out Rate",
            yours: metrics?.opt_out_rate || 0,
            industry: parseFloat(String(benchmark.avg_opt_out_rate)),
            format: (v: number) => `${(v * 100).toFixed(1)}%`,
            higherIsBetter: false,
        },
        {
            label: "Time to Conversion",
            yours: metrics?.avg_time_to_conversion_hours || 0,
            industry: parseFloat(String(benchmark.avg_time_to_conversion_hours)),
            format: (v: number) => `${v.toFixed(1)}h`,
            higherIsBetter: false,
        },
        {
            label: "Steps to Conversion",
            yours: metrics?.avg_steps_to_conversion || 0,
            industry: parseFloat(String(benchmark.avg_steps_to_conversion)),
            format: (v: number) => v.toFixed(1),
            higherIsBetter: false,
        },
        {
            label: "Cost per Conversion",
            yours: metrics?.cost_per_conversion || 0,
            industry: parseFloat(String(benchmark.avg_cost_per_conversion)),
            format: (v: number) => `$${v.toFixed(2)}`,
            higherIsBetter: false,
        },
    ];

    return (
        <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-semibold text-gray-900">Industry Benchmarks</h3>
                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-blue-50 text-blue-600 rounded">
                        {industry}
                    </span>
                </div>
                <span className="text-[10px] text-gray-400">
                    {benchmark.sample_size} sequences from {benchmark.tenant_count} businesses
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {comparisons.map((c) => {
                    const delta = c.industry > 0 ? ((c.yours - c.industry) / c.industry) * 100 : 0;
                    const isBetter = c.higherIsBetter ? delta > 5 : delta < -5;
                    const isWorse = c.higherIsBetter ? delta < -5 : delta > 5;
                    const isNeutral = !isBetter && !isWorse;

                    return (
                        <div key={c.label} className="p-2.5 rounded-lg border border-gray-100">
                            <div className="text-[10px] text-gray-500 mb-1">{c.label}</div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-semibold text-gray-900">
                                        {metrics ? c.format(c.yours) : "N/A"}
                                    </div>
                                    <div className="text-[10px] text-gray-400">
                                        vs {c.format(c.industry)} avg
                                    </div>
                                </div>
                                {metrics && (
                                    <div className={`flex items-center gap-0.5 text-[10px] font-medium ${
                                        isBetter ? "text-green-600" :
                                        isWorse ? "text-red-500" :
                                        "text-gray-400"
                                    }`}>
                                        {isBetter ? <TrendingUp className="w-3 h-3" /> :
                                         isWorse ? <TrendingDown className="w-3 h-3" /> :
                                         <Minus className="w-3 h-3" />}
                                        {Math.abs(delta).toFixed(0)}%
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
