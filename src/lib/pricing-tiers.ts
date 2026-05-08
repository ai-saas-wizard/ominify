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
/**
 * One phase of a tier's pricing journey. A tier with `phases=null` is
 * single-phase (the top-level fields are the only price); a tier with `phases`
 * set goes through them in order, with the last phase running forever
 * (`duration_months: null`).
 */
export interface TierPhase {
    stripe_price_id: string;
    price_usd: number;
    monthly_minutes: number;
    duration_months: number | null;
}

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
    phases: TierPhase[] | null;
    /** Offer this tier belongs to (null = no offer; standalone tier). */
    offer_id: string | null;
    /** Display order within an offer (lower = first). Ignored when offer_id is null. */
    sort_order: number;
    /** "Most Popular" badge on the tier card within an offer. */
    is_recommended: boolean;
    created_at: string;
    updated_at: string;
}

export const PRICING_TIER_SELECT_COLS =
    "id,slug,display_name,price_usd,monthly_minutes,rollover_cap,stripe_price_id," +
    "is_public,is_active,description,landing_eyebrow,landing_headline," +
    "landing_subheadline,landing_features,landing_cta_label,phases," +
    "offer_id,sort_order,is_recommended,created_at,updated_at";

const SELECT_COLS = PRICING_TIER_SELECT_COLS;

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
    phases: unknown;
    offer_id: string | null;
    sort_order: number | string | null;
    is_recommended: boolean | null;
    created_at: string;
    updated_at: string;
}

/**
 * Validate + normalize a phases array. Returns `{ ok: true, phases }` on
 * success, or `{ ok: false, error }` with a human-readable message on any
 * structural problem. The same routine is used for read-time normalization
 * (in `rowToTier`) and write-time validation (in admin server actions), so
 * the two paths can never drift.
 */
export function validatePhases(
    raw: unknown
): { ok: true; phases: TierPhase[] } | { ok: false; error: string } {
    if (!Array.isArray(raw)) return { ok: false, error: "phases must be an array" };
    if (raw.length === 0) return { ok: false, error: "phases must not be empty" };
    const phases: TierPhase[] = [];
    const seenPriceIds = new Set<string>();
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== "object") {
            return { ok: false, error: `phase ${i + 1}: not an object` };
        }
        const o = item as Record<string, unknown>;
        const stripe_price_id =
            typeof o.stripe_price_id === "string" ? o.stripe_price_id.trim() : "";
        const price_usd = Number(o.price_usd);
        const monthly_minutes = Number(o.monthly_minutes);
        const isLast = i === raw.length - 1;
        const duration_months =
            o.duration_months === null ||
            o.duration_months === undefined ||
            o.duration_months === ""
                ? null
                : Number(o.duration_months);

        if (!stripe_price_id.startsWith("price_")) {
            return { ok: false, error: `phase ${i + 1}: stripe_price_id must start with 'price_'` };
        }
        if (seenPriceIds.has(stripe_price_id)) {
            return {
                ok: false,
                error: `phase ${i + 1}: duplicate stripe_price_id (each phase needs its own Stripe price)`,
            };
        }
        seenPriceIds.add(stripe_price_id);

        if (!Number.isFinite(price_usd) || price_usd <= 0 || price_usd > 100000) {
            return { ok: false, error: `phase ${i + 1}: price_usd must be a positive number ≤ 100000` };
        }
        if (!Number.isInteger(monthly_minutes) || monthly_minutes <= 0 || monthly_minutes > 1_000_000) {
            return { ok: false, error: `phase ${i + 1}: monthly_minutes must be a positive integer ≤ 1,000,000` };
        }

        if (isLast) {
            if (duration_months !== null) {
                return { ok: false, error: `phase ${i + 1} (terminal): duration_months must be empty/null` };
            }
        } else {
            if (
                duration_months === null ||
                !Number.isInteger(duration_months) ||
                duration_months < 1 ||
                duration_months > 120
            ) {
                return {
                    ok: false,
                    error: `phase ${i + 1}: duration_months must be an integer between 1 and 120`,
                };
            }
        }
        phases.push({ stripe_price_id, price_usd, monthly_minutes, duration_months });
    }
    return { ok: true, phases };
}

function normalizePhases(raw: unknown): TierPhase[] | null {
    // Read path is permissive about a missing column — null/undefined just
    // means "single-phase tier". Anything else must validate cleanly; if a
    // malformed JSONB ends up in the DB we'd rather surface that loudly
    // than silently render the wrong price.
    if (raw === null || raw === undefined) return null;
    const result = validatePhases(raw);
    if (!result.ok) {
        console.error(`[pricing-tiers] invalid phases JSONB: ${result.error}`);
        return null;
    }
    return result.phases;
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
        phases: normalizePhases(row.phases),
        offer_id: row.offer_id,
        sort_order: Number(row.sort_order ?? 0),
        is_recommended: row.is_recommended ?? false,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/** Re-exported so other modules (e.g. offers.ts) can build typed tier rows. */
export function pricingTierRowToTier(row: unknown): PricingTier {
    return rowToTier(row as PricingTierRow);
}

/**
 * Returns the ordered phase journey for a tier. Synthesizes a 1-element array
 * for single-phase tiers so callers can treat all tiers uniformly.
 */
export function getTierPhases(tier: PricingTier): TierPhase[] {
    if (Array.isArray(tier.phases) && tier.phases.length > 0) return tier.phases;
    return [
        {
            stripe_price_id: tier.stripe_price_id,
            price_usd: tier.price_usd,
            monthly_minutes: tier.monthly_minutes,
            duration_months: null,
        },
    ];
}

/** True if the tier has more than one phase. */
export function isMultiPhase(tier: PricingTier): boolean {
    return Array.isArray(tier.phases) && tier.phases.length > 1;
}

/** Match a Stripe price.id against the tier's phases. Returns null if no match. */
export function getPhaseByPriceId(
    tier: PricingTier,
    priceId: string | null | undefined
): TierPhase | null {
    if (!priceId) return null;
    return getTierPhases(tier).find((p) => p.stripe_price_id === priceId) ?? null;
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
