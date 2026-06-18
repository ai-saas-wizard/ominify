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
import { requireBearer } from '../middleware/webhook-auth.js';

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
    // Every /admin/* route requires Authorization: Bearer <ADMIN_API_TOKEN>.
    // /health and /ready remain unauthenticated for load-balancer probes.
    const adminAuth = requireBearer('ADMIN_API_TOKEN');

    /**
     * Health check
     * GET /health
     *
     * Unauthenticated — returns liveness only. Queue depths, umbrella
     * states and scheduler detail are operational intel and live behind
     * the admin bearer on GET /admin/stats.
     */
    fastify.get('/health', async (request, reply) => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
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
    fastify.get('/admin/umbrellas', { preHandler: adminAuth }, async (request, reply) => {
        const { data, error } = await supabase
            .from('vapi_umbrellas')
            .select(`
                id, name, umbrella_type, concurrency_limit, current_concurrency, max_tenants, is_active,
                tenant_vapi_assignments (
                    client_id, tenant_concurrency_cap, priority_weight, is_active
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
        { preHandler: adminAuth },
        async (request, reply) => {
            const { tenantId, targetUmbrellaId, reason } = request.body;

            // Get current assignment. tenant_vapi_assignments has
            // UNIQUE(client_id), so at most one row exists per tenant —
            // possibly deactivated from an earlier migration.
            const { data: current, error: currentError } = await supabase
                .from('tenant_vapi_assignments')
                .select('umbrella_id, is_active')
                .eq('client_id', tenantId)
                .maybeSingle();

            if (currentError) {
                reply.status(500).send({ error: currentError.message });
                return;
            }
            if (!current) {
                reply.status(404).send({ error: 'Tenant not found or not assigned to umbrella' });
                return;
            }

            // Replace the assignment in place — UNIQUE(client_id) forbids a
            // second row (even a deactivated one), so upsert on client_id
            // instead of deactivate-then-insert.
            const { error: upsertError } = await supabase
                .from('tenant_vapi_assignments')
                .upsert({
                    client_id: tenantId,
                    umbrella_id: targetUmbrellaId,
                    assigned_by: 'admin_api',
                    is_active: true,
                }, { onConflict: 'client_id' });

            if (upsertError) {
                reply.status(500).send({ error: upsertError.message });
                return;
            }

            // Log migration
            const { error: logError } = await supabase
                .from('vapi_umbrella_migrations')
                .insert({
                    client_id: tenantId,
                    from_umbrella_id: current.umbrella_id,
                    to_umbrella_id: targetUmbrellaId,
                    reason: reason || 'Admin migration',
                    migrated_by: 'admin_api',
                });
            if (logError) {
                console.error(`[ADMIN] Failed to log umbrella migration for ${tenantId}:`, logError.message);
            }

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
    fastify.get('/admin/stats', { preHandler: adminAuth }, async (request, reply) => {
        // Per-status counts via parallel HEAD queries — avoids loading every
        // enrollment row into memory (the prior implementation OOMs at scale).
        const ENROLLMENT_STATUSES = [
            'active', 'paused', 'completed', 'replied', 'booked',
            'failed', 'manual_stop', 'unenrolled', 'converted',
            'awaiting_outcome', 'generating_next_step',
        ] as const;

        const counts = await Promise.all(
            ENROLLMENT_STATUSES.map(async (status) => {
                const { count } = await supabase
                    .from('sequence_enrollments')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', status);
                return [status, count ?? 0] as const;
            })
        );
        const enrollmentCounts: Record<string, number> = Object.fromEntries(counts);

        // Get total execution count
        const { count: totalExecutions } = await supabase
            .from('sequence_execution_log')
            .select('*', { count: 'exact', head: true });

        // Get executions in the last 24 hours
        const { count: recentExecutions } = await supabase
            .from('sequence_execution_log')
            .select('*', { count: 'exact', head: true })
            .gte('executed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        // Operational detail formerly exposed on the public /health endpoint:
        // queue depths, umbrella concurrency state, scheduler heartbeat.
        const queues = await getQueueStats();

        const { data: umbrellas } = await supabase
            .from('vapi_umbrellas')
            .select('id, name, umbrella_type')
            .eq('is_active', true);

        const umbrellaStates: Record<string, any> = {};
        for (const u of umbrellas || []) {
            umbrellaStates[u.name] = await concurrencyManager.getUmbrellaState(u.id);
        }

        const dueEnrollments = await countDueEnrollments();
        const schedulerAge = Date.now() - schedulerLastTick;

        return {
            enrollments: enrollmentCounts,
            executions: {
                total: totalExecutions || 0,
                last_24h: recentExecutions || 0,
            },
            queues,
            vapiUmbrellas: umbrellaStates,
            scheduler: {
                lastTick: new Date(schedulerLastTick).toISOString(),
                ageMs: schedulerAge,
                healthy: schedulerAge < 30000, // Warn if no tick in 30s
                dueEnrollments,
            },
        };
    });
}
