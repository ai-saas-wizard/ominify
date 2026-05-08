import Link from "next/link";
import { Plus, Globe, EyeOff, Sparkles } from "lucide-react";
import { listAllTiers, getTierPhases } from "@/lib/pricing-tiers";
import { listOffers } from "@/lib/offers";
import { getAppUrl } from "@/lib/app-url";
import { PhaseSummary, PhaseMinutesSummary } from "@/components/billing/phase-summary";
import { TierRowActions } from "./_components/tier-row-actions";

export const dynamic = "force-dynamic";

export default async function PricingTiersAdminPage() {
    const [tiers, offers] = await Promise.all([listAllTiers(), listOffers()]);
    const offersById = new Map(offers.map((o) => [o.id, o]));
    const appUrl = getAppUrl();

    return (
        <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Pricing Tiers</h1>
                    <p className="mt-1 text-gray-600">
                        Manage public and campaign pricing. Each tier carries its own Stripe price
                        and a shareable <code>/offers/[slug]</code> landing page.
                    </p>
                </div>
                <Link
                    href="/admin/pricing-tiers/new"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    New tier
                </Link>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            <th className="px-4 py-3">Tier</th>
                            <th className="px-4 py-3">Offer</th>
                            <th className="px-4 py-3">Price</th>
                            <th className="px-4 py-3">Minutes</th>
                            <th className="px-4 py-3">Stripe price</th>
                            <th className="px-4 py-3">Campaign URL</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {tiers.map((tier) => {
                            const offerUrl = `${appUrl}/offers/${tier.slug}`;
                            const phases = getTierPhases(tier);
                            const offer = tier.offer_id ? offersById.get(tier.offer_id) : null;
                            return (
                                <tr key={tier.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-gray-900">
                                                {tier.display_name}
                                            </span>
                                            {tier.is_public && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-wide">
                                                    <Globe className="w-3 h-3" /> Public
                                                </span>
                                            )}
                                            {tier.is_recommended && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded uppercase tracking-wide">
                                                    <Sparkles className="w-3 h-3" /> Featured
                                                </span>
                                            )}
                                        </div>
                                        <code className="text-xs text-gray-500">{tier.slug}</code>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700">
                                        {offer ? (
                                            <div>
                                                <div className="font-medium text-gray-900">{offer.name}</div>
                                                <code className="text-xs text-gray-500">{offer.slug}</code>
                                                <div className="text-xs text-gray-400">order: {tier.sort_order}</div>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <PhaseSummary phases={phases} variant="compact" />
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700">
                                        <PhaseMinutesSummary phases={phases} />
                                        <div className="text-xs text-gray-400">
                                            cap {tier.rollover_cap.toLocaleString()}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <code className="text-xs text-gray-500">
                                            {tier.stripe_price_id.slice(0, 14)}…
                                        </code>
                                    </td>
                                    <td className="px-4 py-3">
                                        <code className="text-xs text-gray-700 break-all">
                                            /offers/{tier.slug}
                                        </code>
                                    </td>
                                    <td className="px-4 py-3">
                                        {tier.is_active ? (
                                            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                <EyeOff className="w-3 h-3" /> Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <TierRowActions
                                            tierId={tier.id}
                                            isActive={tier.is_active}
                                            offerUrl={offerUrl}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                        {tiers.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                                    No tiers yet. Create one to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="text-xs text-gray-500 max-w-3xl space-y-2">
                <p>
                    <strong className="text-gray-700">How segmentation works:</strong> Visitors who land
                    on a tier&apos;s URL (or pick a tier card on a multi-tier offer) get tagged with a
                    30-day cookie. When they sign up, their client account is locked to that tier&apos;s
                    Stripe price. The public tier is the fallback for visitors who sign up directly.
                    Tier assignment can only be changed by an admin after sign-up.
                </p>
                <p>
                    To bundle multiple tiers under one campaign URL, create an{" "}
                    <a href="/admin/offers" className="text-emerald-700 underline">offer</a>{" "}
                    and assign tiers to it via the Offer dropdown above.
                </p>
            </div>
        </div>
    );
}
