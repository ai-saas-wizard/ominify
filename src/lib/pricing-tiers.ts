import "server-only";
import { supabase } from "./supabase";

/**
 * Tier catalog — the single source of truth for what we charge per client.
 *
 * Rows are managed via /admin/pricing-tiers. Every client carries a
 * `pricing_tier_id` FK to one row; the subscribe route, subscribe page, and
 * Stripe webhook all read pricing decisions from here. There is no static
 * fallback in code — exactly one row must have `is_public=true is_active=true`,
 * which `getPublicTier()` resolves for default sign-ups and as a safety net.
 */
export interface PricingTier {
    id: string;
    slug: string;
    display_name: string;
    price_usd: number;
    monthly_minutes: number;
    rollover_cap: number;
    stripe_price_id: string;
    is_public: boolean;
    is_active: boolean;
    description: string | null;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    landing_features: string[];
    landing_cta_label: string | null;
    created_at: string;
    updated_at: string;
}

const SELECT_COLS =
    "id,slug,display_name,price_usd,monthly_minutes,rollover_cap,stripe_price_id," +
    "is_public,is_active,description,landing_eyebrow,landing_headline," +
    "landing_subheadline,landing_features,landing_cta_label,created_at,updated_at";

interface PricingTierRow {
    id: string;
    slug: string;
    display_name: string;
    price_usd: number | string;
    monthly_minutes: number | string;
    rollover_cap: number | string;
    stripe_price_id: string;
    is_public: boolean;
    is_active: boolean;
    description: string | null;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    landing_features: unknown;
    landing_cta_label: string | null;
    created_at: string;
    updated_at: string;
}

function rowToTier(row: PricingTierRow): PricingTier {
    const features = Array.isArray(row.landing_features)
        ? (row.landing_features as unknown[]).filter(
              (f): f is string => typeof f === "string"
          )
        : [];
    return {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        price_usd: Number(row.price_usd),
        monthly_minutes: Number(row.monthly_minutes),
        rollover_cap: Number(row.rollover_cap),
        stripe_price_id: row.stripe_price_id,
        is_public: row.is_public,
        is_active: row.is_active,
        description: row.description,
        landing_eyebrow: row.landing_eyebrow,
        landing_headline: row.landing_headline,
        landing_subheadline: row.landing_subheadline,
        landing_features: features,
        landing_cta_label: row.landing_cta_label,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Look up a tier by its slug. Defaults to active-only.
 */
export async function getTierBySlug(
    slug: string,
    opts: { onlyActive?: boolean } = {}
): Promise<PricingTier | null> {
    const onlyActive = opts.onlyActive ?? true;
    let query = supabase.from("pricing_tiers").select(SELECT_COLS).eq("slug", slug);
    if (onlyActive) query = query.eq("is_active", true);
    const { data } = await query.maybeSingle();
    return data ? rowToTier(data as unknown as PricingTierRow) : null;
}

export async function getTierById(id: string): Promise<PricingTier | null> {
    const { data } = await supabase
        .from("pricing_tiers")
        .select(SELECT_COLS)
        .eq("id", id)
        .maybeSingle();
    return data ? rowToTier(data as unknown as PricingTierRow) : null;
}

/**
 * The active public tier (one row with is_public=true, is_active=true).
 * Throws if missing — that's a configuration error, not a runtime case.
 */
export async function getPublicTier(): Promise<PricingTier> {
    const { data, error } = await supabase
        .from("pricing_tiers")
        .select(SELECT_COLS)
        .eq("is_public", true)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new Error(`[pricing-tiers] getPublicTier failed: ${error.message}`);
    }
    if (!data) {
        throw new Error(
            "[pricing-tiers] No public tier configured. Run migrations or mark one row is_public=true."
        );
    }
    return rowToTier(data as unknown as PricingTierRow);
}

/**
 * Resolve the tier for a given client. Falls back to the public tier if the
 * client row has no `pricing_tier_id` (defensive — backfill should make this
 * unreachable for existing clients).
 */
export async function getTierForClient(clientId: string): Promise<PricingTier> {
    const { data: client } = await supabase
        .from("clients")
        .select("pricing_tier_id")
        .eq("id", clientId)
        .maybeSingle();
    if (client?.pricing_tier_id) {
        const tier = await getTierById(client.pricing_tier_id as string);
        if (tier) return tier;
    }
    return getPublicTier();
}

/**
 * Resolve the tier to assign at signup time. Reads the cookie value if any;
 * falls back to the public tier when missing or invalid.
 */
export async function getTierForSignup(
    slugFromCookie: string | null
): Promise<PricingTier> {
    if (slugFromCookie) {
        const tier = await getTierBySlug(slugFromCookie, { onlyActive: true });
        if (tier) return tier;
    }
    return getPublicTier();
}

/**
 * Admin-only: list every tier (active and inactive), public tier first.
 */
export async function listAllTiers(): Promise<PricingTier[]> {
    const { data } = await supabase
        .from("pricing_tiers")
        .select(SELECT_COLS)
        .order("is_public", { ascending: false })
        .order("created_at", { ascending: false });
    return ((data as unknown as PricingTierRow[] | null) ?? []).map(rowToTier);
}
