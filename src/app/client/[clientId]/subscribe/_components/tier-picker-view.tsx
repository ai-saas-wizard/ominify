"use client";

import { motion } from "framer-motion";
import type { Offer } from "@/lib/offers";
import type { PricingTier } from "@/lib/pricing-tiers-shared";
import { TierCard } from "@/components/billing/tier-card";
import { LandingBackground } from "@/components/billing/landing-background";
import { ClearTierCookieOnMount } from "@/components/billing/clear-tier-cookie";

/**
 * Post-signup tier picker. Renders the same visual treatment as the
 * marketing offer landing, but each card's CTA commits the choice via
 * `selectClientTierAction` (server-side write of `clients.pricing_tier_id`)
 * instead of setting a cookie.
 *
 * `preferredTierSlug` (the soft hint from the LP card click) flags the
 * matching card with a "You picked this" badge — purely advisory.
 */
export function TierPickerView({
    clientId,
    offer,
    tiers,
    email,
    preferredTierSlug,
}: {
    clientId: string;
    offer: Offer;
    tiers: PricingTier[];
    email: string;
    preferredTierSlug: string | null;
}) {
    return (
        <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white py-20 px-6">
            <LandingBackground />
            <ClearTierCookieOnMount />

            <div className="relative mx-auto max-w-6xl">
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.08 } },
                    }}
                    className="text-center mb-14 max-w-2xl mx-auto"
                >
                    <motion.div variants={fadeUp} className="flex justify-center mb-5">
                        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] uppercase text-emerald-300">
                            {offer.landing_eyebrow ?? "Pick your plan"}
                        </span>
                    </motion.div>

                    <motion.h1
                        variants={fadeUp}
                        className="bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-transparent leading-[1.05]"
                    >
                        {offer.landing_headline ?? offer.name}
                    </motion.h1>

                    <motion.p
                        variants={fadeUp}
                        className="mt-5 text-lg text-white/60 leading-relaxed"
                    >
                        {offer.landing_subheadline ??
                            "Pick the plan that fits — you can change later. Your first payment goes through Stripe right after."}
                    </motion.p>
                </motion.div>

                <div
                    className={`grid gap-7 ${
                        tiers.length === 1
                            ? "max-w-md mx-auto"
                            : tiers.length === 2
                              ? "md:grid-cols-2 max-w-4xl mx-auto"
                              : "md:grid-cols-2 lg:grid-cols-3"
                    }`}
                >
                    {tiers.map((tier, i) => (
                        <TierCard
                            key={tier.id}
                            tier={tier}
                            index={i}
                            mode="select"
                            clientId={clientId}
                            isPreferred={
                                preferredTierSlug !== null &&
                                preferredTierSlug === tier.slug
                            }
                        />
                    ))}
                </div>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.6 }}
                    className="mt-14 text-center text-sm text-white/40"
                >
                    Signed in as <span className="font-medium text-white/70">{email}</span>
                </motion.p>
            </div>
        </main>
    );
}

const fadeUp = {
    hidden: { opacity: 0, y: 14 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
    },
};
