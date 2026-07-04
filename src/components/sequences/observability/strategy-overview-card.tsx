"use client";

import { Target, MessageSquare, Mail, Phone, CalendarClock, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { seqCardStatic } from "@/components/sequences/theme";

const CHANNEL_META: Record<string, { icon: typeof MessageSquare; label: string }> = {
    sms: { icon: MessageSquare, label: "SMS" },
    voice: { icon: Phone, label: "Voice" },
    email: { icon: Mail, label: "Email" },
};

const GOAL_LABELS: Record<string, string> = {
    missed_call_followup: "Follow up on missed calls",
    dormant_reengagement: "Re-engage dormant leads",
    new_lead_nurture: "Nurture new leads",
    post_appointment: "Post-appointment follow-up",
    win_back_quotes: "Win back open quotes",
    meta_ads_lead: "Convert Meta Ads leads",
    google_ads_lead: "Convert Google Ads leads",
    custom: "Custom goal",
};

/**
 * The "what will the AI do" answer for a dynamic sequence: renders the
 * strategy the wizard wrote (goal, channels, cadence × duration, max steps)
 * plus the handoff rules. There is deliberately no step graph — the AI decides
 * each lead's next touch at runtime, so any shared graph would be fiction.
 */
export function StrategyOverviewCard({ sequence }: { sequence: any }) {
    const strategy = sequence.sequence_strategy || {};
    const handoff = sequence.handoff_rules || {};

    const goalText =
        strategy.custom_goal_description ||
        GOAL_LABELS[strategy.goal] ||
        strategy.goal ||
        sequence.description ||
        "Follow up with leads";

    const channels: string[] = strategy.available_channels || [];
    const cadence = strategy.cadence_per_week;
    const duration = strategy.duration_weeks;
    const maxSteps = strategy.max_steps;
    const successConditions: string[] = handoff.success_conditions || [];

    return (
        <div className={cn(seqCardStatic, "space-y-3 p-4")}>
            <div className="flex items-start gap-2">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        AI Strategy
                    </h4>
                    <p className="mt-0.5 text-sm font-medium text-gray-900">{goalText}</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {channels.map((ch) => {
                    const meta = CHANNEL_META[ch];
                    if (!meta) return null;
                    const Icon = meta.icon;
                    return (
                        <span
                            key={ch}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600"
                        >
                            <Icon className="h-3 w-3 text-gray-400" />
                            {meta.label}
                        </span>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                {maxSteps != null && (
                    <span className="flex items-center gap-1">
                        <Flag className="h-3.5 w-3.5 text-gray-400" />
                        Up to{" "}
                        <span className="font-semibold tabular-nums text-gray-700">{maxSteps}</span>{" "}
                        touchpoints
                    </span>
                )}
                {cadence != null && duration != null && (
                    <span className="flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-semibold tabular-nums text-gray-700">
                            {cadence}/week
                        </span>{" "}
                        for{" "}
                        <span className="font-semibold tabular-nums text-gray-700">
                            {duration} week{duration !== 1 ? "s" : ""}
                        </span>
                    </span>
                )}
            </div>

            {successConditions.length > 0 && (
                <div className="border-t border-gray-100 pt-2">
                    <p className="mb-1 text-xs text-gray-400">Stops when</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {successConditions.map((c) => (
                            <span
                                key={c}
                                className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                            >
                                {c.replace(/_/g, " ")}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
