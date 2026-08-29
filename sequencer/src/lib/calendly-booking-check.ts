/**
 * Calendly booked-meeting check (dispatch-time poll).
 *
 * A lead who books directly on the tenant's Calendly page — via the booking
 * link we text/email — never tells Omnify, so follow-ups kept firing at
 * people who already booked. The AI-booked path flips the enrollment to
 * 'booked'; this module gives the scheduler the same signal for external
 * bookings, queried straight from Calendly right before a follow-up sends.
 *
 * Only works for tenants with an active tenant_calendly connection (PAT from
 * Settings → Integrations). Fail-open by design: any config/API problem
 * returns 'unavailable' and the send proceeds — a Calendly outage must not
 * freeze campaigns.
 */
import { supabase } from './db.js';
import { redis } from './redis.js';
import { decrypt } from './encryption.js';

const CALENDLY_API = 'https://api.calendly.com';
// A lead who hasn't booked is re-checked at most every 15 minutes, so
// parking/retry churn in the scheduler never hammers Calendly's rate limit.
const NEGATIVE_CACHE_TTL_SECONDS = 15 * 60;
const FETCH_TIMEOUT_MS = 8000;

export type CalendlyBookedResult = 'booked' | 'not_booked' | 'unavailable';

export async function checkLeadBookedOnCalendly(
    tenantId: string,
    contactEmail: string | null | undefined,
    enrolledAt: string
): Promise<CalendlyBookedResult> {
    const email = (contactEmail || '').trim().toLowerCase();
    if (!email) return 'unavailable';

    const minStart = new Date(enrolledAt);
    if (Number.isNaN(minStart.getTime())) return 'unavailable';

    const cacheKey = `calendly:not-booked:${tenantId}:${email}`;
    try {
        if (await redis.get(cacheKey)) return 'not_booked';
    } catch (err) {
        console.warn('[CALENDLY-CHECK] Redis read failed (continuing uncached):', err);
    }

    const { data: conn, error: connErr } = await supabase
        .from('tenant_calendly')
        .select('calendly_pat_encrypted, calendly_user_uri')
        .eq('client_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

    if (connErr) {
        console.warn(`[CALENDLY-CHECK] tenant_calendly lookup failed for ${tenantId}:`, connErr);
        return 'unavailable';
    }
    if (!conn?.calendly_pat_encrypted || !conn.calendly_user_uri) return 'unavailable';

    let pat = '';
    try {
        pat = decrypt(conn.calendly_pat_encrypted);
    } catch (err) {
        console.warn(`[CALENDLY-CHECK] PAT decrypt failed for tenant ${tenantId}:`, err);
        return 'unavailable';
    }
    if (!pat) return 'unavailable';

    // min_start_time = enrolled_at: catches meetings booked mid-sequence even
    // if they've already happened, ignores pre-enrollment history.
    // status=active excludes canceled bookings.
    const params = new URLSearchParams({
        user: conn.calendly_user_uri,
        invitee_email: email,
        status: 'active',
        min_start_time: minStart.toISOString(),
        count: '1',
    });

    try {
        const res = await fetch(`${CALENDLY_API}/scheduled_events?${params.toString()}`, {
            headers: { Authorization: `Bearer ${pat}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[CALENDLY-CHECK] API ${res.status} for tenant ${tenantId} — failing open`);
            return 'unavailable';
        }
        const body = (await res.json()) as { collection?: unknown[] };
        if (Array.isArray(body.collection) && body.collection.length > 0) {
            return 'booked';
        }
    } catch (err) {
        console.warn(`[CALENDLY-CHECK] API call failed for tenant ${tenantId} — failing open:`, err);
        return 'unavailable';
    }

    try {
        await redis.set(cacheKey, '1', 'EX', NEGATIVE_CACHE_TTL_SECONDS);
    } catch {
        // Cache is best-effort; worst case we ask Calendly again next tick.
    }
    return 'not_booked';
}
