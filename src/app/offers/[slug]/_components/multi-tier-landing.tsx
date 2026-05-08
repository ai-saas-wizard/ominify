import Link from "next/link";
import type { Offer } from "@/lib/offers";
import type { PricingTier } from "@/lib/pricing-tiers";
import { TierCard } from "@/components/billing/tier-card";

/**
 * Offer-level landing page with a grid of tier cards. The offer carries the
 * page wrapper (eyebrow / headline / subhead); each tier carries its own
 * card details (name, price journey, features, CTA).
 *
 * Cookie state on entry: middleware already set `omnify_tier=<offer-slug>`.
 * Clicking a card invokes a server action that overwrites the cookie with
 * the chosen tier's slug.
 */
export function MultiTierOfferLanding({
    offer,
    tiers,
}: {
    offer: Offer;
    tiers: PricingTier[];
}) {
    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white py-16 px-6">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-12 max-w-2xl mx-auto">
                    {offer.landing_eyebrow && (
                        <p className="text-xs font-semibold tracking-widest text-emerald-700 mb-3 uppercase">
                            {offer.landing_eyebrow}
                        </p>
                    )}
                    <h1 className="text-4xl font-bold text-gray-900 leading-tight">
                        {offer.landing_headline ?? offer.name}
                    </h1>
                    {offer.landing_subheadline && (
                        <p className="mt-4 text-lg text-gray-600">
                            {offer.landing_subheadline}
                        </p>
                    )}
                </div>

                <div
                    className={`grid gap-6 ${
                        tiers.length === 1
                            ? "max-w-md mx-auto"
                            : tiers.length === 2
                              ? "md:grid-cols-2 max-w-3xl mx-auto"
                              : "md:grid-cols-2 lg:grid-cols-3"
                    }`}
                >
                    {tiers.map((tier) => (
                        <TierCard key={tier.id} tier={tier} />
                    ))}
                </div>

                <p className="mt-10 text-center text-sm text-gray-500">
                    Already have an account?{" "}
                    <Link href="/sign-in" className="text-emerald-700 underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
