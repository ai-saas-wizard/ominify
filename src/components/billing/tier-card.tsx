"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Sparkles, ArrowRight, Heart } from "lucide-react";
import { getTierPhases, type PricingTier } from "@/lib/pricing-tiers-shared";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";
import { selectTierAction } from "@/app/offers/[slug]/actions";
import { selectClientTierAction } from "@/app/client/[clientId]/subscribe/_components/actions";

/**
 * One pricing tier rendered as a glass card.
 *
 * Two modes:
 * - `preview` (offer LP, pre-signup): card click sets a preferred-tier hint
 *   cookie and redirects to /sign-up. The actual selection happens later.
 * - `select`  (post-signup picker on /client/<id>/subscribe): card click
 *   commits `clients.pricing_tier_id` server-side and reloads the
 *   subscribe page into the single-tier Stripe Checkout view.
 *
 * In `select` mode, `clientId` is required and an optional `isPreferred`
 * flag adds a subtle "Pre-selected" tag to the card the customer leaned
 * toward on the marketing LP.
 */
export function TierCard({
    tier,
    index = 0,
    mode = "preview",
    clientId,
    isPreferred = false,
}: {
    tier: PricingTier;
    index?: number;
    mode?: "preview" | "select";
    clientId?: string;
    isPreferred?: boolean;
}) {
    const phases = getTierPhases(tier);
    const features = tier.landing_features.length > 0 ? tier.landing_features : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
                duration: 0.55,
                delay: 0.15 + index * 0.08,
                ease: [0.16, 1, 0.3, 1],
            }}
            className="relative group"
        >
            {/* Recommended glow (decorative, must not capture clicks). */}
            {tier.is_recommended && (
                <motion.div
                    aria-hidden
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.3, 0.55, 0.3] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-emerald-500/40 via-sky-500/30 to-blue-500/30 blur-xl"
                />
            )}

            {/* Hover halo (non-recommended cards), pointer-events-none so it
                never blocks the button below, even at opacity-0 it would
                otherwise be a giant invisible click-eater. */}
            {!tier.is_recommended && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 opacity-0 blur-xl transition-opacity duration-300 group-hover:from-emerald-500/20 group-hover:to-sky-500/20 group-hover:opacity-100"
                />
            )}

            {/* Inner card, the lift on hover happens HERE, not on the parent.
                Lifting the parent would change its hit area and cause
                hover-flicker when the cursor is near the bottom edge (where the
                CTA lives), making clicks drop intermittently. */}
            <div
                className={`relative h-full rounded-2xl border bg-white/5 p-6 backdrop-blur-xl flex flex-col transition-all duration-300 ease-out group-hover:-translate-y-1 ${
                    tier.is_recommended
                        ? "border-emerald-400/40 bg-white/[0.06]"
                        : isPreferred
                          ? "border-sky-400/40 bg-white/[0.06]"
                          : "border-white/10 group-hover:border-emerald-400/30"
                }`}
            >
                {/* Most-popular badge */}
                {tier.is_recommended && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                            duration: 0.5,
                            delay: 0.4 + index * 0.08,
                        }}
                        className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-400 text-emerald-950 text-[10px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-full shadow-lg shadow-emerald-500/30"
                    >
                        <Sparkles className="w-3 h-3" /> Most Popular
                    </motion.div>
                )}

                {/* Preferred-hint badge (post-signup picker only) */}
                {isPreferred && !tier.is_recommended && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 + index * 0.08 }}
                        className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-sky-400 text-sky-950 text-[10px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-full shadow-lg shadow-sky-500/30"
                    >
                        <Heart className="w-3 h-3" /> You picked this
                    </motion.div>
                )}

                {/* Header */}
                <div>
                    <h3 className="text-xl font-bold text-white tracking-tight">
                        {tier.display_name}
                    </h3>
                    <div className="mt-4">
                        <PhaseSummary phases={phases} theme="dark" />
                    </div>
                </div>

                {/* Features */}
                <ul className="mt-7 space-y-3 text-sm flex-1">
                    {features ? (
                        features.map((f, i) => (
                            <FeatureRow key={i} text={f} />
                        ))
                    ) : (
                        <>
                            <FeatureRow>
                                <PhaseMinutesSummary phases={phases} />
                            </FeatureRow>
                            <FeatureRow text="Cancel anytime" />
                        </>
                    )}
                </ul>

                {/* CTA, switches action + payload based on mode */}
                {mode === "select" && clientId ? (
                    <form action={selectClientTierAction} className="mt-8">
                        <input type="hidden" name="client_id" value={clientId} />
                        <input type="hidden" name="tier_id" value={tier.id} />
                        <TierCta tier={tier} mode="select" />
                    </form>
                ) : (
                    <form action={selectTierAction} className="mt-8">
                        <input type="hidden" name="tier_slug" value={tier.slug} />
                        <TierCta tier={tier} mode="preview" />
                    </form>
                )}
            </div>
        </motion.div>
    );
}

function TierCta({
    tier,
    mode,
}: {
    tier: PricingTier;
    mode: "preview" | "select";
}) {
    const label =
        tier.landing_cta_label ??
        (mode === "select"
            ? `Choose ${tier.display_name}`
            : `Choose ${tier.display_name}`);

    return (
        <motion.button
            type="submit"
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className={`group/btn w-full inline-flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-xl text-sm transition-all ${
                tier.is_recommended
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50"
                    : "bg-white/10 text-white border border-white/15 hover:bg-white/15 hover:border-emerald-400/40"
            }`}
        >
            {label}
            <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-0.5" />
        </motion.button>
    );
}

function FeatureRow({
    text,
    children,
}: {
    text?: string;
    children?: React.ReactNode;
}) {
    return (
        <li className="flex items-start gap-2.5 text-white/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{children ?? text}</span>
        </li>
    );
}
