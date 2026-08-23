"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight, Loader2 } from "lucide-react";

/**
 * Subscribe button, posts to /api/stripe/subscribe and redirects to
 * Stripe-hosted Checkout. Gated behind a TCPA/DNC consent checkbox.
 *
 * Dark-themed variant for the in-app subscribe page; matches the offer
 * landing aesthetic. `multiPhase` shifts the CTA copy to communicate that
 * the price will rise after the intro period.
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
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Something went wrong");
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/[0.07] hover:border-white/20 transition-colors">
                <button
                    type="button"
                    onClick={() => setAccepted((v) => !v)}
                    className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        accepted
                            ? "border-emerald-400 bg-emerald-400 shadow-sm shadow-emerald-400/40"
                            : "border-white/30 bg-transparent"
                    }`}
                    aria-pressed={accepted}
                    aria-label="Accept compliance terms"
                >
                    {accepted && <Check className="w-3 h-3 text-emerald-950" strokeWidth={3} />}
                </button>
                <span
                    className="text-xs text-white/60 leading-relaxed select-none"
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
                        className="text-emerald-300 hover:text-emerald-200 underline-offset-2 underline"
                    >
                        Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                        href="/legal/privacy"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:text-emerald-200 underline-offset-2 underline"
                    >
                        Privacy Policy
                    </a>
                    .
                </span>
            </label>

            <motion.button
                type="button"
                onClick={handleClick}
                disabled={loading || !accepted}
                whileHover={accepted && !loading ? { scale: 1.015 } : undefined}
                whileTap={accepted && !loading ? { scale: 0.97 } : undefined}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                className="group w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-400 text-emerald-950 font-semibold rounded-xl shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
                {loading ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Redirecting to Stripe…
                    </>
                ) : (
                    <>
                        {ctaLabel ??
                            (multiPhase
                                ? `Start with $${priceUsd}/month`
                                : `Subscribe · $${priceUsd}/month`)}
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                )}
            </motion.button>
            {error && (
                <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-rose-300 text-center"
                >
                    {error}
                </motion.p>
            )}
        </div>
    );
}
