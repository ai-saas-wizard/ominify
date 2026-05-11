"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTierBySlug } from "@/lib/pricing-tiers";

const VALID_SLUG = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Customer clicked the CTA on an offer landing page (single- or multi-tier).
 * This action is the sole writer of the `omnify_tier` cookie — middleware
 * does not set it on /offers/* URLs because the URL slug may be an offer
 * slug, not a tier slug. We validate the submitted tier slug, set the
 * cookie, then send the user to /sign-up.
 *
 * Silent redirect on missing/inactive tier — no enumeration leak. The cookie
 * is only set if the tier resolves cleanly.
 */
export async function selectTierAction(formData: FormData): Promise<void> {
    const tierSlug = String(formData.get("tier_slug") ?? "").trim();
    if (!VALID_SLUG.test(tierSlug)) redirect("/sign-up");

    const tier = await getTierBySlug(tierSlug, { onlyActive: true });
    if (!tier) redirect("/sign-up");

    const store = await cookies();
    store.set("omnify_tier", tierSlug, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        secure: process.env.NODE_ENV === "production",
    });

    redirect("/sign-up");
}
