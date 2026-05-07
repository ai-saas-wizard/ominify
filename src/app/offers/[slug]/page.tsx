import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getTierBySlug, getTierPhases } from "@/lib/pricing-tiers";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";

// Always run dynamically — tier rows can change in the admin panel.
export const dynamic = "force-dynamic";

/**
 * Campaign landing page. Cookie-tagging happens in middleware before this
 * page renders. We just look up the tier and render its admin-editable
 * landing content. Missing/inactive slugs silently redirect to /sign-up so
 * the response is identical for "doesn't exist" and "not active" — no leak.
 */
export default async function OfferLandingPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const tier = await getTierBySlug(slug, { onlyActive: true });

    if (!tier) redirect("/sign-up");

    const phases = getTierPhases(tier);
    const adminFeatures = tier.landing_features;

    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white flex items-center justify-center p-6">
            <div className="max-w-2xl w-full">
                <div className="text-center mb-8">
                    {tier.landing_eyebrow && (
                        <p className="text-xs font-semibold tracking-widest text-emerald-700 mb-3 uppercase">
                            {tier.landing_eyebrow}
                        </p>
                    )}
                    <h1 className="text-4xl font-bold text-gray-900 leading-tight">
                        {tier.landing_headline ?? "Welcome to Omnify"}
                    </h1>
                    {tier.landing_subheadline && (
                        <p className="mt-4 text-lg text-gray-600">
                            {tier.landing_subheadline}
                        </p>
                    )}
                </div>

                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
                    <div>
                        <p className="text-sm font-medium text-emerald-700 uppercase tracking-wide">
                            {tier.display_name}
                        </p>
                        <div className="mt-1">
                            <PhaseSummary phases={phases} />
                        </div>
                    </div>

                    <ul className="mt-6 space-y-3">
                        {adminFeatures.length > 0 ? (
                            adminFeatures.map((f, i) => (
                                <li key={i} className="flex items-start gap-2 text-gray-700">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <span>{f}</span>
                                </li>
                            ))
                        ) : (
                            <>
                                <li className="flex items-start gap-2 text-gray-700">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <PhaseMinutesSummary phases={phases} />
                                </li>
                                <li className="flex items-start gap-2 text-gray-700">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <span>Top up with extra minute packs anytime</span>
                                </li>
                                <li className="flex items-start gap-2 text-gray-700">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <span>Cancel anytime</span>
                                </li>
                            </>
                        )}
                    </ul>

                    <div className="mt-8">
                        <Link
                            href="/sign-up"
                            className="block w-full px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-center"
                        >
                            {tier.landing_cta_label ?? "Get Started"}
                        </Link>
                    </div>

                    <p className="mt-4 text-xs text-center text-gray-500">
                        Already have an account?{" "}
                        <Link href="/sign-in" className="text-emerald-700 underline">
                            Sign in
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
