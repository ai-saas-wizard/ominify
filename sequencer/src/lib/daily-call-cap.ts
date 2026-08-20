import { formatInTimeZone } from 'date-fns-tz';
import { redis } from './redis.js';

/**
 * Per-sequence daily voice-call cap.
 *
 * The scheduler reserves one unit at the moment it decides to dispatch a voice
 * step and stamps the key onto the VAPI job; the worker gives the unit back if
 * the call is abandoned before it is placed. The counter therefore tracks
 * intended dials, not enrollments processed.
 *
 * The day key is formatted in the TENANT's timezone, so "150 calls today"
 * means the operator's calendar day rather than UTC's.
 */

// Two days, so a counter written just before midnight tenant-time is still
// around for the rest of that local day (and for post-hoc debugging).
const KEY_TTL_SECONDS = 48 * 60 * 60;

export function dailyCallCapKey(sequenceId: string, timezone: string, now: Date = new Date()): string {
    return `seq:daily-calls:${sequenceId}:${formatInTimeZone(now, timezone, 'yyyyMMdd')}`;
}

// One atomic script: no transient over-count between INCR and the corrective
// DECR, and a single round-trip per reservation attempt.
const RESERVE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if n > tonumber(ARGV[1]) then
    redis.call('DECR', KEYS[1])
    return 0
end
return 1
`;

// Floor at zero so a stray double-release can never open extra slots.
const RELEASE_LUA = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v > 0 then redis.call('DECR', KEYS[1]) end
`;

/**
 * Atomically reserve one call against the cap. Returns false when today's
 * cap is already spent.
 */
export async function reserveDailyCall(key: string, cap: number): Promise<boolean> {
    const result = await redis.eval(RESERVE_LUA, 1, key, String(cap), String(KEY_TTL_SECONDS));
    return result === 1;
}

/** Give back a reservation for a call that was never placed. Never throws. */
export async function releaseDailyCall(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
        await redis.eval(RELEASE_LUA, 1, key);
    } catch (err) {
        console.error(`[DAILY-CAP] Failed to release reservation ${key}:`, err);
    }
}
