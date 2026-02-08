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

    /**
     * Try to acquire a concurrency slot within the umbrella.
     * Checks both:
     *   1. Umbrella-level total concurrency
     *   2. Per-tenant soft cap (if set)
     * 
     * Returns: 1 = acquired, 0 = umbrella full, -1 = tenant cap hit
     */
    async tryAcquire(
        umbrellaId: string,
        tenantId: string,
        umbrellaLimit: number,
        tenantCap: number | null
    ): Promise<{ acquired: boolean; reason?: 'umbrella_full' | 'tenant_cap' }> {
        const umbrellaKey = this.umbrellaKey(umbrellaId);
        const tenantUsageKey = this.tenantUsageKey(umbrellaId);

        // Atomic Lua: check umbrella limit + tenant cap, then increment both
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
            return 1
        `;

        const result = await redis.eval(
            script,
            2,
            umbrellaKey,
            tenantUsageKey,
            umbrellaLimit.toString(),
            (tenantCap || 0).toString(),
            tenantId
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
     * Release a concurrency slot (called when call ends)
     */
    async release(umbrellaId: string, tenantId: string): Promise<void> {
        const umbrellaKey = this.umbrellaKey(umbrellaId);
        const tenantUsageKey = this.tenantUsageKey(umbrellaId);

        const script = `
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
        `;

        await redis.eval(script, 2, umbrellaKey, tenantUsageKey, tenantId);
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
                Object.entries(tenantUsage).map(([k, v]) => [k, parseInt(v)])
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
