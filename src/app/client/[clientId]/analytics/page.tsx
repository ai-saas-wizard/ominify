"use client";

import { useEffect, useState } from "react";
import { AnalyticsOverview } from "@/components/analytics/analytics-overview";
import { CallVolumeChart } from "@/components/analytics/call-volume-chart";
import { CallOutcomesChart } from "@/components/analytics/call-outcomes-chart";
import { AgentPerformanceTable } from "@/components/analytics/agent-performance-table";
import { PeakHoursHeatmap } from "@/components/analytics/peak-hours-heatmap";
import { RefreshCw, BarChart3 } from "lucide-react";

interface AnalyticsData {
    overview: {
        totalCalls: number;
        totalCallsToday: number;
        totalCallsWeek: number;
        totalMinutes: number;
        avgDuration: number;
        successRate: number;
        currentBalance: number;
    };
    callsByDay: Array<{
        date: string;
        calls: number;
        minutes: number;
    }>;
    callOutcomes: Array<{
        name: string;
        value: number;
        color: string;
    }>;
    agentPerformance: Array<{
        id: string;
        name: string;
        totalCalls: number;
        avgDuration: number;
        successRate: number;
        totalCost: number;
    }>;
    peakHours: number[][];
}

export default function AnalyticsPage({ params }: { params: Promise<{ clientId: string }> }) {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [clientId, setClientId] = useState<string>("");

    useEffect(() => {
        params.then(p => setClientId(p.clientId));
    }, [params]);

    const fetchAnalytics = async () => {
        if (!clientId) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/client/${clientId}/analytics`);
            if (!res.ok) throw new Error('Failed to fetch analytics');
            const data = await res.json();
            setData(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (clientId) {
            fetchAnalytics();
        }
    }, [clientId]);

    if (loading) {
        return (
            <div className="p-8">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 bg-gray-200 rounded w-48"></div>
                    <div className="grid grid-cols-5 gap-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-28 bg-gray-200 rounded-xl"></div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                        <div className="h-80 bg-gray-200 rounded-xl"></div>
                        <div className="h-80 bg-gray-200 rounded-xl"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-red-600 mb-4">{error}</p>
                    <button
                        onClick={fetchAnalytics}
                        className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <BarChart3 className="w-6 h-6 text-indigo-600" />
                        Analytics
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">
                        Track your AI agent performance and call metrics
                    </p>
                </div>
                <button
                    onClick={fetchAnalytics}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Overview Cards */}
            <AnalyticsOverview data={data.overview} />

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <CallVolumeChart data={data.callsByDay} />
                </div>
                <div>
                    <CallOutcomesChart data={data.callOutcomes} />
                </div>
            </div>

            {/* Agent Performance */}
            <AgentPerformanceTable data={data.agentPerformance} />

            {/* Peak Hours */}
            <PeakHoursHeatmap data={data.peakHours} />
        </div>
    );
}
