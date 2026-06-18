import { redis } from './redis.js';

/**
 * Redis-backed once-only claims (review C5).
 *
 * Send workers claim `send:{enrollmentId}:{stepId}` BEFORE calling the
 * provider; a duplicate dispatch of the same step (lease expiry, crash
 * between send and advance, BullMQ stalled-job retry) then skips the
 * provider call instead of double-messaging the lead. On provider
 * failure the claim is released so a legitimate retry can proceed.
 */
export async function claimOnce(key: string, ttlSeconds = 24 * 60 * 60): Promise<boolean> {
    const result = await redis.set(`seq:once:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
}

export async function releaseClaim(key: string): Promise<void> {
    await redis.del(`seq:once:${key}`);
}
