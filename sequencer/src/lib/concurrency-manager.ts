/**
 * VAPI Umbrella Concurrency Manager
 * 
 * Manages concurrency at the UMBRELLA level (not per-tenant).
 * Uses Redis atomic Lua scripts for safe concurrent access.
 * 
 * Key features:
 * - Track concurrency per umbrella (VAPI account)
 * - Per-tenant soft caps within shared umbrellas
 * - Sync from VAPI webhook ground truth
 */

import { redis } from './redis.js';

export class VapiUmbrellaConcurrencyManager {

    // Redis key for umbrella-level concurrency
    private umbrellaKey(umbrellaId: string): string {
        return `vapi:umbrella:${umbrellaId}`;
    }

    // Track per-tenant usage WITHIN the umbrella (for fair sharing)
    private tenantUsageKey(umbrellaId: string): string {
        return `vapi:umbrella:${umbrellaId}:tenant_usage`;
    }

    // ZSET of in-flight slot tokens (member "tenantId:token", score = acquired-at ms).
    // Used by reconcileStaleSlots to reclaim slots whose call-outcome webhook was lost.
    private slotsKey(umbrellaId: string): string {
        return `vapi:umbrella:${umbrellaId}:slots`;
    }

    // SET of every umbrella id that has ever acquired a slot (sweep targets)
    private knownUmbrellasKey(): string {
        return 'vapi:umbrellas:known';
    }

    private slotMember(tenantId: string, token: string): string {
        return `${tenantId}:${token}`;
    }

    /**
     * Try to acquire a concurrency slot within the umbrella.
     * Checks both:
     *   1. Umbrella-level total concurrency
     *   2. Per-tenant soft cap (if set)
     *
     * `token` (the enrollmentId) registers the slot in a ZSET so stale slots
     * can be reclaimed if the release webhook is lost. Optional for backward
     * compatibility — when omitted, token bookkeeping is skipped.
     *
     * Returns: 1 = acquired, 0 = umbrella full, -1 = tenant cap hit
     */
    async tryAcquire(
        umbrellaId: string,
        tenantId: string,
        umbrellaLimit: number,
        tenantCap: number | null,
        token?: string
    ): Promise<{ acquired: boolean; reason?: 'umbrella_full' | 'tenant_cap' }> {
        const umbrellaKey = this.umbrellaKey(umbrellaId);
        const tenantUsageKey = this.tenantUsageKey(umbrellaId);
        const slotsKey = this.slotsKey(umbrellaId);
        const knownKey = this.knownUmbrellasKey();

        // Atomic Lua: check umbrella limit + tenant cap, then increment both
        // (and register the slot token + known umbrella for reconciliation)
        const script = `
            local umbrella_current = tonumber(redis.call('hget', KEYS[1], 'current') or '0')
            local umbrella_limit = tonumber(ARGV[1])

            -- Check umbrella-level capacity
            if umbrella_current >= umbrella_limit then
                return 0
            end

            -- Check per-tenant soft cap (if set)
            local tenant_cap = tonumber(ARGV[2])
            if tenant_cap > 0 then
                local tenant_current = tonumber(redis.call('hget', KEYS[2], ARGV[3]) or '0')
                if tenant_current >= tenant_cap then
                    return -1
                end
            end

            -- Acquire: increment both umbrella total and tenant usage
            redis.call('hincrby', KEYS[1], 'current', 1)
            redis.call('hincrby', KEYS[2], ARGV[3], 1)

            -- Slot-token bookkeeping for stale-slot reconciliation
            if ARGV[4] ~= '' then
                redis.call('zadd', KEYS[3], ARGV[5], ARGV[4])
            end
            redis.call('sadd', KEYS[4], ARGV[6])
            return 1
        `;

        const result = await redis.eval(
            script,
            4,
            umbrellaKey,
            tenantUsageKey,
            slotsKey,
            knownKey,
            umbrellaLimit.toString(),
            (tenantCap || 0).toString(),
            tenantId,
            token ? this.slotMember(tenantId, token) : '',
            Date.now().toString(),
            umbrellaId
        ) as number;

        if (result === 1) {
            return { acquired: true };
        } else if (result === 0) {
            return { acquired: false, reason: 'umbrella_full' };
        } else {
            return { acquired: false, reason: 'tenant_cap' };
        }
    }

    /**
     * Release a concurrency slot (called when call ends).
     * Pass the same `token` used at acquire time to clear its ZSET entry;
     * optional for backward compatibility (omitted = skip token bookkeeping).
     */
    async release(umbrellaId: string, tenantId: string, token?: string): Promise<void> {
        const umbrellaKey = this.umbrellaKey(umbrellaId);
        const tenantUsageKey = this.tenantUsageKey(umbrellaId);
        const slotsKey = this.slotsKey(umbrellaId);

        const script = `
            -- When a token is provided, the ZREM result makes the release
            -- idempotent: a retried event job (or the stale-slot sweep racing
            -- a real release) finds the member already gone and must NOT
            -- decrement the counters a second time.
            if ARGV[2] ~= '' then
                local removed = redis.call('zrem', KEYS[3], ARGV[2])
                if removed == 0 then
                    return 0
                end
            end

            -- Decrement umbrella total (floor at 0)
            local current = tonumber(redis.call('hget', KEYS[1], 'current') or '0')
            if current > 0 then
                redis.call('hincrby', KEYS[1], 'current', -1)
            end

            -- Decrement tenant usage (floor at 0)
            local tenant_current = tonumber(redis.call('hget', KEYS[2], ARGV[1]) or '0')
            if tenant_current > 0 then
                redis.call('hincrby', KEYS[2], ARGV[1], -1)
            end
            return 1
        `;

        await redis.eval(
            script,
            3,
            umbrellaKey,
            tenantUsageKey,
            slotsKey,
            tenantId,
            token ? this.slotMember(tenantId, token) : ''
        );
    }

    /**
     * Reclaim slots whose release webhook never arrived (review workers I5).
     *
     * For every known umbrella, finds slot tokens older than `maxAgeMs`
     * (default 2h — far beyond any real call) and atomically decrements the
     * umbrella total + tenant usage (floor 0) and removes the token. A token
     * released normally between the scan and the reclaim is skipped (the Lua
     * script re-checks ZSCORE before touching counters).
     *
     * Returns the number of slots reclaimed across all umbrellas.
     */
    async reconcileStaleSlots(maxAgeMs: number = 2 * 60 * 60 * 1000): Promise<number> {
        const cutoff = Date.now() - maxAgeMs;
        const umbrellaIds = await redis.smembers(this.knownUmbrellasKey());
        let reclaimed = 0;

        // Atomic per-member reclaim: only reclaim if the member still exists
        // AND is still stale (guards against racing a legitimate release).
        const script = `
            local score = redis.call('zscore', KEYS[1], ARGV[1])
            if not score then
                return 0
            end
            if tonumber(score) > tonumber(ARGV[2]) then
                return 0
            end
            redis.call('zrem', KEYS[1], ARGV[1])

            local current = tonumber(redis.call('hget', KEYS[2], 'current') or '0')
            if current > 0 then
                redis.call('hincrby', KEYS[2], 'current', -1)
            end

            local tenant_current = tonumber(redis.call('hget', KEYS[3], ARGV[3]) or '0')
            if tenant_current > 0 then
                redis.call('hincrby', KEYS[3], ARGV[3], -1)
            end
            return 1
        `;

        for (const umbrellaId of umbrellaIds) {
            const slotsKey = this.slotsKey(umbrellaId);
            const staleMembers = await redis.zrangebyscore(slotsKey, '-inf', cutoff);

            for (const member of staleMembers) {
                // Member format: "tenantId:token" — tenant id is everything before the first colon
                const tenantId = member.split(':')[0];
                const result = await redis.eval(
                    script,
                    3,
                    slotsKey,
                    this.umbrellaKey(umbrellaId),
                    this.tenantUsageKey(umbrellaId),
                    member,
                    cutoff.toString(),
                    tenantId
                ) as number;

                if (result === 1) {
                    reclaimed++;
                    console.log(`[CONCURRENCY] Reclaimed stale slot ${member} on umbrella ${umbrellaId}`);
                }
            }
        }

        return reclaimed;
    }

    /**
     * Sync from VAPI webhook (ground truth correction)
     * VAPI reports concurrency at the ACCOUNT level — this is the umbrella level
     */
    async syncFromWebhook(
        umbrellaId: string,
        reportedConcurrency: number,
        reportedLimit: number
    ): Promise<void> {
        await redis.hmset(this.umbrellaKey(umbrellaId), {
            current: reportedConcurrency.toString(),
            limit: reportedLimit.toString(),
            last_sync: Date.now().toString(),
        });
    }

    /**
     * Get current state for monitoring/health check
     */
    async getUmbrellaState(umbrellaId: string): Promise<{
        current: number;
        limit: number;
        lastSync: number | null;
        tenantBreakdown: Record<string, number>;
    }> {
        const umbrella = await redis.hgetall(this.umbrellaKey(umbrellaId));
        const tenantUsage = await redis.hgetall(this.tenantUsageKey(umbrellaId));

        return {
            current: parseInt(umbrella.current || '0'),
            limit: parseInt(umbrella.limit || '10'),
            lastSync: umbrella.last_sync ? parseInt(umbrella.last_sync) : null,
            tenantBreakdown: Object.fromEntries(
                Object.entries(tenantUsage).map(([k, v]) => [k, parseInt(v as string)])
            ),
        };
    }

    /**
     * Initialize umbrella limit in Redis (call on startup or when umbrella is created)
     */
    async initializeUmbrella(umbrellaId: string, limit: number): Promise<void> {
        const key = this.umbrellaKey(umbrellaId);
        const exists = await redis.exists(key);

        if (!exists) {
            await redis.hmset(key, {
                current: '0',
                limit: limit.toString(),
            });
        }
    }

    /**
     * Clean up tenant usage tracking when tenant migrates away
     */
    async cleanupTenantUsage(umbrellaId: string, tenantId: string): Promise<void> {
        await redis.hdel(this.tenantUsageKey(umbrellaId), tenantId);
    }
}

// Singleton instance
export const concurrencyManager = new VapiUmbrellaConcurrencyManager();
