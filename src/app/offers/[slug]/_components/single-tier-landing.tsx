"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { getTierPhases, type PricingTier } from "@/lib/pricing-tiers-shared";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";
import { LandingBackground, LiveDot } from "@/components/billing/landing-background";
import { selectTierAction } from "../actions";

/**
 * Single-tier campaign landing on the dark brand canvas. CTA submits to
 * `selectTierAction` which sets the `omnify_tier` cookie and redirects to
 * /sign-up. Middleware no longer pre-sets the cookie on /offers/* — the
 * action is the sole writer.
 */
export function SingleTierOfferLanding({ tier }: { tier: PricingTier }) {
    const phases = getTierPhases(tier);
    const adminFeatures = tier.landing_features;

    return (
        <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white py-20 px-6">
            <LandingBackground />

            <div className="relative mx-auto max-w-2xl">
                {/* Hero */}
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.08 } },
                    }}
                    className="text-center mb-12"
                >
                    <motion.div variants={fadeUp} className="flex justify-center mb-5">
                        {tier.landing_eyebrow ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] uppercase text-emerald-300">
                                {tier.landing_eyebrow}
                            </span>
                        ) : (
                            <LiveDot label="Limited Offer" />
                        )}
                    </motion.div>

                    <motion.h1
                        variants={fadeUp}
                        className="bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-transparent leading-[1.05]"
                    >
                        {tier.landing_headline ?? "Welcome to Omnify"}
                    </motion.h1>

                    {tier.landing_subheadline && (
                        <motion.p
                            variants={fadeUp}
                            className="mt-5 text-lg text-white/60 leading-relaxed"
                        >
                            {tier.landing_subheadline}
                        </motion.p>
                    )}
                </motion.div>

                {/* The card */}
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="relative group"
                >
                    {/* Soft pulsing glow */}
                    <motion.div
                        aria-hidden
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0.25, 0.45, 0.25] }}
                        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-emerald-500/35 via-sky-500/25 to-blue-500/25 blur-2xl"
                    />

                    <div className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-8 backdrop-blur-xl">
                        <div>
                            <p className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-300">
                                {tier.display_name}
                            </p>
                            <div className="mt-3">
                                <PhaseSummary phases={phases} theme="dark" />
                            </div>
                        </div>

                        <ul className="mt-7 space-y-3 text-sm">
                            {adminFeatures.length > 0 ? (
                                adminFeatures.map((f, i) => (
                                    <FeatureRow key={i} text={f} />
                                ))
                            ) : (
                                <>
                                    <FeatureRow>
                                        <PhaseMinutesSummary phases={phases} />
                                    </FeatureRow>
                                    <FeatureRow text="Top up with extra minute packs anytime" />
                                    <FeatureRow text="Cancel anytime" />
                                </>
                            )}
                        </ul>

                        <form action={selectTierAction} className="mt-8">
                            <input type="hidden" name="tier_slug" value={tier.slug} />
                            <motion.button
                                type="submit"
                                whileHover={{ scale: 1.015 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                                className="group/btn w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-400 text-emerald-950 font-semibold rounded-xl px-6 py-3.5 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow"
                            >
                                {tier.landing_cta_label ?? "Get Started"}
                                <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-0.5" />
                            </motion.button>
                        </form>

                        <p className="mt-5 text-xs text-center text-white/40">
                            Already have an account?{" "}
                            <Link
                                href="/sign-in"
                                className="text-emerald-300 hover:text-emerald-200 underline-offset-4 hover:underline transition-colors"
                            >
                                Sign in
                            </Link>
                        </p>
                    </div>
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
        <li className="flex items-start gap-2.5 text-white/80">
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
