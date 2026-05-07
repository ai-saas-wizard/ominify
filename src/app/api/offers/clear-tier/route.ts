import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Clears the `omnify_tier` capture cookie. Called from
 * <ClearTierCookieOnMount /> on the subscribe page after a successful
 * provisioning, so the cookie can't leak to a different account on a shared
 * browser.
 */
export async function POST() {
    const store = await cookies();
    store.delete("omnify_tier");
    return NextResponse.json({ ok: true });
}
