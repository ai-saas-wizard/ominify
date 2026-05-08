"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { requireRateLimit, RATE_POLICIES, userActionKey } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

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

interface OfferFormFields {
    slug: string;
    name: string;
    is_active: boolean;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
}

function parseForm(form: FormData): OfferFormFields {
    return {
        slug: String(form.get("slug") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        is_active: form.get("is_active") === "on",
        landing_eyebrow: String(form.get("landing_eyebrow") ?? "").trim() || null,
        landing_headline: String(form.get("landing_headline") ?? "").trim() || null,
        landing_subheadline: String(form.get("landing_subheadline") ?? "").trim() || null,
    };
}

function validate(fields: OfferFormFields): string | null {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fields.slug)) {
        return "Slug must be 1–64 chars: letters, numbers, hyphens, underscores.";
    }
    if (!fields.name) return "Name is required.";
    return null;
}

/**
 * Cross-table check: an offer slug must not collide with a tier slug. Both
 * are reachable at /offers/<slug>; the route resolves offers first so a
 * collision would silently shadow the tier.
 */
async function checkSlugCollision(
    slug: string,
    excludeOfferId?: string
): Promise<string | null> {
    const { data: tierRow } = await supabase
        .from("pricing_tiers")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
    if (tierRow) return "That slug is already in use by a tier.";

    if (excludeOfferId) {
        const { data: offerRow } = await supabase
            .from("offers")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
        if (offerRow && (offerRow as { id: string }).id !== excludeOfferId) {
            return "That slug is already in use by another offer.";
        }
    }
    return null;
}

export async function createOfferAction(
    form: FormData
): Promise<ActionResult<{ id: string }>> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "createOffer"), RATE_POLICIES.adminWrite);

    const fields = parseForm(form);
    const err = validate(fields);
    if (err) return { ok: false, error: err };

    const collision = await checkSlugCollision(fields.slug);
    if (collision) return { ok: false, error: collision };

    const { data, error } = await supabase
        .from("offers")
        .insert({
            slug: fields.slug,
            name: fields.name,
            is_active: fields.is_active,
            landing_eyebrow: fields.landing_eyebrow,
            landing_headline: fields.landing_headline,
            landing_subheadline: fields.landing_subheadline,
        })
        .select("id")
        .single();

    if (error) {
        if (error.code === "23505") return { ok: false, error: "That slug is already in use." };
        return { ok: false, error: error.message };
    }

    revalidatePath("/admin/offers");
    revalidatePath("/admin/pricing-tiers");
    return { ok: true, data: { id: data.id as string } };
}

export async function updateOfferAction(
    id: string,
    form: FormData
): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "updateOffer"), RATE_POLICIES.adminWrite);

    const fields = parseForm(form);
    const err = validate(fields);
    if (err) return { ok: false, error: err };

    const collision = await checkSlugCollision(fields.slug, id);
    if (collision) return { ok: false, error: collision };

    const { error } = await supabase
        .from("offers")
        .update({
            slug: fields.slug,
            name: fields.name,
            is_active: fields.is_active,
            landing_eyebrow: fields.landing_eyebrow,
            landing_headline: fields.landing_headline,
            landing_subheadline: fields.landing_subheadline,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id);

    if (error) {
        if (error.code === "23505") return { ok: false, error: "That slug is already in use." };
        return { ok: false, error: error.message };
    }

    revalidatePath("/admin/offers");
    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}

export async function toggleOfferActiveAction(id: string): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "toggleOfferActive"), RATE_POLICIES.adminWrite);

    const { data: row } = await supabase
        .from("offers")
        .select("is_active")
        .eq("id", id)
        .maybeSingle();
    if (!row) return { ok: false, error: "Offer not found." };

    const { error } = await supabase
        .from("offers")
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/offers");
    return { ok: true };
}

export async function deleteOfferAction(id: string): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "deleteOffer"), RATE_POLICIES.adminWrite);

    // Tiers in this offer get offer_id=NULL via FK ON DELETE SET NULL.
    const { error } = await supabase.from("offers").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin/offers");
    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}

/**
 * Rewrite sort_order across every tier currently in `offerId` to be a
 * contiguous 1..N sequence ordered by current (sort_order asc, created_at
 * asc). Idempotent and self-healing — safe to call after any move/remove.
 *
 * Note: serial UPDATEs (no transaction). Concurrent admin edits can
 * interleave; admin UI is low-traffic so this is acceptable for v1.
 */
async function renumberTiersInOffer(offerId: string): Promise<void> {
    const { data: rows } = await supabase
        .from("pricing_tiers")
        .select("id")
        .eq("offer_id", offerId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    const ordered = (rows as Array<{ id: string }> | null) ?? [];
    const now = new Date().toISOString();
    for (let i = 0; i < ordered.length; i++) {
        await supabase
            .from("pricing_tiers")
            .update({ sort_order: i + 1, updated_at: now })
            .eq("id", ordered[i].id);
    }
}

/**
 * Reorder a tier within its offer by one step up or down. Reassigns
 * `sort_order` across all tiers in the offer to keep them distinct and
 * contiguous (1..N), so subsequent moves are unambiguous even when admins
 * leave default sort_order values.
 */
export async function moveTierInOfferAction(
    tierId: string,
    direction: "up" | "down"
): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "moveTier"), RATE_POLICIES.adminWrite);

    const { data: tier } = await supabase
        .from("pricing_tiers")
        .select("id, offer_id")
        .eq("id", tierId)
        .maybeSingle();
    if (!tier || !(tier as { offer_id: string | null }).offer_id) {
        return { ok: false, error: "Tier is not in an offer." };
    }
    const offerId = (tier as { offer_id: string }).offer_id;

    // Read every tier in the offer in canonical order.
    const { data: rows } = await supabase
        .from("pricing_tiers")
        .select("id")
        .eq("offer_id", offerId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    const ordered = (rows as Array<{ id: string }> | null) ?? [];
    const idx = ordered.findIndex((r) => r.id === tierId);
    if (idx < 0) return { ok: false, error: "Tier not found in offer." };

    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) {
        return { ok: false, error: `Already at the ${direction === "up" ? "top" : "bottom"}.` };
    }

    // Swap positions, then write a contiguous 1..N sort_order across all
    // tiers in the offer. Idempotent if run again.
    const reordered = ordered.slice();
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];

    const now = new Date().toISOString();
    for (let i = 0; i < reordered.length; i++) {
        await supabase
            .from("pricing_tiers")
            .update({ sort_order: i + 1, updated_at: now })
            .eq("id", reordered[i].id);
    }

    revalidatePath("/admin/offers");
    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}

export async function removeTierFromOfferAction(
    tierId: string
): Promise<ActionResult> {
    const { userId } = await requireAdmin();
    requireRateLimit(userActionKey(userId, "removeTierFromOffer"), RATE_POLICIES.adminWrite);

    // Capture which offer the tier was in so we can renumber its survivors.
    const { data: row } = await supabase
        .from("pricing_tiers")
        .select("offer_id")
        .eq("id", tierId)
        .maybeSingle();
    const previousOfferId = (row as { offer_id: string | null } | null)?.offer_id ?? null;

    const { error } = await supabase
        .from("pricing_tiers")
        .update({
            offer_id: null,
            sort_order: 0,
            is_recommended: false,
            updated_at: new Date().toISOString(),
        })
        .eq("id", tierId);
    if (error) return { ok: false, error: error.message };

    if (previousOfferId) {
        await renumberTiersInOffer(previousOfferId);
    }

    revalidatePath("/admin/offers");
    revalidatePath("/admin/pricing-tiers");
    return { ok: true };
}
