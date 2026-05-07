"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { requireRateLimit, RATE_POLICIES, userActionKey } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { validatePhases, type TierPhase } from "@/lib/pricing-tiers";

async function requireAdmin(): Promise<{ userId: string; email: string }> {
    const { userId } = await auth();
    if (!userId) throw new Error("unauthorized");
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress;
    if (!email) throw new Error("no_email");
    const ok = (await isAdmin(email)) || (await isAdmin(userId));
    if (!ok) throw new Error("forbidden");
    return { userId, email };
}

export type ActionResult<T = unknown> =
    | { ok: true; data?: T }
    | { ok: false; error: string };

interface TierFormFields {
    slug: string;
    display_name: string;
    price_usd: number;
    monthly_minutes: number;
    rollover_cap: number;
    stripe_price_id: string;
    is_public: boolean;
    description: string | null;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    landing_features: string[];
    landing_cta_label: string | null;
    phases: TierPhase[] | null;
    /** Set when the phases JSON was malformed; surfaced to the admin. */
    phases_parse_error: string | null;
}

/**
 * Parse a JSON string from the admin form. Returns the validated phases or
 * an error string for the user. Empty input means "single-phase tier" — not
 * an error.
 */
function parsePhasesFromForm(
    raw: string
): { phases: TierPhase[] | null; error: string | null } {
    if (!raw) return { phases: null, error: null };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { phases: null, error: "phases JSON is malformed" };
    }
    if (!Array.isArray(parsed) || parsed.length < 2) {
        // Single-phase posted via the multi-phase JSON pipe — treat as
        // "single-phase tier" (toggle was off) so we save phases=null.
        return { phases: null, error: null };
    }
    const result = validatePhases(parsed);
    if (!result.ok) return { phases: null, error: result.error };
    return { phases: result.phases, error: null };
}

function parseFeatures(raw: string): string[] {
    return raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseForm(form: FormData): TierFormFields {
    const slug = String(form.get("slug") ?? "").trim();
    const display_name = String(form.get("display_name") ?? "").trim();
    let price_usd = Number(form.get("price_usd"));
    let monthly_minutes = Number(form.get("monthly_minutes"));
    const rollover_cap = Number(form.get("rollover_cap") ?? 2000);
    let stripe_price_id = String(form.get("stripe_price_id") ?? "").trim();
    const is_public = form.get("is_public") === "on";
    const description = String(form.get("description") ?? "").trim() || null;
    const landing_eyebrow =
        String(form.get("landing_eyebrow") ?? "").trim() || null;
    const landing_headline =
        String(form.get("landing_headline") ?? "").trim() || null;
    const landing_subheadline =
        String(form.get("landing_subheadline") ?? "").trim() || null;
    const landing_features = parseFeatures(String(form.get("landing_features") ?? ""));
    const landing_cta_label =
        String(form.get("landing_cta_label") ?? "").trim() || null;
    const phasesParse = parsePhasesFromForm(String(form.get("phases") ?? "").trim());
    const phases = phasesParse.phases;

    // When multi-phase, top-level fields mirror phase 1 — defensively re-sync
    // here so the DB reflects phase 1 even if the client missed the sync.
    if (phases) {
        stripe_price_id = phases[0].stripe_price_id;
        price_usd = phases[0].price_usd;
        monthly_minutes = phases[0].monthly_minutes;
    }

    return {
        slug,
        display_name,
        price_usd,
        monthly_minutes,
        rollover_cap,
        stripe_price_id,
        is_public,
        description,
        landing_eyebrow,
        landing_headline,
        landing_subheadline,
        landing_features,
        landing_cta_label,
        phases,
        phases_parse_error: phasesParse.error,
    };
}

function validate(fields: TierFormFields): string | null {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fields.slug)) {
        return "Slug must be 1–64 chars: letters, numbers, hyphens, underscores.";
    }
    if (!fields.display_name) return "Display name is required.";
    if (!Number.isFinite(fields.price_usd) || fields.price_usd <= 0) {
        return "Price must be a positive number.";
    }
    if (!Number.isInteger(fields.monthly_minutes) || fields.monthly_minutes <= 0) {
        return "Monthly minutes must be a positive integer.";
    }
    if (!Number.isInteger(fields.rollover_cap) || fields.rollover_cap < 0) {
        return "Rollover cap must be a non-negative integer.";
    }
    if (!fields.stripe_price_id.startsWith("price_")) {
        return "Stripe price ID must start with `price_`.";
    }
    // phases-level errors are surfaced from validatePhases via parsePhasesFromForm
    if (fields.phases_parse_error) return fields.phases_parse_error;
    return null;
}

/**
 * Create a new pricing tier. If `is_public=true`, automatically demotes any
 * other public tier to non-public so the partial unique index doesn't reject
 * the insert.
 */
export async function createTierAction(form: FormData): Promise<ActionResult<{ id: string }>> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "createTier"), RATE_POLICIES.adminWrite);

    const fields = parseForm(form);
    const err = validate(fields);
    if (err) return { ok: false, error: err };

    if (fields.is_public) {
        await supabase
            .from("pricing_tiers")
            .update({ is_public: false, updated_at: new Date().toISOString() })
            .eq("is_public", true);
    }

    const { data, error } = await supabase
        .from("pricing_tiers")
        .insert({
            slug: fields.slug,
            display_name: fields.display_name,
            price_usd: fields.price_usd,
            monthly_minutes: fields.monthly_minutes,
            rollover_cap: fields.rollover_cap,
            stripe_price_id: fields.stripe_price_id,
            is_public: fields.is_public,
            is_active: true,
            description: fields.description,
            landing_eyebrow: fields.landing_eyebrow,
            landing_headline: fields.landing_headline,
            landing_subheadline: fields.landing_subheadline,
            landing_features: fields.landing_features,
            landing_cta_label: fields.landing_cta_label,
            phases: fields.phases,
        })
        .select("id")
        .single();

    if (error) {
        if (error.code === "23505") {
            return { ok: false, error: "That slug is already in use." };
        }
        return { ok: false, error: error.message };
    }

    revalidatePath("/admin/pricing-tiers");
    return { ok: true, data: { id: data.id as string } };
}

export async function updateTierAction(
    id: string,
    form: FormData
): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "updateTier"), RATE_POLICIES.adminWrite);

    const fields = parseForm(form);
    const err = validate(fields);
    if (err) return { ok: false, error: err };

    if (fields.is_public) {
        await supabase
            .from("pricing_tiers")
            .update({ is_public: false, updated_at: new Date().toISOString() })
            .eq("is_public", true)
            .neq("id", id);
    }

    const { error } = await supabase
        .from("pricing_tiers")
        .update({
            slug: fields.slug,
            display_name: fields.display_name,
            price_usd: fields.price_usd,
            monthly_minutes: fields.monthly_minutes,
            rollover_cap: fields.rollover_cap,
            stripe_price_id: fields.stripe_price_id,
            is_public: fields.is_public,
            description: fields.description,
            landing_eyebrow: fields.landing_eyebrow,
            landing_headline: fields.landing_headline,
            landing_subheadline: fields.landing_subheadline,
            landing_features: fields.landing_features,
            landing_cta_label: fields.landing_cta_label,
            phases: fields.phases,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id);

    if (error) {
        if (error.code === "23505") {
            return { ok: false, error: "That slug is already in use." };
        }
        return { ok: false, error: error.message };
    }

    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}

export async function toggleTierActiveAction(id: string): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "toggleTierActive"), RATE_POLICIES.adminWrite);

    const { data: row } = await supabase
        .from("pricing_tiers")
        .select("is_active")
        .eq("id", id)
        .maybeSingle();
    if (!row) return { ok: false, error: "Tier not found." };

    const { error } = await supabase
        .from("pricing_tiers")
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}

export async function deleteTierAction(id: string): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "deleteTier"), RATE_POLICIES.adminWrite);

    // Check FK constraint before issuing the delete for a clearer error.
    const { count } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("pricing_tier_id", id);
    if ((count ?? 0) > 0) {
        return {
            ok: false,
            error: `Cannot delete: ${count} client(s) are on this tier. Deactivate it instead, or retag those clients first.`,
        };
    }

    const { error } = await supabase.from("pricing_tiers").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}
