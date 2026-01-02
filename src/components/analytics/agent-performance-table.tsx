"use client";

import { Bot, TrendingUp, TrendingDown } from "lucide-react";

interface AgentStats {
    id: string;
    name: string;
    totalCalls: number;
    avgDuration: number;
    successRate: number;
    totalCost: number;
}

export function AgentPerformanceTable({ data }: { data: AgentStats[] }) {
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (data.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance</h3>
                <div className="text-center py-8 text-gray-500">
                    <Bot className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p>No agent data available</p>
                </div>
            </div>
        );
    }

    // Sort by total calls
    const sortedData = [...data].sort((a, b) => b.totalCalls - a.totalCalls);
    const avgSuccessRate = data.reduce((sum, d) => sum + d.successRate, 0) / data.length;

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900">Agent Performance</h3>
                <p className="text-sm text-gray-500">Comparison of your AI agents</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-3 text-left font-medium">Agent</th>
                            <th className="px-6 py-3 text-right font-medium">Calls</th>
                            <th className="px-6 py-3 text-right font-medium">Avg Duration</th>
                            <th className="px-6 py-3 text-right font-medium">Success Rate</th>
                            <th className="px-6 py-3 text-right font-medium">Total Cost</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedData.map((agent) => (
                            <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                                            <Bot className="w-4 h-4 text-indigo-600" />
                                        </div>
                                        <span className="font-medium text-gray-900">{agent.name}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right font-medium text-gray-900">
                                    {agent.totalCalls}
                                </td>
                                <td className="px-6 py-4 text-right text-gray-600">
                                    {formatDuration(agent.avgDuration)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                        {agent.successRate >= avgSuccessRate ? (
                                            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                                        ) : (
                                            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                                        )}
                                        <span className={`font-medium ${agent.successRate >= 80 ? 'text-emerald-600' :
                                                agent.successRate >= 60 ? 'text-amber-600' :
                                                    'text-red-600'
                                            }`}>
                                            {agent.successRate}%
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right text-gray-600">
                                    ${agent.totalCost.toFixed(2)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
