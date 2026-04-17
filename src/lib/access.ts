import "server-only";
import { supabase } from "./supabase";
import { getActiveSubscription } from "./subscriptions";

/**
 * Single source of truth for whether a client may access the paywalled
 * dashboard and whether a call may be placed on their behalf.
 *
 *   hasActiveSubscription — gates dashboard access.
 *       Grandfathered clients bypass. CUSTOM (admin-created) clients
 *       bypass. Everyone else needs a live `subscriptions` row.
 *
 *   canPlaceCall — hasActiveSubscription AND (subscription+topup > 0).
 *       Call-blocking at zero applies to ALL clients.
 */

export type AccessAllowed = { allowed: true };
export type AccessDenied = {
    allowed: false;
    reason:
        | "no_subscription"
        | "past_due"
        | "canceled"
        | "no_minutes"
        | "client_not_found";
};
export type AccessResult = AccessAllowed | AccessDenied;

export async function hasActiveSubscription(
    clientId: string
): Promise<AccessResult> {
    const { data: client } = await supabase
        .from("clients")
        .select("id, account_type, subscription_grandfathered")
        .eq("id", clientId)
        .maybeSingle();

    if (!client) return { allowed: false, reason: "client_not_found" };

    // Grandfathered — existing clients before the paywall rolled out,
    // or comped accounts flipped on by admin.
    if (client.subscription_grandfathered) return { allowed: true };

    // Admin-created CUSTOM clients bypass the subscription gate.
    if (client.account_type === "CUSTOM") return { allowed: true };

    const sub = await getActiveSubscription(clientId);
    if (!sub) return { allowed: false, reason: "no_subscription" };

    if (sub.status === "active" || sub.status === "trialing" || sub.status === "admin_granted") {
        return { allowed: true };
    }
    if (sub.status === "past_due") {
        return { allowed: false, reason: "past_due" };
    }
    // canceled | unpaid | incomplete | incomplete_expired | paused
    return { allowed: false, reason: "canceled" };
}

export async function canPlaceCall(clientId: string): Promise<AccessResult> {
    const subAccess = await hasActiveSubscription(clientId);
    if (!subAccess.allowed) return subAccess;

    // Minute check applies to everyone, including grandfathered + CUSTOM.
    const { data: bal } = await supabase
        .from("minute_balances")
        .select("balance_minutes, subscription_minutes")
        .eq("client_id", clientId)
        .maybeSingle();

    const total =
        Number(bal?.balance_minutes ?? 0) + Number(bal?.subscription_minutes ?? 0);

    if (total <= 0) return { allowed: false, reason: "no_minutes" };
    return { allowed: true };
}
