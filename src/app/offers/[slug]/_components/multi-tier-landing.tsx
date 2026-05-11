"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Offer } from "@/lib/offers";
import type { PricingTier } from "@/lib/pricing-tiers-shared";
import { TierCard } from "@/components/billing/tier-card";
import { LandingBackground, LiveDot } from "@/components/billing/landing-background";

/**
 * Offer-level landing page — dark canvas, radial glow, animated hero,
 * staggered tier cards. Each card owns its own submit form bound to
 * `selectTierAction` (in tier-card.tsx).
 */
export function MultiTierOfferLanding({
    offer,
    tiers,
}: {
    offer: Offer;
    tiers: PricingTier[];
}) {
    return (
        <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white py-20 px-6">
            <LandingBackground />

            <div className="relative mx-auto max-w-6xl">
                {/* Hero */}
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.08 } },
                    }}
                    className="text-center mb-14 max-w-2xl mx-auto"
                >
                    <motion.div
                        variants={fadeUp}
                        className="flex items-center justify-center gap-3 mb-5"
                    >
                        {offer.landing_eyebrow ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] uppercase text-emerald-300">
                                {offer.landing_eyebrow}
                            </span>
                        ) : (
                            <LiveDot label="Limited Offer" />
                        )}
                    </motion.div>

                    <motion.h1
                        variants={fadeUp}
                        className="bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-transparent leading-[1.05]"
                    >
                        {offer.landing_headline ?? offer.name}
                    </motion.h1>

                    {offer.landing_subheadline && (
                        <motion.p
                            variants={fadeUp}
                            className="mt-5 text-lg text-white/60 leading-relaxed"
                        >
                            {offer.landing_subheadline}
                        </motion.p>
                    )}
                </motion.div>

                {/* Tier grid */}
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
                        <TierCard key={tier.id} tier={tier} index={i} />
                    ))}
                </div>

                {/* Footer */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.6 }}
                    className="mt-14 text-center text-sm text-white/40"
                >
                    Already have an account?{" "}
                    <Link
                        href="/sign-in"
                        className="text-emerald-300 hover:text-emerald-200 underline-offset-4 hover:underline transition-colors"
                    >
                        Sign in
                    </Link>
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
