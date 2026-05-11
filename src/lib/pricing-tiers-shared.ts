/**
 * Shared (client + server safe) types and pure helpers for pricing tiers.
 *
 * Why this file exists: `src/lib/pricing-tiers.ts` is marked `server-only`
 * because it does Supabase queries. Client Components (subscribe page, offer
 * landings, tier card) need the types and the pure phase helpers but can't
 * import from a server-only module. This file holds only the no-side-effect
 * parts that are safe to import on either side; the server file re-exports
 * everything here so server callers can keep using a single import path.
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
    offer_id: string | null;
    sort_order: number;
    is_recommended: boolean;
    created_at: string;
    updated_at: string;
}

/**
 * Validate + normalize a phases array. Used both at read-time (in
 * `normalizePhases`) and at write-time (in admin actions) so the two paths
 * can never drift.
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
            return {
                ok: false,
                error: `phase ${i + 1}: stripe_price_id must start with 'price_'`,
            };
        }
        if (seenPriceIds.has(stripe_price_id)) {
            return {
                ok: false,
                error: `phase ${i + 1}: duplicate stripe_price_id (each phase needs its own Stripe price)`,
            };
        }
        seenPriceIds.add(stripe_price_id);

        if (!Number.isFinite(price_usd) || price_usd <= 0 || price_usd > 100000) {
            return {
                ok: false,
                error: `phase ${i + 1}: price_usd must be a positive number ≤ 100000`,
            };
        }
        if (
            !Number.isInteger(monthly_minutes) ||
            monthly_minutes <= 0 ||
            monthly_minutes > 1_000_000
        ) {
            return {
                ok: false,
                error: `phase ${i + 1}: monthly_minutes must be a positive integer ≤ 1,000,000`,
            };
        }

        if (isLast) {
            if (duration_months !== null) {
                return {
                    ok: false,
                    error: `phase ${i + 1} (terminal): duration_months must be empty/null`,
                };
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

/**
 * Returns the ordered phase journey for a tier. Synthesizes a 1-element
 * array for single-phase tiers so callers can treat all tiers uniformly.
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
