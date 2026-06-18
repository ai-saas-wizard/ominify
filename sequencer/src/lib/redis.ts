import 'dotenv/config';
import Redis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for BullMQ connection options.
// Supports rediss:// (TLS) and an optional /N database-index path so the
// BullMQ connection stays consistent with the ioredis client (which parses
// the same URL natively).
function parseRedisUrl(url: string) {
    const parsed = new URL(url);
    const dbMatch = parsed.pathname.match(/^\/(\d+)$/);
    return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6379,
        password: parsed.password || undefined,
        username: parsed.username || undefined,
        ...(dbMatch ? { db: parseInt(dbMatch[1]) } : {}),
        ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    };
}

export const redisConnection = parseRedisUrl(redisUrl);

// Create a single Redis client for general operations
export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
});

redis.on('error', (err) => {
    console.error('[REDIS] Connection error:', err);
});

redis.on('connect', () => {
    console.log('[REDIS] Connected to Redis');
});

// ═══════════════════════════════════════════════════════════════════
// Queue Definitions
// ═══════════════════════════════════════════════════════════════════

// Default job options for every queue (review workers I4): transient
// provider errors get retried with exponential backoff instead of being
// dropped after a single attempt, and completed/failed jobs are pruned so
// Redis doesn't grow unbounded.
const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
};

export const smsQueue = new Queue('sms-send', { connection: redisConnection, defaultJobOptions });
export const emailQueue = new Queue('email-send', { connection: redisConnection, defaultJobOptions });
export const vapiQueue = new Queue('vapi-calls', { connection: redisConnection, defaultJobOptions });
export const eventQueue = new Queue('events-process', { connection: redisConnection, defaultJobOptions });
// Reserved for future async healing — currently healing actions are executed synchronously by event-processor
export const healingQueue = new Queue('healing-actions', { connection: redisConnection, defaultJobOptions });
// Phase 5: Analytics queue for scheduled analytics jobs
export const analyticsQueue = new Queue('analytics-compute', { connection: redisConnection, defaultJobOptions });

/**
 * Get job counts for all queues (for health check)
 */
export async function getQueueStats() {
    const [sms, email, vapi, events, healing, analytics] = await Promise.all([
        smsQueue.getJobCounts(),
        emailQueue.getJobCounts(),
        vapiQueue.getJobCounts(),
        eventQueue.getJobCounts(),
        healingQueue.getJobCounts(),
        analyticsQueue.getJobCounts(),
    ]);

    return { sms, email, vapi, events, healing, analytics };
}

/**
 * Gracefully close all connections
 */
export async function closeConnections() {
    await Promise.all([
        redis.quit(),
        smsQueue.close(),
        emailQueue.close(),
        vapiQueue.close(),
        eventQueue.close(),
        healingQueue.close(),
        analyticsQueue.close(),
    ]);
    console.log('[REDIS] All connections closed');
}

export { Queue, Worker, Job };
