import 'dotenv/config';
import Redis from 'ioredis';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for BullMQ connection options
function parseRedisUrl(url: string) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6379,
        password: parsed.password || undefined,
        username: parsed.username || undefined,
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

export const smsQueue = new Queue('sms:send', { connection: redisConnection });
export const emailQueue = new Queue('email:send', { connection: redisConnection });
export const vapiQueue = new Queue('vapi:calls', { connection: redisConnection });
export const eventQueue = new Queue('events:process', { connection: redisConnection });
// Phase 4: Self-Healing queue for async healing actions
export const healingQueue = new Queue('healing:actions', { connection: redisConnection });
// Phase 5: Analytics queue for scheduled analytics jobs
export const analyticsQueue = new Queue('analytics:compute', { connection: redisConnection });

// Queue event listeners for monitoring
export const smsQueueEvents = new QueueEvents('sms:send', { connection: redisConnection });
export const emailQueueEvents = new QueueEvents('email:send', { connection: redisConnection });
export const vapiQueueEvents = new QueueEvents('vapi:calls', { connection: redisConnection });
export const eventQueueEvents = new QueueEvents('events:process', { connection: redisConnection });
export const healingQueueEvents = new QueueEvents('healing:actions', { connection: redisConnection });
export const analyticsQueueEvents = new QueueEvents('analytics:compute', { connection: redisConnection });

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
