"use client";

import { Target, MessageSquare, Mail, Phone, CalendarClock, Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const CHANNEL_META: Record<string, { icon: typeof MessageSquare; label: string; classes: string }> = {
    sms: { icon: MessageSquare, label: "SMS", classes: "bg-blue-50 text-blue-700 border-blue-200" },
    voice: { icon: Phone, label: "Voice", classes: "bg-violet-50 text-violet-700 border-violet-200" },
    email: { icon: Mail, label: "Email", classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
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
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
            <div className="flex items-start gap-2">
                <div className="p-1.5 bg-emerald-100 rounded-lg shrink-0">
                    <Target className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        AI Strategy
                    </h4>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{goalText}</p>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                {channels.map((ch) => {
                    const meta = CHANNEL_META[ch];
                    if (!meta) return null;
                    const Icon = meta.icon;
                    return (
                        <Badge key={ch} variant="outline" className={`gap-1 ${meta.classes}`}>
                            <Icon className="w-3 h-3" />
                            {meta.label}
                        </Badge>
                    );
                })}
            </div>

            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                {maxSteps != null && (
                    <span className="flex items-center gap-1">
                        <Flag className="w-3.5 h-3.5 text-gray-400" />
                        Up to <span className="font-semibold text-gray-700">{maxSteps}</span> touchpoints
                    </span>
                )}
                {cadence != null && duration != null && (
                    <span className="flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5 text-gray-400" />
                        <span className="font-semibold text-gray-700">{cadence}/week</span> for{" "}
                        <span className="font-semibold text-gray-700">
                            {duration} week{duration !== 1 ? "s" : ""}
                        </span>
                    </span>
                )}
            </div>

            {successConditions.length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400 mb-1">Stops when</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {successConditions.map((c) => (
                            <span
                                key={c}
                                className="text-[11px] px-1.5 py-0.5 rounded bg-green-50 text-green-700"
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
