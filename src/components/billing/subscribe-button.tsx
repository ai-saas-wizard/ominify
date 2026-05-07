"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * Subscribe button — posts to /api/stripe/subscribe and redirects to
 * Stripe-hosted Checkout. Gated behind a TCPA/DNC consent checkbox.
 *
 * Price comes from the parent (resolved from the client's pricing tier).
 * `multiPhase` shifts the CTA copy to communicate that the price will rise
 * after the intro period.
 */
export function SubscribeButton({
    clientId,
    priceUsd,
    multiPhase,
    ctaLabel,
}: {
    clientId: string;
    priceUsd: number;
    multiPhase?: boolean;
    ctaLabel?: string;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accepted, setAccepted] = useState(false);

    async function handleClick() {
        if (!accepted) {
            setError("Please accept the compliance terms to continue.");
            return;
        }
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
        <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/50 cursor-pointer hover:border-gray-300 transition-colors">
                <button
                    type="button"
                    onClick={() => setAccepted((v) => !v)}
                    className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        accepted
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-gray-300 bg-white"
                    }`}
                    aria-pressed={accepted}
                    aria-label="Accept compliance terms"
                >
                    {accepted && <Check className="w-3 h-3 text-white" />}
                </button>
                <span
                    className="text-xs text-gray-600 leading-relaxed select-none"
                    onClick={() => setAccepted((v) => !v)}
                >
                    I confirm that I have obtained prior express written consent
                    from every contact my AI agents will call or message, and
                    that I am solely responsible for compliance with the TCPA,
                    state and federal Do-Not-Call (DNC) registries, and all
                    other applicable communications laws. Omnify is a software
                    platform and assumes no liability for outreach I conduct
                    using the service. I agree to the{" "}
                    <a
                        href="/legal/terms"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline"
                    >
                        Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                        href="/legal/privacy"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline"
                    >
                        Privacy Policy
                    </a>
                    .
                </span>
            </label>

            <button
                type="button"
                onClick={handleClick}
                disabled={loading || !accepted}
                className="w-full px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {loading
                    ? "Redirecting to Stripe…"
                    : ctaLabel ??
                      (multiPhase
                          ? `Start with $${priceUsd}/month`
                          : `Subscribe — $${priceUsd}/month`)}
            </button>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        </div>
    );
}
