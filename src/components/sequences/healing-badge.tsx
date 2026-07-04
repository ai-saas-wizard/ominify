"use client";

import { useState } from "react";
import {
    HeartPulse,
    ArrowRightLeft,
    RefreshCw,
    SkipForward,
    MessageSquare,
    Timer,
    XCircle,
    AlertTriangle,
    Shield,
    ChevronDown,
    ChevronUp,
} from "lucide-react";

// Neutral by default; only terminal/error outcomes carry color (red=ended,
// amber=invalid). The action icon + label do the differentiating.
const HEALING_ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
    switch_channel: { icon: ArrowRightLeft, color: "text-gray-600 bg-gray-100", label: "Switched Channel" },
    override_channel: { icon: ArrowRightLeft, color: "text-gray-600 bg-gray-100", label: "Channel Override" },
    retry_alternative: { icon: RefreshCw, color: "text-gray-600 bg-gray-100", label: "Retry Alternative" },
    skip_and_advance: { icon: SkipForward, color: "text-gray-600 bg-gray-100", label: "Skipped" },
    inject_fallback_sms: { icon: MessageSquare, color: "text-gray-600 bg-gray-100", label: "Fallback SMS" },
    extend_delay: { icon: Timer, color: "text-gray-600 bg-gray-100", label: "Extended Delay" },
    end_sequence: { icon: XCircle, color: "text-red-700 bg-red-50", label: "Ended" },
    mark_invalid: { icon: AlertTriangle, color: "text-amber-700 bg-amber-50", label: "Marked Invalid" },
    use_alternative_contact: { icon: Shield, color: "text-gray-600 bg-gray-100", label: "Alt Contact" },
};

const FAILURE_TYPE_LABELS: Record<string, string> = {
    sms_undelivered: "SMS Undelivered",
    sms_failed: "SMS Failed",
    email_bounced: "Email Bounced",
    email_spam: "Email Spam",
    call_no_answer: "No Answer",
    call_busy: "Line Busy",
    call_failed: "Call Failed",
    capacity_exhausted: "Capacity Full",
    invalid_number: "Invalid Number",
    landline_detected: "Landline",
    invalid_email: "Invalid Email",
    no_contact_method: "No Contact Method",
};

/**
 * Inline badge showing a healing action was taken.
 * Expands to show failure details and healing reason.
 */
export function HealingBadge({
    failureType,
    healingAction,
    healingDetails,
    failureDetails,
}: {
    failureType: string;
    healingAction: string;
    healingDetails?: any;
    failureDetails?: any;
}) {
    const [expanded, setExpanded] = useState(false);
    const config = HEALING_ACTION_CONFIG[healingAction] || HEALING_ACTION_CONFIG.skip_and_advance;
    const Icon = config.icon;

    return (
        <div className="inline-block">
            <button
                onClick={() => setExpanded(!expanded)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
                <HeartPulse className="h-3 w-3 text-gray-400" />
                Healed
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {expanded && (
                <div className="mt-2 max-w-sm space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                        <span className="font-medium text-amber-800">
                            {FAILURE_TYPE_LABELS[failureType] || failureType}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                        <span className="text-gray-700">
                            {healingDetails?.reason || config.label}
                        </span>
                    </div>

                    {healingDetails?.new_channel && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                            <ArrowRightLeft className="h-3 w-3" />
                            Switched to: <span className="font-medium">{healingDetails.new_channel.toUpperCase()}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Compact healing history panel for enrollment details.
 */
export function HealingHistoryPanel({
    healingActions,
}: {
    healingActions: any[];
}) {
    if (!healingActions || healingActions.length === 0) return null;

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <HeartPulse className="w-4 h-4 text-amber-500" />
                <h4 className="text-sm font-medium text-gray-700">
                    Self-Healing History ({healingActions.length})
                </h4>
            </div>
            <div className="space-y-1.5">
                {healingActions.map((action: any, index: number) => {
                    const config = HEALING_ACTION_CONFIG[action.type] || HEALING_ACTION_CONFIG.skip_and_advance;
                    const Icon = config.icon;
                    return (
                        <div
                            key={index}
                            className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                        >
                            <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${config.color}`}>
                                        {config.label}
                                    </span>
                                    <span className="text-xs tabular-nums text-gray-400">
                                        Step {action.step_order || "?"}
                                    </span>
                                </div>
                                <p className="mt-0.5 text-gray-600">{action.reason}</p>
                                {action.timestamp && (
                                    <p className="mt-0.5 font-mono text-xs text-gray-400">
                                        {new Date(action.timestamp).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Channel override indicator shown on enrollment cards.
 */
export function ChannelOverrideIndicator({
    overrides,
}: {
    overrides: Record<string, string>;
}) {
    if (!overrides || Object.keys(overrides).length === 0) return null;

    return (
        <div className="flex items-center gap-1 flex-wrap">
            {Object.entries(overrides).map(([from, to]) => (
                <span
                    key={from}
                    className="inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                    title={`${from.toUpperCase()} steps are being sent as ${(to as string).toUpperCase()} for this enrollment`}
                >
                    <ArrowRightLeft className="h-2.5 w-2.5" />
                    {from.toUpperCase()} → {(to as string).toUpperCase()}
                </span>
            ))}
        </div>
    );
}
