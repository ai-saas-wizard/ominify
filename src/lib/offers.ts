import "server-only";
import { supabase } from "./supabase";
import {
    PRICING_TIER_SELECT_COLS,
    pricingTierRowToTier,
    type PricingTier,
} from "./pricing-tiers";

/**
 * An offer is a marketing landing page that contains an ordered list of
 * pricing tiers. Customers visit /offers/<offer-slug>, pick a tier card, and
 * proceed to sign-up with that tier locked in. Tiers without an offer keep
 * working at /offers/<tier-slug> just like before — the route checks offers
 * first, then falls back to single-tier rendering.
 */
export interface Offer {
    id: string;
    slug: string;
    name: string;
    is_active: boolean;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    created_at: string;
    updated_at: string;
}

interface OfferRow {
    id: string;
    slug: string;
    name: string;
    is_active: boolean;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    created_at: string;
    updated_at: string;
}

const SELECT_COLS =
    "id,slug,name,is_active,landing_eyebrow,landing_headline,landing_subheadline,created_at,updated_at";

function rowToOffer(row: OfferRow): Offer {
    return row;
}

export async function getOfferBySlug(
    slug: string,
    opts: { onlyActive?: boolean } = {}
): Promise<Offer | null> {
    const onlyActive = opts.onlyActive ?? true;
    let query = supabase.from("offers").select(SELECT_COLS).eq("slug", slug);
    if (onlyActive) query = query.eq("is_active", true);
    const { data } = await query.maybeSingle();
    return data ? rowToOffer(data as unknown as OfferRow) : null;
}

export async function getOfferById(id: string): Promise<Offer | null> {
    const { data } = await supabase
        .from("offers")
        .select(SELECT_COLS)
        .eq("id", id)
        .maybeSingle();
    return data ? rowToOffer(data as unknown as OfferRow) : null;
}

/** Admin-only: every offer, active and inactive. */
export async function listOffers(): Promise<Offer[]> {
    const { data } = await supabase
        .from("offers")
        .select(SELECT_COLS)
        .order("created_at", { ascending: false });
    return ((data as unknown as OfferRow[] | null) ?? []).map(rowToOffer);
}

/**
 * Tiers in this offer, sorted by sort_order (ascending) then created_at.
 * `onlyActive` defaults to true — only renderable tiers come back.
 */
export async function getTiersForOffer(
    offerId: string,
    opts: { onlyActive?: boolean } = {}
): Promise<PricingTier[]> {
    const onlyActive = opts.onlyActive ?? true;
    let query = supabase
        .from("pricing_tiers")
        .select(PRICING_TIER_SELECT_COLS)
        .eq("offer_id", offerId);
    if (onlyActive) query = query.eq("is_active", true);
    const { data } = await query
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    return ((data as unknown as unknown[] | null) ?? []).map(pricingTierRowToTier);
}

/** Count of tiers attached to each offer — used by the admin list view. */
export async function getTierCountsByOffer(): Promise<Record<string, number>> {
    const { data } = await supabase
        .from("pricing_tiers")
        .select("offer_id")
        .not("offer_id", "is", null);
    const counts: Record<string, number> = {};
    for (const row of (data as Array<{ offer_id: string }> | null) ?? []) {
        if (row.offer_id) counts[row.offer_id] = (counts[row.offer_id] ?? 0) + 1;
    }
    return counts;
}
