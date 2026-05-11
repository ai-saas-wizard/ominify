"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import type { PricingTier } from "@/lib/pricing-tiers-shared";
import { getTierPhases, isMultiPhase } from "@/lib/pricing-tiers-shared";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";
import { SubscribeButton } from "@/components/billing/subscribe-button";
import { ClearTierCookieOnMount } from "@/components/billing/clear-tier-cookie";
import { LandingBackground } from "@/components/billing/landing-background";

/**
 * In-app subscribe page UI. Server Component fetches the auth + tier and
 * passes the data in; everything visible lives here so we can animate.
 *
 * Cookie clear happens once on mount via `ClearTierCookieOnMount` — by the
 * time the user reaches this page their `clients.pricing_tier_id` is locked.
 */
export function SubscribeView({
    clientId,
    tier,
    email,
}: {
    clientId: string;
    tier: PricingTier;
    email: string;
}) {
    const phases = getTierPhases(tier);
    const multiPhase = isMultiPhase(tier);
    const adminFeatures = tier.landing_features;

    return (
        <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white py-16 px-6 flex items-center justify-center">
            <LandingBackground />
            <ClearTierCookieOnMount />

            <div className="relative w-full max-w-xl">
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.08 } },
                    }}
                    className="text-center mb-10"
                >
                    <motion.h1
                        variants={fadeUp}
                        className="bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-4xl sm:text-5xl font-bold tracking-tight text-transparent leading-[1.05]"
                    >
                        {tier.landing_headline ?? "Unlock your voice agents"}
                    </motion.h1>
                    <motion.p
                        variants={fadeUp}
                        className="mt-4 text-base text-white/60 leading-relaxed"
                    >
                        {tier.landing_subheadline ??
                            "Omnify runs your inbound and outbound AI voice calls. Subscribe to activate your account and start placing calls today."}
                    </motion.p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="relative group"
                >
                    <motion.div
                        aria-hidden
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0.25, 0.45, 0.25] }}
                        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-emerald-500/35 via-sky-500/25 to-blue-500/25 blur-2xl"
                    />

                    <div className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-8 backdrop-blur-xl">
                        <div className="flex items-baseline justify-between">
                            <p className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-300">
                                {tier.display_name}
                            </p>
                        </div>
                        <div className="mt-3">
                            <PhaseSummary phases={phases} theme="dark" />
                        </div>

                        <ul className="mt-7 space-y-3">
                            {adminFeatures.length > 0 ? (
                                adminFeatures.map((feature, i) => (
                                    <FeatureRow key={i} text={feature} />
                                ))
                            ) : (
                                <>
                                    <FeatureRow>
                                        <PhaseMinutesSummary phases={phases} />
                                    </FeatureRow>
                                    <FeatureRow
                                        text={`Unused minutes roll over (capped at ${tier.rollover_cap.toLocaleString()})`}
                                    />
                                    <FeatureRow text="Top up with extra minute packs anytime" />
                                    <FeatureRow text="Cancel, upgrade, or update your card via the Stripe portal" />
                                </>
                            )}
                        </ul>

                        <div className="mt-8">
                            <SubscribeButton
                                clientId={clientId}
                                priceUsd={phases[0].price_usd}
                                multiPhase={multiPhase}
                                ctaLabel={tier.landing_cta_label ?? undefined}
                            />
                        </div>

                        <p className="mt-5 text-xs text-center text-white/40">
                            Secure checkout powered by Stripe. You can cancel at any time.
                        </p>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.6 }}
                    className="mt-8 text-center text-sm text-white/40"
                >
                    Signed in as <span className="font-medium text-white/70">{email}</span>
                </motion.div>
            </div>
        </main>
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
        <li className="flex items-start gap-2.5 text-white/80 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{children ?? text}</span>
        </li>
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
