import { CheckCircle2, Sparkles } from "lucide-react";
import { getTierPhases, type PricingTier } from "@/lib/pricing-tiers";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";
import { selectTierAction } from "@/app/offers/[slug]/actions";

/**
 * One pricing tier rendered as a card. Used on multi-tier offer pages.
 * Submitting the form invokes the server action, which sets the
 * `omnify_tier` cookie to this tier's slug and redirects to /sign-up.
 */
export function TierCard({ tier }: { tier: PricingTier }) {
    const phases = getTierPhases(tier);
    const features =
        tier.landing_features.length > 0 ? tier.landing_features : null;

    return (
        <div
            className={`relative bg-white rounded-2xl border p-6 flex flex-col ${
                tier.is_recommended
                    ? "border-emerald-500 ring-2 ring-emerald-500/20 shadow-md"
                    : "border-gray-200"
            }`}
        >
            {tier.is_recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-emerald-600 text-white text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full">
                    <Sparkles className="w-3 h-3" /> Most Popular
                </div>
            )}

            <div>
                <h3 className="text-lg font-bold text-gray-900">
                    {tier.display_name}
                </h3>
                <div className="mt-2">
                    <PhaseSummary phases={phases} />
                </div>
            </div>

            <ul className="mt-6 space-y-2.5 text-sm flex-1">
                {features ? (
                    features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <span>{f}</span>
                        </li>
                    ))
                ) : (
                    <>
                        <li className="flex items-start gap-2 text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <PhaseMinutesSummary phases={phases} />
                        </li>
                        <li className="flex items-start gap-2 text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <span>Cancel anytime</span>
                        </li>
                    </>
                )}
            </ul>

            <form action={selectTierAction} className="mt-6">
                <input type="hidden" name="tier_slug" value={tier.slug} />
                <button
                    type="submit"
                    className={`w-full px-4 py-2.5 font-semibold rounded-lg transition-colors ${
                        tier.is_recommended
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-gray-900 text-white hover:bg-gray-800"
                    }`}
                >
                    {tier.landing_cta_label ?? `Choose ${tier.display_name}`}
                </button>
            </form>
        </div>
    );
}
