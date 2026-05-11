import "server-only";
import { getOfferBySlug, type Offer } from "./offers";
import { getTierBySlug, type PricingTier } from "./pricing-tiers";

/**
 * Resolves a slug from the `omnify_visit` cookie to either an offer
 * (multi-tier — defer pick to post-signup picker) or a tier (single-tier —
 * direct assignment). Offer takes precedence on collision (which shouldn't
 * happen since slug uniqueness is enforced cross-table at the application
 * layer, but offer-first is the safe default).
 *
 * Lives in its own file to avoid a cycle between offers.ts and
 * pricing-tiers.ts.
 */
export type SlugResolution =
    | { kind: "offer"; offer: Offer }
    | { kind: "tier"; tier: PricingTier }
    | null;

export async function resolveOfferOrTier(
    slug: string | null | undefined
): Promise<SlugResolution> {
    if (!slug) return null;
    const offer = await getOfferBySlug(slug, { onlyActive: true });
    if (offer) return { kind: "offer", offer };
    const tier = await getTierBySlug(slug, { onlyActive: true });
    if (tier) return { kind: "tier", tier };
    return null;
}
