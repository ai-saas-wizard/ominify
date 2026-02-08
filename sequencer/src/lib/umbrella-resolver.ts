/**
 * Umbrella Resolver
 * 
 * Cached lookup: which VAPI umbrella does a tenant belong to?
 * Cache TTL is 30 seconds so umbrella migrations take effect quickly.
 */

import { redis } from './redis.js';
import { supabase } from './db.js';
import { decrypt } from './encryption.js';
import type { UmbrellaMapping } from './types.js';

const CACHE_TTL_SECONDS = 30;

export class UmbrellaResolver {

    private cacheKey(tenantId: string): string {
        return `umbrella:tenant:${tenantId}`;
    }

    /**
     * Get the umbrella mapping for a tenant
     * Returns cached result if available, otherwise fetches from DB
     */
    async getUmbrellaForTenant(tenantId: string): Promise<UmbrellaMapping> {
        const cacheKey = this.cacheKey(tenantId);

        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            // Decrypt the API key on read
            return {
                ...parsed,
                vapiApiKey: decrypt(parsed.vapiApiKeyEncrypted),
            };
        }

        // Fetch from DB using RPC or join
        const { data, error } = await supabase
            .from('tenant_vapi_assignments')
            .select(`
                umbrella_id,
                tenant_concurrency_cap,
                priority_weight,
                vapi_umbrellas (
                    id,
                    umbrella_type,
                    vapi_api_key_encrypted,
                    vapi_org_id,
                    concurrency_limit
                )
            `)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            throw new Error(`Tenant ${tenantId} has no VAPI umbrella assignment`);
        }

        const umbrella = (data as any).vapi_umbrellas;

        const mapping: UmbrellaMapping = {
            umbrellaId: umbrella.id,
            umbrellaType: umbrella.umbrella_type,
            vapiApiKey: decrypt(umbrella.vapi_api_key_encrypted),
            vapiOrgId: umbrella.vapi_org_id,
            concurrencyLimit: umbrella.concurrency_limit,
            tenantCap: data.tenant_concurrency_cap,
            priorityWeight: data.priority_weight || 1.0,
        };

        // Cache the result (store encrypted key in cache)
        const cacheData = {
            ...mapping,
            vapiApiKeyEncrypted: umbrella.vapi_api_key_encrypted,
            vapiApiKey: undefined, // Don't cache decrypted key
        };
        await redis.set(cacheKey, JSON.stringify(cacheData), 'EX', CACHE_TTL_SECONDS);

        return mapping;
    }

    /**
     * Invalidate cache for a tenant (called during migration)
     */
    async invalidateCache(tenantId: string): Promise<void> {
        await redis.del(this.cacheKey(tenantId));
        console.log(`[UMBRELLA] Cache invalidated for tenant ${tenantId}`);
    }

    /**
     * Get all tenants for an umbrella
     */
    async getTenantsForUmbrella(umbrellaId: string): Promise<string[]> {
        const { data, error } = await supabase
            .from('tenant_vapi_assignments')
            .select('tenant_id')
            .eq('umbrella_id', umbrellaId)
            .eq('is_active', true);

        if (error) {
            console.error('[UMBRELLA] Error fetching tenants:', error);
            return [];
        }

        return (data || []).map(d => d.tenant_id);
    }
}

// Singleton instance
export const umbrellaResolver = new UmbrellaResolver();
