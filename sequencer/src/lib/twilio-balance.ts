/**
 * Twilio balance + failure alerts.
 *
 * Why: on 2026-09-01 a tenant's Twilio balance hit $0. SMS failed
 * "Authenticate" for five hours and a VAPI start error leaked a concurrency
 * slot that silently stopped every outbound call — and nobody was told.
 *
 * Three signals feed the in-app notification center (tenant_notifications):
 *   - twilio_low_balance  proactive: checkTwilioBalances() polls BYOA tenants'
 *                         balance every 30 min (analytics-worker) and alerts
 *                         once per threshold crossing (warn < $25, critical < $10)
 *   - twilio_auth_failed  reactive: sms-worker calls notifyTwilioAuthFailure()
 *                         the moment Twilio rejects a send with 401/20003/20005
 *   - calls_failing       reactive: vapi-worker's start-error verification
 *                         calls notifyCallsFailing() when a call dies before
 *                         it starts (e.g. call.start.error-get-transport)
 *
 * Type-B sub-account tenants are skipped by the poll: their credentials do
 * not authenticate against the Balance endpoint and they share the platform
 * master balance (master creds live only in the Next.js app env).
 */

import { supabase } from './db.js';
import { decrypt } from './encryption.js';
import { claimOnce } from './idempotency.js';
import { createNotification } from './emotional-intelligence.js';
import { resolveTwilioAccountSid } from './twilio-account.js';

export const BALANCE_WARN_USD = 25;
export const BALANCE_CRITICAL_USD = 10;
const ALERT_DEDUP_SECONDS = 60 * 60;

type LowBalanceLevel = 'warn' | 'critical' | null;

function levelFor(balance: number): LowBalanceLevel {
    if (balance < BALANCE_CRITICAL_USD) return 'critical';
    if (balance < BALANCE_WARN_USD) return 'warn';
    return null;
}

/** Twilio's REST client and raw fetch both surface these on a suspended account. */
export function isTwilioAuthError(err: unknown): boolean {
    const e = err as { status?: number; code?: number; message?: string } | null;
    if (!e) return false;
    return (
        e.status === 401 ||
        e.code === 20003 ||
        e.code === 20005 ||
        /\bauthenticate\b/i.test(e.message || '')
    );
}

interface TwilioAccountRow {
    id: string;
    client_id: string;
    account_type: string;
    subaccount_sid: string | null;
    external_account_sid: string | null;
    auth_token_encrypted: string | null;
    low_balance_level: LowBalanceLevel;
}

/** Fetch the account balance. Throws with `.status` on HTTP errors. */
export async function fetchTwilioBalance(
    accountSid: string,
    authToken: string,
): Promise<{ balance: number; currency: string }> {
    const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Balance.json`, {
        headers: { Authorization: auth },
    });
    const body = (await res.json().catch(() => ({}))) as {
        balance?: string;
        currency?: string;
        message?: string;
        code?: number;
    };
    if (!res.ok) {
        const err = new Error(body.message || `Twilio balance HTTP ${res.status}`) as Error & {
            status: number;
            code?: number;
        };
        err.status = res.status;
        err.code = body.code;
        throw err;
    }
    const balance = Number(body.balance);
    if (!Number.isFinite(balance)) throw new Error(`Unparseable Twilio balance: ${body.balance}`);
    return { balance, currency: body.currency || 'USD' };
}

/**
 * Poll every active BYOA tenant's Twilio balance, persist it, and notify on
 * threshold crossings. Safe to run repeatedly: notifications fire only when
 * the level changes (null→warn, warn→critical, or a fresh dip after the
 * balance recovered above the warn line).
 */
export async function checkTwilioBalances(): Promise<{ checked: number; alerted: number }> {
    const { data: accounts, error } = await supabase
        .from('tenant_twilio_accounts')
        .select('id, client_id, account_type, subaccount_sid, external_account_sid, auth_token_encrypted, low_balance_level')
        .eq('status', 'active')
        .eq('account_type', 'type_a_byoa');
    if (error) {
        console.error('[TWILIO-BALANCE] Failed to list accounts:', error.message);
        return { checked: 0, alerted: 0 };
    }

    let checked = 0;
    let alerted = 0;
    for (const row of (accounts || []) as TwilioAccountRow[]) {
        const sid = resolveTwilioAccountSid(row);
        if (!sid || !row.auth_token_encrypted) continue;

        let result: { balance: number; currency: string };
        try {
            result = await fetchTwilioBalance(sid, decrypt(row.auth_token_encrypted));
        } catch (err) {
            if (isTwilioAuthError(err)) {
                console.warn(`[TWILIO-BALANCE] Tenant ${row.client_id}: credentials rejected (401)`);
                await notifyTwilioAuthFailure(row.client_id, err);
            } else {
                console.error(`[TWILIO-BALANCE] Tenant ${row.client_id}: balance check failed:`, (err as Error).message);
            }
            continue;
        }
        checked++;

        const level = levelFor(result.balance);
        const previous = row.low_balance_level ?? null;
        const escalated =
            level !== null &&
            level !== previous &&
            !(previous === 'critical' && level === 'warn'); // partial recharge: still low, already told

        await supabase
            .from('tenant_twilio_accounts')
            .update({
                last_balance: result.balance,
                last_balance_currency: result.currency,
                last_balance_at: new Date().toISOString(),
                low_balance_level: level,
            })
            .eq('id', row.id);

        if (escalated) {
            const amount = `$${result.balance.toFixed(2)}`;
            await createNotification({
                clientId: row.client_id,
                type: 'twilio_low_balance',
                priority: level === 'critical' ? 'urgent' : 'high',
                title: level === 'critical'
                    ? `Twilio balance critical: ${amount}`
                    : `Twilio balance low: ${amount}`,
                body: `Calls and texts stop when your Twilio balance hits $0. Add funds in your Twilio console to keep outreach running.`,
                metadata: { balance: result.balance, currency: result.currency, level },
            });
            alerted++;
            console.log(`[TWILIO-BALANCE] Tenant ${row.client_id}: ${level} at ${amount} — notified`);
        } else {
            console.log(`[TWILIO-BALANCE] Tenant ${row.client_id}: $${result.balance.toFixed(2)} (${level ?? 'ok'})`);
        }
    }
    return { checked, alerted };
}

/**
 * Twilio rejected our credentials (401 / 20003 / 20005) — almost always an
 * exhausted balance (account suspended) or a rotated auth token. Deduped to
 * one notification per tenant per hour.
 */
export async function notifyTwilioAuthFailure(tenantId: string, err?: unknown): Promise<boolean> {
    await supabase
        .from('tenant_twilio_accounts')
        .update({ last_auth_error_at: new Date().toISOString() })
        .eq('client_id', tenantId)
        .eq('status', 'active');

    if (!(await claimOnce(`notif:twilio_auth:${tenantId}`, ALERT_DEDUP_SECONDS))) return false;

    const detail = (err as { message?: string } | null)?.message;
    await createNotification({
        clientId: tenantId,
        type: 'twilio_auth_failed',
        priority: 'urgent',
        title: 'Twilio is rejecting sends — texts are failing',
        body:
            'Twilio returned "Authenticate" for this account. That usually means the balance ran out ' +
            '(the account is suspended) or the auth token changed. Recharge or update the credentials.',
        metadata: { error: detail || null },
    });
    return true;
}

/**
 * A VAPI call died before it started (e.g. call.start.error-get-transport,
 * which is what an empty Twilio balance looks like from VAPI's side).
 * Deduped to one notification per tenant per hour.
 */
export async function notifyCallsFailing(tenantId: string, endedReason: string): Promise<boolean> {
    if (!(await claimOnce(`notif:calls_failing:${tenantId}`, ALERT_DEDUP_SECONDS))) return false;
    await createNotification({
        clientId: tenantId,
        type: 'calls_failing',
        priority: 'urgent',
        title: 'Calls are failing to start',
        body:
            `The phone provider could not connect an outbound call (${endedReason}). ` +
            'Check your Twilio balance and phone number status; affected leads are automatically retried.',
        metadata: { endedReason },
    });
    return true;
}
