/**
 * Health & Admin Routes
 * 
 * Provides:
 * - Health check endpoint
 * - Queue stats
 * - Umbrella concurrency status
 * - Admin API for umbrella management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getQueueStats } from '../../lib/redis.js';
import { supabase } from '../../lib/db.js';
import { concurrencyManager } from '../../lib/concurrency-manager.js';

let schedulerLastTick = Date.now();

/**
 * Update scheduler last tick (called by scheduler worker)
 */
export function updateSchedulerTick() {
    schedulerLastTick = Date.now();
}

/**
 * Count due enrollments
 */
async function countDueEnrollments(): Promise<number> {
    const { count } = await supabase
        .from('sequence_enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('next_step_at', new Date().toISOString());

    return count || 0;
}

export async function healthRoutes(fastify: FastifyInstance) {
    /**
     * Health check
     * GET /health
     */
    fastify.get('/health', async (request, reply) => {
        try {
            // Get queue stats
            const queues = await getQueueStats();

            // Get umbrella states
            const { data: umbrellas } = await supabase
                .from('vapi_umbrellas')
                .select('id, name, umbrella_type')
                .eq('is_active', true);

            const umbrellaStates: Record<string, any> = {};

            for (const u of umbrellas || []) {
                umbrellaStates[u.name] = await concurrencyManager.getUmbrellaState(u.id);
            }

            // Get scheduler status
            const dueEnrollments = await countDueEnrollments();
            const schedulerAge = Date.now() - schedulerLastTick;

            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                queues,
                vapiUmbrellas: umbrellaStates,
                scheduler: {
                    lastTick: new Date(schedulerLastTick).toISOString(),
                    ageMs: schedulerAge,
                    healthy: schedulerAge < 30000, // Warn if no tick in 30s
                    dueEnrollments,
                },
            };
        } catch (error: any) {
            return {
                status: 'error',
                error: error.message,
            };
        }
    });

    /**
     * Simple readiness check
     * GET /ready
     */
    fastify.get('/ready', async (request, reply) => {
        return { ready: true };
    });

    /**
     * Admin: List umbrellas
     * GET /admin/umbrellas
     */
    fastify.get('/admin/umbrellas', async (request, reply) => {
        const { data, error } = await supabase
            .from('vapi_umbrellas')
            .select(`
                id, name, umbrella_type, concurrency_limit, current_concurrency, max_tenants, is_active,
                tenant_vapi_assignments (
                    tenant_id, tenant_concurrency_cap, priority_weight, is_active
                )
            `)
            .eq('is_active', true);

        if (error) {
            reply.status(500).send({ error: error.message });
            return;
        }

        // Add Redis state
        const result = await Promise.all((data || []).map(async (u) => {
            const state = await concurrencyManager.getUmbrellaState(u.id);
            return {
                ...u,
                redisState: state,
            };
        }));

        return result;
    });

    /**
     * Admin: Migrate tenant
     * POST /admin/umbrellas/migrate
     */
    fastify.post<{ Body: { tenantId: string; targetUmbrellaId: string; reason?: string } }>(
        '/admin/umbrellas/migrate',
        async (request, reply) => {
            const { tenantId, targetUmbrellaId, reason } = request.body;

            // Get current assignment
            const { data: current } = await supabase
                .from('tenant_vapi_assignments')
                .select('umbrella_id')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .single();

            if (!current) {
                reply.status(404).send({ error: 'Tenant not found or not assigned to umbrella' });
                return;
            }

            // Deactivate old assignment
            await supabase
                .from('tenant_vapi_assignments')
                .update({ is_active: false })
                .eq('tenant_id', tenantId);

            // Create new assignment
            await supabase
                .from('tenant_vapi_assignments')
                .insert({
                    tenant_id: tenantId,
                    umbrella_id: targetUmbrellaId,
                    assigned_by: 'admin_api',
                    is_active: true,
                });

            // Log migration
            await supabase
                .from('vapi_umbrella_migrations')
                .insert({
                    tenant_id: tenantId,
                    from_umbrella_id: current.umbrella_id,
                    to_umbrella_id: targetUmbrellaId,
                    reason: reason || 'Admin migration',
                    migrated_by: 'admin_api',
                });

            // Clean up old umbrella usage in Redis
            await concurrencyManager.cleanupTenantUsage(current.umbrella_id, tenantId);

            return {
                ok: true,
                tenantId,
                fromUmbrella: current.umbrella_id,
                toUmbrella: targetUmbrellaId,
            };
        }
    );

    /**
     * Admin: Get enrollment stats
     * GET /admin/stats
     */
    fastify.get('/admin/stats', async (request, reply) => {
        const { data: enrollmentStats } = await supabase
            .from('sequence_enrollments')
            .select('status', { count: 'exact' })
            .eq('status', 'active');

        const { data: execStats } = await supabase
            .rpc('get_execution_stats'); // Would need to create this RPC

        return {
            enrollments: {
                active: enrollmentStats?.length || 0,
            },
            executions: execStats || {},
        };
    });
}
