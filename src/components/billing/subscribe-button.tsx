"use client";

import { useState } from "react";

/**
 * Subscribe button — posts to /api/stripe/subscribe and redirects to
 * Stripe-hosted Checkout.
 */
export function SubscribeButton({ clientId }: { clientId: string }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleClick() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/stripe/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            const data = await res.json();
            if (!res.ok || !data.url) {
                throw new Error(data.error || "Failed to start checkout");
            }
            window.location.href = data.url as string;
        } catch (e: any) {
            setError(e?.message || "Something went wrong");
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={handleClick}
                disabled={loading}
                className="w-full px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {loading ? "Redirecting to Stripe…" : "Subscribe — $479/month"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
    );
}
