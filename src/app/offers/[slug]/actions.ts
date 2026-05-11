"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTierBySlug } from "@/lib/pricing-tiers";

const VALID_SLUG = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Multi-tier offer LP card click. The actual tier selection happens
 * post-signup on /client/<id>/subscribe via `selectClientTierAction`. This
 * action only stores a soft *preference hint* so the picker pre-highlights
 * the card the customer was leaning toward — they're still free to switch.
 *
 * Why this is just a hint and not the source of truth: pre-signup cookies
 * cross Clerk OAuth and have caused real bugs (silent fall-back to public
 * tier, shared-browser leaks). The picker on the warm logged-in dashboard
 * is the only place we commit `clients.pricing_tier_id`.
 */
export async function selectTierAction(formData: FormData): Promise<void> {
    const tierSlug = String(formData.get("tier_slug") ?? "").trim();
    if (!VALID_SLUG.test(tierSlug)) {
        console.warn(`[selectTierAction] invalid slug shape: ${JSON.stringify(tierSlug)}`);
        redirect("/sign-up");
    }

    const tier = await getTierBySlug(tierSlug, { onlyActive: true });
    if (!tier) {
        // No hint set if the tier doesn't exist/active — picker will render
        // unsorted. Customer still goes through the same signup flow.
        console.warn(`[selectTierAction] tier hint not found: ${tierSlug}`);
        redirect("/sign-up");
    }

    const store = await cookies();
    store.set("omnify_preferred_tier", tierSlug, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        secure: process.env.NODE_ENV === "production",
    });

    redirect("/sign-up");
}
