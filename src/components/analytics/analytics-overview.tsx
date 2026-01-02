"use client";

import { Phone, Clock, TrendingUp, Wallet, CheckCircle } from "lucide-react";

interface OverviewData {
    totalCalls: number;
    totalCallsToday: number;
    totalCallsWeek: number;
    totalMinutes: number;
    avgDuration: number;
    successRate: number;
    currentBalance: number;
}

export function AnalyticsOverview({ data }: { data: OverviewData }) {
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const cards = [
        {
            title: "Total Calls",
            value: data.totalCalls.toLocaleString(),
            subtext: `${data.totalCallsToday} today · ${data.totalCallsWeek} this week`,
            icon: Phone,
            color: "bg-blue-500",
            bgColor: "bg-blue-50"
        },
        {
            title: "Total Minutes",
            value: data.totalMinutes.toLocaleString(),
            subtext: "minutes used",
            icon: Clock,
            color: "bg-violet-500",
            bgColor: "bg-violet-50"
        },
        {
            title: "Avg Duration",
            value: formatDuration(data.avgDuration),
            subtext: "per call",
            icon: TrendingUp,
            color: "bg-cyan-500",
            bgColor: "bg-cyan-50"
        },
        {
            title: "Success Rate",
            value: `${data.successRate}%`,
            subtext: "completed calls",
            icon: CheckCircle,
            color: "bg-emerald-500",
            bgColor: "bg-emerald-50"
        },
        {
            title: "Balance",
            value: `${data.currentBalance.toFixed(0)} min`,
            subtext: "remaining",
            icon: Wallet,
            color: data.currentBalance < 10 ? "bg-red-500" : "bg-amber-500",
            bgColor: data.currentBalance < 10 ? "bg-red-50" : "bg-amber-50"
        }
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {cards.map((card, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between mb-3">
                        <div className={`p-2 rounded-lg ${card.bgColor}`}>
                            <card.icon className={`w-4 h-4 ${card.color.replace('bg-', 'text-')}`} />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{card.title}</p>
                    <p className="text-xs text-gray-400">{card.subtext}</p>
                </div>
            ))}
        </div>
    );
}
