import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Clears all offer-related capture cookies. Called from
 * <ClearTierCookieOnMount /> on the subscribe page after the customer is
 * fully provisioned and their tier (or signup_offer_id) is locked
 * server-side. Prevents leakage to a different account on a shared browser.
 *
 * Three cookies are cleared:
 * - `omnify_visit` — current cookie set by middleware on /offers/<slug>
 * - `omnify_preferred_tier` — soft hint set by multi-tier LP card click
 * - `omnify_tier` — legacy name (cleared so any in-flight cookies from old
 *   sessions don't bleed into a new account)
 */
export async function POST() {
    const store = await cookies();
    store.delete("omnify_visit");
    store.delete("omnify_preferred_tier");
    store.delete("omnify_tier");
    return NextResponse.json({ ok: true });
}
