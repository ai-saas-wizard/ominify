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

// In-memory TTL caches. Middleware fires on every request; without caching
// that's a Supabase round-trip per sidebar click. 30s TTL is short enough
// that admin flips and subscription cancellations reflect quickly, long
// enough to absorb rapid navigation.
//
// Note: edge runtime may run multiple instances; each one has its own Map.
// That's fine — partial caching still eliminates the lag on the common
// case (same instance serving a burst of clicks from one user).
const ADMIN_TTL_MS = 30_000;
const SUB_TTL_MS = 30_000;
const adminCache = new Map<string, { value: boolean; expires: number }>();
const subCache = new Map<string, { value: EdgeAccessResult; expires: number }>();

export async function isAdminEdge(userEmail: string | null, userId: string | null): Promise<boolean> {
    if (!userEmail && !userId) return false;

    const key = `${userEmail?.toLowerCase() ?? ""}|${userId ?? ""}`;
    const now = Date.now();
    const hit = adminCache.get(key);
    if (hit && hit.expires > now) return hit.value;

    const supabase = getClient();

    const filters: string[] = [];
    if (userEmail) filters.push(`email.eq.${userEmail.toLowerCase()}`);
    if (userId) filters.push(`clerk_id.eq.${userId}`);

    const { data } = await supabase
        .from("admin_users")
        .select("id")
        .or(filters.join(","))
        .maybeSingle();

    const value = !!data;
    adminCache.set(key, { value, expires: now + ADMIN_TTL_MS });
    return value;
}

export async function hasActiveSubscriptionEdge(clientId: string): Promise<EdgeAccessResult> {
    const now = Date.now();
    const hit = subCache.get(clientId);
    if (hit && hit.expires > now) return hit.value;

    const supabase = getClient();

    const { data: client } = await supabase
        .from("clients")
        .select("id, account_type, subscription_grandfathered")
        .eq("id", clientId)
        .maybeSingle();

    if (!client) {
        const result: EdgeAccessResult = { allowed: false, reason: "client_not_found" };
        subCache.set(clientId, { value: result, expires: now + SUB_TTL_MS });
        return result;
    }
    if ((client as { subscription_grandfathered: boolean }).subscription_grandfathered) {
        const result: EdgeAccessResult = { allowed: true };
        subCache.set(clientId, { value: result, expires: now + SUB_TTL_MS });
        return result;
    }
    if ((client as { account_type: string }).account_type === "CUSTOM") {
        const result: EdgeAccessResult = { allowed: true };
        subCache.set(clientId, { value: result, expires: now + SUB_TTL_MS });
        return result;
    }

    const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "past_due", "admin_granted"])
        .maybeSingle();

    let result: EdgeAccessResult;
    if (!sub) {
        result = { allowed: false, reason: "no_subscription" };
    } else {
        const status = (sub as { status: string }).status;
        if (status === "active" || status === "trialing" || status === "admin_granted") {
            result = { allowed: true };
        } else if (status === "past_due") {
            result = { allowed: false, reason: "past_due" };
        } else {
            result = { allowed: false, reason: "canceled" };
        }
    }
    subCache.set(clientId, { value: result, expires: now + SUB_TTL_MS });
    return result;
}
