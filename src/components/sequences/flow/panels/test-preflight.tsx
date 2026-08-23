"use client";

import Link from "next/link";
import { AlertTriangle, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { TestPreflight, PreflightIssue } from "@/lib/sequences/test-run-types";

const CHANNEL_LABEL: Record<string, string> = {
    sms: "SMS",
    voice: "Voice",
    email: "Email",
};

function IssueRow({ issue, tone }: { issue: PreflightIssue; tone: "red" | "amber" }) {
    const Icon = tone === "red" ? AlertCircle : AlertTriangle;
    return (
        <div className="flex items-start gap-2">
            <Icon
                className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                    tone === "red" ? "text-red-500" : "text-amber-500"
                }`}
            />
            <div className="min-w-0 space-y-0.5">
                <p className="font-medium">{issue.title}</p>
                <p className={tone === "red" ? "text-red-700" : "text-amber-700"}>
                    {issue.detail}
                </p>
                {issue.fixHref && (
                    <Link
                        href={issue.fixHref}
                        className="inline-block font-medium underline underline-offset-2"
                    >
                        {issue.fixLabel || "Fix this"}
                    </Link>
                )}
            </div>
        </div>
    );
}

export function TestPreflightPanel({
    preflight,
    loading,
    /** Manual-mode rows have no email, email steps would be skipped. */
    missingEmailWarning,
}: {
    preflight: TestPreflight | null;
    loading: boolean;
    missingEmailWarning?: boolean;
}) {
    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking what this sequence can send…
            </div>
        );
    }

    if (!preflight) return null;

    const { blockers, warnings, channels, readiness } = preflight;
    const showEmailWarning = missingEmailWarning && channels.includes("email");
    const hasAnything = blockers.length > 0 || warnings.length > 0 || showEmailWarning;

    if (!hasAnything) {
        // Happy path stays quiet, one line, no shouting.
        const ready = channels.filter((c) => readiness[c].ready).map((c) => CHANNEL_LABEL[c]);
        return (
            <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-xs text-gray-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                {ready.length > 0
                    ? `${ready.join(", ")} ready · ${preflight.stepCount} step${preflight.stepCount === 1 ? "" : "s"}`
                    : `${preflight.stepCount} step${preflight.stepCount === 1 ? "" : "s"}`}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {blockers.length > 0 && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
                    {blockers.map((b, i) => (
                        <IssueRow key={`b-${i}`} issue={b} tone="red" />
                    ))}
                </div>
            )}
            {(warnings.length > 0 || showEmailWarning) && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    {warnings.map((w, i) => (
                        <IssueRow key={`w-${i}`} issue={w} tone="amber" />
                    ))}
                    {showEmailWarning && (
                        <IssueRow
                            tone="amber"
                            issue={{
                                kind: "email",
                                title: "No email address",
                                detail:
                                    "This sequence has email steps. Without an email they'll be skipped silently.",
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
