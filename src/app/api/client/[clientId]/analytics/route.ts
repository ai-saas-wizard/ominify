import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { listCalls, listAgents } from "@/lib/vapi";

// Based on actual Vapi API response structure
interface VapiCallResponse {
    id: string;
    orgId: string;
    type: string;
    status: string;
    endedReason?: string;
    startedAt?: string;
    endedAt?: string;
    transcript?: string;
    assistantId?: string;
    assistant?: {
        id: string;
        name: string;
    };
    costs?: Array<{
        type: string;
        cost: number;
        minutes?: number;
    }>;
    analysis?: {
        summary?: string;
        structuredData?: any;
    };
    customer?: {
        number?: string;
    };
}

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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        // Get client's Vapi key
        const { data: client } = await supabase
            .from('clients')
            .select('vapi_key')
            .eq('id', clientId)
            .single();

        const vapiKey = client?.vapi_key || process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;

        // Fetch calls from Vapi
        const rawCalls = await listCalls(vapiKey);
        const calls = rawCalls as unknown as VapiCallResponse[];

        const agents = await listAgents(vapiKey);

        // Get balance from database
        const { data: balance } = await supabase
            .from('minute_balances')
            .select('balance_minutes, total_used_minutes')
            .eq('client_id', clientId)
            .single();

        // Calculate date ranges
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const thirtyDaysAgo = new Date(todayStart);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Overview calculations
        const totalCalls = calls.length;
        const totalCallsToday = calls.filter(c => c.startedAt && new Date(c.startedAt) >= todayStart).length;
        const totalCallsWeek = calls.filter(c => c.startedAt && new Date(c.startedAt) >= weekStart).length;

        // Calculate duration from startedAt/endedAt
        let totalSeconds = 0;
        calls.forEach(c => {
            if (c.startedAt && c.endedAt) {
                const duration = (new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000;
                if (duration > 0) totalSeconds += duration;
            }
        });

        const totalMinutes = Math.round(totalSeconds / 60);
        const avgDuration = totalCalls > 0 ? Math.round(totalSeconds / totalCalls) : 0;

        // Success rate based on endedReason
        const successfulReasons = ['assistant-ended-call', 'customer-ended-call'];
        const completedCalls = calls.filter(c =>
            successfulReasons.includes(c.endedReason || '') ||
            c.status === 'ended'
        ).length;
        const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

        // Calls by day (last 30 days)
        const callsByDayMap = new Map<string, { calls: number; minutes: number }>();
        for (let i = 0; i < 30; i++) {
            const date = new Date(thirtyDaysAgo);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            callsByDayMap.set(dateStr, { calls: 0, minutes: 0 });
        }

        calls.forEach(call => {
            if (!call.startedAt) return;
            const dateStr = new Date(call.startedAt).toISOString().split('T')[0];
            if (callsByDayMap.has(dateStr)) {
                const entry = callsByDayMap.get(dateStr)!;
                entry.calls++;
                if (call.startedAt && call.endedAt) {
                    const mins = (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 60000;
                    if (mins > 0) entry.minutes += mins;
                }
            }
        });

        const callsByDay = Array.from(callsByDayMap.entries()).map(([date, data]) => ({
            date,
            calls: data.calls,
            minutes: Math.round(data.minutes)
        }));

        // Call outcomes from endedReason
        const outcomeMap = new Map<string, number>();
        calls.forEach(call => {
            const reason = call.endedReason || call.status || 'unknown';
            outcomeMap.set(reason, (outcomeMap.get(reason) || 0) + 1);
        });

        const outcomeColors: Record<string, string> = {
            'assistant-ended-call': '#10b981',
            'customer-ended-call': '#3b82f6',
            'customer-did-not-answer': '#f59e0b',
            'voicemail': '#f59e0b',
            'assistant-error': '#ef4444',
            'pipeline-error-openai-llm-failed': '#ef4444',
            'phone-call-provider-closed-websocket': '#6b7280',
            'ended': '#3b82f6',
            'in-progress': '#8b5cf6',
            'unknown': '#9ca3af'
        };

        const callOutcomes = Array.from(outcomeMap.entries())
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({
                name: formatOutcomeName(name),
                value,
                color: outcomeColors[name] || '#6b7280'
            }));

        // Agent performance - use assistantId from calls
        const agentStatsMap = new Map<string, {
            name: string;
            calls: number;
            totalSeconds: number;
            successfulCalls: number;
            totalCost: number;
        }>();

        // Initialize with known agents
        agents.forEach(agent => {
            agentStatsMap.set(agent.id, {
                name: agent.name,
                calls: 0,
                totalSeconds: 0,
                successfulCalls: 0,
                totalCost: 0
            });
        });

        calls.forEach(call => {
            const agentId = call.assistantId || call.assistant?.id;
            if (!agentId) return;

            if (!agentStatsMap.has(agentId)) {
                agentStatsMap.set(agentId, {
                    name: call.assistant?.name || 'Unknown Agent',
                    calls: 0,
                    totalSeconds: 0,
                    successfulCalls: 0,
                    totalCost: 0
                });
            }

            const stats = agentStatsMap.get(agentId)!;
            stats.calls++;

            if (call.startedAt && call.endedAt) {
                const duration = (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000;
                if (duration > 0) stats.totalSeconds += duration;
            }

            if (successfulReasons.includes(call.endedReason || '')) {
                stats.successfulCalls++;
            }

            // Sum costs from costs array
            if (call.costs && Array.isArray(call.costs)) {
                call.costs.forEach(costItem => {
                    if (costItem.cost) stats.totalCost += costItem.cost;
                });
            }
        });

        const agentPerformance = Array.from(agentStatsMap.entries())
            .filter(([_, stats]) => stats.calls > 0)
            .map(([id, stats]) => ({
                id,
                name: stats.name,
                totalCalls: stats.calls,
                avgDuration: stats.calls > 0 ? Math.round(stats.totalSeconds / stats.calls) : 0,
                successRate: stats.calls > 0 ? Math.round((stats.successfulCalls / stats.calls) * 100) : 0,
                totalCost: Math.round(stats.totalCost * 100) / 100
            }));

        // Peak hours heatmap (7 days x 24 hours)
        const peakHours: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
        calls.forEach(call => {
            if (!call.startedAt) return;
            const date = new Date(call.startedAt);
            const dayOfWeek = date.getDay();
            const hour = date.getHours();
            peakHours[dayOfWeek][hour]++;
        });

        const response: AnalyticsData = {
            overview: {
                totalCalls,
                totalCallsToday,
                totalCallsWeek,
                totalMinutes,
                avgDuration,
                successRate,
                currentBalance: balance?.balance_minutes || 0
            },
            callsByDay,
            callOutcomes,
            agentPerformance,
            peakHours
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Analytics error:', error);
        return NextResponse.json({ error: 'Failed to fetch analytics', details: String(error) }, { status: 500 });
    }
}

function formatOutcomeName(name: string): string {
    const mapping: Record<string, string> = {
        'assistant-ended-call': 'Completed',
        'customer-ended-call': 'Customer Hangup',
        'customer-did-not-answer': 'No Answer',
        'voicemail': 'Voicemail',
        'assistant-error': 'Error',
        'pipeline-error-openai-llm-failed': 'AI Error',
        'phone-call-provider-closed-websocket': 'Connection Lost',
        'ended': 'Ended',
        'in-progress': 'In Progress',
        'unknown': 'Unknown'
    };
    return mapping[name] || name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
