import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getOfferById, getTiersForOffer } from "@/lib/offers";
import { getTierPhases, type PricingTier } from "@/lib/pricing-tiers";
import { OfferForm } from "../../_components/offer-form";
import {
    OfferTiersManager,
    type AssignedTier,
} from "../../_components/offer-tiers-manager";

export const dynamic = "force-dynamic";

function priceLabel(tier: PricingTier): string {
    const phases = getTierPhases(tier);
    if (phases.length === 1) return `$${phases[0].price_usd}/mo`;
    const intro = phases[0];
    const tail = phases[phases.length - 1];
    return `$${intro.price_usd} → $${tail.price_usd}`;
}

export default async function EditOfferPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const offer = await getOfferById(id);
    if (!offer) notFound();
    const tiers = await getTiersForOffer(offer.id, { onlyActive: false });

    const assigned: AssignedTier[] = tiers.map((t) => ({
        id: t.id,
        slug: t.slug,
        display_name: t.display_name,
        price_label: priceLabel(t),
        is_recommended: t.is_recommended,
        sort_order: t.sort_order,
    }));

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
            <Link
                href="/admin/offers"
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to offers
            </Link>
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Edit offer</h1>
                <p className="mt-1 text-gray-600">
                    Changes affect the offer&apos;s landing page immediately. Tier
                    assignments are managed below.
                </p>
            </div>
            <OfferForm
                mode="edit"
                initial={{
                    id: offer.id,
                    slug: offer.slug,
                    name: offer.name,
                    is_active: offer.is_active,
                    landing_eyebrow: offer.landing_eyebrow,
                    landing_headline: offer.landing_headline,
                    landing_subheadline: offer.landing_subheadline,
                }}
            />
            <OfferTiersManager tiers={assigned} />
        </div>
    );
}
