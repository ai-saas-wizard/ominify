import { redirect } from "next/navigation";
import { getTierBySlug } from "@/lib/pricing-tiers";
import { getOfferBySlug, getTiersForOffer } from "@/lib/offers";
import { SingleTierOfferLanding } from "./_components/single-tier-landing";
import { MultiTierOfferLanding } from "./_components/multi-tier-landing";

// Always run dynamically — offer / tier rows can change in the admin panel.
export const dynamic = "force-dynamic";

/**
 * Campaign landing page. Cookie-tagging happens in middleware before this
 * page renders. We resolve the slug as either an offer (multi-tier picker)
 * or a tier (single-tier landing). Missing/inactive slugs silently redirect
 * to /sign-up — the response is identical for "doesn't exist" and "not
 * active" so there's no enumeration leak.
 */
export default async function OfferLandingPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;

    // Offer first — multi-tier landing
    const offer = await getOfferBySlug(slug, { onlyActive: true });
    if (offer) {
        const tiers = await getTiersForOffer(offer.id, { onlyActive: true });
        if (tiers.length === 0) redirect("/sign-up");
        return <MultiTierOfferLanding offer={offer} tiers={tiers} />;
    }

    // Fall back to single-tier (existing behavior)
    const tier = await getTierBySlug(slug, { onlyActive: true });
    if (!tier) redirect("/sign-up");
    return <SingleTierOfferLanding tier={tier} />;
}
