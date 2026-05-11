import "server-only";
import type Stripe from "stripe";
import { supabase } from "./supabase";

/**
 * Subscription helpers. Plan catalog moved to `pricing_tiers` (DB-backed) —
 * see `src/lib/pricing-tiers.ts`. The `plan_key` column on subscriptions
 * stores the tier slug (free-text) for per-subscription audit history.
 */

export interface SubscriptionRow {
    id: string;
    client_id: string;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    status:
        | "active"
        | "trialing"
        | "past_due"
        | "incomplete"
        | "incomplete_expired"
        | "canceled"
        | "unpaid"
        | "paused"
        | "admin_granted";
    plan_key: string;
    price_id: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at: string | null;
    canceled_at: string | null;
    created_at: string;
    updated_at: string;
}

const ACTIVE_LIKE_STATUSES: SubscriptionRow["status"][] = [
    "active",
    "trialing",
    "past_due",
    "admin_granted",
];

/**
 * Return the currently-live subscription row for a client (one of:
 * active, trialing, past_due, admin_granted). Returns null if none.
 */
export async function getActiveSubscription(
    clientId: string
): Promise<SubscriptionRow | null> {
    const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("client_id", clientId)
        .in("status", ACTIVE_LIKE_STATUSES)
        .maybeSingle();
    return (data as SubscriptionRow | null) ?? null;
}

/**
 * Resolve an Omnify clientId from a Stripe subscription or customer ID.
 * Metadata.clientId is preferred; falls back to joining via
 * client_billing.stripe_customer_id.
 */
export async function resolveClientFromStripeIds(args: {
    clientIdFromMetadata?: string | null;
    stripeCustomerId?: string | null;
}): Promise<string | null> {
    if (args.clientIdFromMetadata) return args.clientIdFromMetadata;

    if (args.stripeCustomerId) {
        const { data } = await supabase
            .from("client_billing")
            .select("client_id")
            .eq("stripe_customer_id", args.stripeCustomerId)
            .maybeSingle();
        if (data?.client_id) return data.client_id as string;
    }
    return null;
}

function isoFromUnix(sec: number | null | undefined): string | null {
    if (!sec && sec !== 0) return null;
    return new Date(sec * 1000).toISOString();
}

/**
 * Upsert a `subscriptions` row from a Stripe Subscription object.
 * Looked up by stripe_subscription_id.
 */
export async function upsertSubscription(
    sub: Stripe.Subscription,
    clientId: string,
    planKey: string
): Promise<SubscriptionRow> {
    const item = sub.items.data[0];
    const priceId = item?.price?.id ?? null;

    // In Stripe API 2025-12-15.clover, `current_period_start` / `_end` live
    // on the subscription ITEM, not on the subscription object. Read from
    // the item with a strict typed cast. If `item` is missing (incomplete
    // subscription with no items), both fields are null — caller code
    // should handle that as "no known period yet."
    const itemPeriod = item as unknown as {
        current_period_start?: number | null;
        current_period_end?: number | null;
    } | undefined;

    const row = {
        client_id: clientId,
        stripe_subscription_id: sub.id,
        stripe_customer_id:
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        status: sub.status as SubscriptionRow["status"],
        plan_key: planKey,
        price_id: priceId,
        current_period_start: isoFromUnix(itemPeriod?.current_period_start ?? null),
        current_period_end: isoFromUnix(itemPeriod?.current_period_end ?? null),
        cancel_at: isoFromUnix(sub.cancel_at),
        canceled_at: isoFromUnix(sub.canceled_at),
        updated_at: new Date().toISOString(),
    };

    // Upsert by stripe_subscription_id (unique).
    const { data, error } = await supabase
        .from("subscriptions")
        .upsert(row, { onConflict: "stripe_subscription_id" })
        .select()
        .single();

    if (error) throw new Error(`Failed to upsert subscription: ${error.message}`);
    return data as SubscriptionRow;
}

/**
 * Mark a Stripe subscription canceled (used by customer.subscription.deleted).
 */
export async function markSubscriptionCanceled(
    stripeSubscriptionId: string
): Promise<void> {
    await supabase
        .from("subscriptions")
        .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", stripeSubscriptionId);
}

/**
 * Grant monthly subscription minutes with a rollover cap.
 * Idempotent by (client_id, kind, stripe_invoice_id).
 *
 * If adding `minutes` to the existing subscription bucket would exceed
 * `rolloverCap`, the excess is trimmed and a `subscription_rollover_trim`
 * ledger row is written for audit.
 */
export async function grantSubscriptionMinutes(params: {
    clientId: string;
    minutes: number;
    rolloverCap: number;
    stripeInvoiceId: string | null;
    amountPaid: number;
}): Promise<{ granted: number; trimmed: number } | null> {
    const { clientId, minutes, rolloverCap, stripeInvoiceId, amountPaid } = params;

    // Idempotency: if an invoice is known, short-circuit if we already granted.
    if (stripeInvoiceId) {
        const { data: existing } = await supabase
            .from("minute_purchases")
            .select("id")
            .eq("client_id", clientId)
            .eq("kind", "subscription_grant")
            .eq("stripe_invoice_id", stripeInvoiceId)
            .maybeSingle();
        if (existing) return null;
    }

    // Load the balance row (create if missing).
    const { data: existingBalance } = await supabase
        .from("minute_balances")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();

    let balance = existingBalance as
        | {
              client_id: string;
              balance_minutes: number;
              subscription_minutes: number;
              total_purchased_minutes: number;
              total_used_minutes: number;
              subscription_rollover_cap: number;
          }
        | null;

    if (!balance) {
        const { data: created, error } = await supabase
            .from("minute_balances")
            .insert({
                client_id: clientId,
                balance_minutes: 0,
                subscription_minutes: 0,
                total_purchased_minutes: 0,
                total_used_minutes: 0,
                subscription_rollover_cap: rolloverCap,
            })
            .select()
            .single();
        if (error || !created) throw new Error(`Failed to init balance: ${error?.message}`);
        balance = created as typeof balance;
    }

    const currentSub = Number(balance!.subscription_minutes) || 0;
    const cap = Number(balance!.subscription_rollover_cap) || rolloverCap;
    const target = Math.min(cap, currentSub + minutes);
    const granted = Math.max(0, target - currentSub);
    const trimmed = minutes - granted;

    // Update the balance bucket + cap (in case the plan's cap changed).
    await supabase
        .from("minute_balances")
        .update({
            subscription_minutes: target,
            subscription_rollover_cap: rolloverCap,
            last_subscription_grant_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    // Audit row for the grant.
    await supabase.from("minute_purchases").insert({
        client_id: clientId,
        minutes_purchased: granted,
        amount_paid: amountPaid,
        status: "completed",
        kind: "subscription_grant",
        stripe_invoice_id: stripeInvoiceId,
    });

    // Audit row for any trimmed rollover (informational — zero dollars).
    if (trimmed > 0) {
        await supabase.from("minute_purchases").insert({
            client_id: clientId,
            minutes_purchased: trimmed,
            amount_paid: 0,
            status: "completed",
            kind: "subscription_rollover_trim",
            stripe_invoice_id: stripeInvoiceId,
        });
    }

    return { granted, trimmed };
}

/**
 * Deduct minutes across both buckets: subscription first, then top-up.
 * Returns how much came out of each bucket and any unmet shortfall.
 *
 * Subscription-first order ensures the rollover cap is a meaningful ceiling:
 * if we deducted from top-up first, subscription minutes would stockpile
 * forever.
 */
export async function deductFromBuckets(
    clientId: string,
    minutes: number
): Promise<{
    deductedFromSubscription: number;
    deductedFromTopup: number;
    shortfall: number;
    newBalance: { subscription: number; topup: number };
}> {
    const { data: existing } = await supabase
        .from("minute_balances")
        .select("subscription_minutes, balance_minutes, total_used_minutes")
        .eq("client_id", clientId)
        .maybeSingle();

    const sub = Number(existing?.subscription_minutes ?? 0);
    const top = Number(existing?.balance_minutes ?? 0);
    const totalUsed = Number(existing?.total_used_minutes ?? 0);

    const fromSub = Math.min(sub, minutes);
    const remaining = minutes - fromSub;
    const fromTop = Math.min(top, remaining);
    const shortfall = remaining - fromTop;

    const newSub = sub - fromSub;
    const newTop = top - fromTop;

    await supabase
        .from("minute_balances")
        .update({
            subscription_minutes: newSub,
            balance_minutes: newTop,
            total_used_minutes: totalUsed + fromSub + fromTop,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return {
        deductedFromSubscription: fromSub,
        deductedFromTopup: fromTop,
        shortfall,
        newBalance: { subscription: newSub, topup: newTop },
    };
}
