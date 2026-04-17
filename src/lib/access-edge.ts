/**
 * Edge-runtime-safe access gate, used ONLY by src/middleware.ts.
 *
 * Can't import `@/lib/supabase` here because it's `server-only`. We spin up a
 * minimal fetch-based Supabase client instead — middleware runs on every
 * request, so the query budget here is tight.
 *
 * Mirrors the rules in src/lib/access.ts:
 *   - `subscription_grandfathered` bypasses the gate.
 *   - `account_type === 'CUSTOM'` bypasses the gate.
 *   - Admin users bypass (resolved by email OR clerk_id).
 *   - Otherwise, need a `subscriptions` row with status in
 *     (active | trialing | admin_granted). `past_due` is explicitly NOT allowed.
 */

import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient> | null = null;

function getClient() {
    if (cached) return cached;
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    cached = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return cached;
}

export type EdgeAccessResult =
    | { allowed: true }
    | { allowed: false; reason: "no_subscription" | "past_due" | "canceled" | "client_not_found" };

export async function isAdminEdge(userEmail: string | null, userId: string | null): Promise<boolean> {
    if (!userEmail && !userId) return false;
    const supabase = getClient();

    // Supabase .or() needs comma-joined filters. Either email or clerk_id match.
    const filters: string[] = [];
    if (userEmail) filters.push(`email.eq.${userEmail.toLowerCase()}`);
    if (userId) filters.push(`clerk_id.eq.${userId}`);

    const { data } = await supabase
        .from("admin_users")
        .select("id")
        .or(filters.join(","))
        .maybeSingle();

    return !!data;
}

export async function hasActiveSubscriptionEdge(clientId: string): Promise<EdgeAccessResult> {
    const supabase = getClient();

    const { data: client } = await supabase
        .from("clients")
        .select("id, account_type, subscription_grandfathered")
        .eq("id", clientId)
        .maybeSingle();

    if (!client) return { allowed: false, reason: "client_not_found" };
    if ((client as { subscription_grandfathered: boolean }).subscription_grandfathered) {
        return { allowed: true };
    }
    if ((client as { account_type: string }).account_type === "CUSTOM") {
        return { allowed: true };
    }

    const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "past_due", "admin_granted"])
        .maybeSingle();

    if (!sub) return { allowed: false, reason: "no_subscription" };
    const status = (sub as { status: string }).status;
    if (status === "active" || status === "trialing" || status === "admin_granted") {
        return { allowed: true };
    }
    if (status === "past_due") return { allowed: false, reason: "past_due" };
    return { allowed: false, reason: "canceled" };
}
