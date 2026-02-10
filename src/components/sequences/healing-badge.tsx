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

const HEALING_ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
    switch_channel: { icon: ArrowRightLeft, color: "text-blue-600 bg-blue-100", label: "Switched Channel" },
    override_channel: { icon: ArrowRightLeft, color: "text-indigo-600 bg-indigo-100", label: "Channel Override" },
    retry_alternative: { icon: RefreshCw, color: "text-amber-600 bg-amber-100", label: "Retry Alternative" },
    skip_and_advance: { icon: SkipForward, color: "text-gray-600 bg-gray-100", label: "Skipped" },
    inject_fallback_sms: { icon: MessageSquare, color: "text-green-600 bg-green-100", label: "Fallback SMS" },
    extend_delay: { icon: Timer, color: "text-yellow-600 bg-yellow-100", label: "Extended Delay" },
    end_sequence: { icon: XCircle, color: "text-red-600 bg-red-100", label: "Ended" },
    mark_invalid: { icon: AlertTriangle, color: "text-orange-600 bg-orange-100", label: "Marked Invalid" },
    use_alternative_contact: { icon: Shield, color: "text-teal-600 bg-teal-100", label: "Alt Contact" },
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
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.color} hover:opacity-80 transition-opacity`}
            >
                <HeartPulse className="w-3 h-3" />
                Healed
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {expanded && (
                <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs space-y-2 max-w-sm">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        <span className="font-medium text-amber-800">
                            {FAILURE_TYPE_LABELS[failureType] || failureType}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <Icon className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-700">
                            {healingDetails?.reason || config.label}
                        </span>
                    </div>

                    {healingDetails?.new_channel && (
                        <div className="flex items-center gap-1 text-[10px] text-gray-500">
                            <ArrowRightLeft className="w-3 h-3" />
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
                            className="flex items-start gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs"
                        >
                            <Icon className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${config.color}`}>
                                        {config.label}
                                    </span>
                                    <span className="text-[10px] text-gray-400">
                                        Step {action.step_order || "?"}
                                    </span>
                                </div>
                                <p className="text-gray-600 mt-0.5">{action.reason}</p>
                                {action.timestamp && (
                                    <p className="text-[10px] text-gray-400 mt-0.5">
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
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                    title={`${from.toUpperCase()} steps are being sent as ${(to as string).toUpperCase()} for this enrollment`}
                >
                    <ArrowRightLeft className="w-2.5 h-2.5" />
                    {from.toUpperCase()} → {(to as string).toUpperCase()}
                </span>
            ))}
        </div>
    );
}
