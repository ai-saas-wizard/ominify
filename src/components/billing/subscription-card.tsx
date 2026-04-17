"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";

interface Props {
    clientId: string;
    status: string | null; // null when no subscription
    planName: string;
    priceUsd: number;
    currentPeriodEnd: string | null;
    grandfathered: boolean;
    isCustom: boolean;
}

/**
 * Subscription status card on the billing page. Shows plan + renewal date and
 * a button to open the Stripe Customer Portal for self-service (cancel, update
 * card, view invoices).
 */
export function SubscriptionCard({
    clientId,
    status,
    planName,
    priceUsd,
    currentPeriodEnd,
    grandfathered,
    isCustom,
}: Props) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function openPortal() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/stripe/portal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || "Failed");
            window.location.href = data.url as string;
        } catch (e: any) {
            setError(e?.message || "Could not open portal");
            setLoading(false);
        }
    }

    async function subscribe() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/stripe/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || "Failed");
            window.location.href = data.url as string;
        } catch (e: any) {
            setError(e?.message || "Could not start checkout");
            setLoading(false);
        }
    }

    const isLive =
        status === "active" || status === "trialing" || status === "admin_granted";
    const pastDue = status === "past_due";

    const badge = (() => {
        if (grandfathered) {
            return { label: "Grandfathered", color: "bg-blue-100 text-blue-700" };
        }
        if (isCustom) {
            return { label: "Custom plan", color: "bg-purple-100 text-purple-700" };
        }
        if (isLive) return { label: "Active", color: "bg-green-100 text-green-700" };
        if (pastDue) return { label: "Past due", color: "bg-amber-100 text-amber-700" };
        if (status === "canceled")
            return { label: "Canceled", color: "bg-red-100 text-red-700" };
        return { label: "Not subscribed", color: "bg-gray-100 text-gray-700" };
    })();

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-gray-500">Plan</p>
                    <p className="text-xl font-bold text-gray-900">{planName}</p>
                    <p className="text-sm text-gray-500 mt-1">
                        ${priceUsd.toFixed(2)}/month
                    </p>
                </div>
                <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${badge.color}`}
                >
                    {badge.label}
                </span>
            </div>

            {currentPeriodEnd && (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>
                        Next renewal:{" "}
                        {new Date(currentPeriodEnd).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                        })}
                    </span>
                </div>
            )}

            <div className="mt-5">
                {isLive && !grandfathered && !isCustom && (
                    <button
                        type="button"
                        onClick={openPortal}
                        disabled={loading}
                        className="w-full px-4 py-2 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60"
                    >
                        {loading ? "Opening…" : "Manage subscription"}
                    </button>
                )}
                {(!status || status === "canceled" || pastDue) && !grandfathered && !isCustom && (
                    <button
                        type="button"
                        onClick={subscribe}
                        disabled={loading}
                        className="w-full px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                        {loading ? "Redirecting…" : pastDue ? "Update payment" : "Subscribe"}
                    </button>
                )}
                {(grandfathered || isCustom) && (
                    <p className="text-sm text-gray-500">
                        Managed outside of Stripe. Contact support to change.
                    </p>
                )}
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
        </div>
    );
}
