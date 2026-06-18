/**
 * Access gate for the sequencer worker.
 *
 * Mirrors the logic in /src/lib/access.ts on the Next.js side. Duplicated here
 * because the sequencer is a separate package that can't import from @/lib.
 * Both implementations read the same Postgres tables, so they stay in sync
 * by construction.
 */

import { supabase } from './db.js';

export type AccessResult =
    | { allowed: true }
    | {
          allowed: false;
          reason: 'no_subscription' | 'past_due' | 'canceled' | 'no_minutes' | 'client_not_found';
      };

const ACTIVE_LIKE = ['active', 'trialing', 'admin_granted'];

export async function canPlaceCall(clientId: string): Promise<AccessResult> {
    // Load client + balance + live subscription in parallel.
    const [clientRes, balRes, subRes] = await Promise.all([
        supabase
            .from('clients')
            .select('id, account_type, subscription_grandfathered')
            .eq('id', clientId)
            .maybeSingle(),
        supabase
            .from('minute_balances')
            .select('balance_minutes, subscription_minutes')
            .eq('client_id', clientId)
            .maybeSingle(),
        // .maybeSingle() errored when a client had 2+ matching subscription
        // rows (e.g. an old past_due next to a new active one) and the error
        // silently blocked every call. Take the newest matching row instead.
        supabase
            .from('subscriptions')
            .select('status')
            .eq('client_id', clientId)
            .in('status', ['active', 'trialing', 'past_due', 'admin_granted'])
            .order('created_at', { ascending: false })
            .limit(1),
    ]);

    const client = clientRes.data as
        | { id: string; account_type: string; subscription_grandfathered: boolean }
        | null;
    if (!client) return { allowed: false, reason: 'client_not_found' };

    // Subscription gate — skippable for grandfathered + CUSTOM.
    if (!client.subscription_grandfathered && client.account_type !== 'CUSTOM') {
        const sub = ((subRes.data as Array<{ status: string }> | null)?.[0]) ?? null;
        if (!sub) return { allowed: false, reason: 'no_subscription' };
        if (sub.status === 'past_due') return { allowed: false, reason: 'past_due' };
        if (!ACTIVE_LIKE.includes(sub.status)) return { allowed: false, reason: 'canceled' };
    }

    // Minute gate — applies to everyone.
    const bal = balRes.data as
        | { balance_minutes: number; subscription_minutes: number }
        | null;
    const total = Number(bal?.balance_minutes ?? 0) + Number(bal?.subscription_minutes ?? 0);
    if (total <= 0) return { allowed: false, reason: 'no_minutes' };

    return { allowed: true };
}
