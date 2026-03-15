/**
 * PM2 Production Config — Optimized for t3.small (2 vCPU, 2GB RAM)
 *
 * Target: 0-50 users
 * Budget: ~$12/mo EC2 instance
 *
 * Memory budget:
 *   - Redis: ~128MB
 *   - OS + Node overhead: ~300MB
 *   - Available for workers: ~1.5GB
 *   - 7 processes × ~150MB avg = ~1GB (comfortable headroom)
 *
 * Scaling notes:
 *   - When you hit 50+ active users, consider:
 *     1. Bumping SMS/Email workers to instances: 2
 *     2. Upgrading to t3.medium (4GB RAM, ~$30/mo)
 */
module.exports = {
    apps: [
        {
            name: 'scheduler',
            script: './dist/workers/scheduler-worker.js',
            instances: 1,
            max_memory_restart: '250M',
            env: {
                NODE_ENV: 'production',
            },
            // Restart with exponential backoff on crash
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
        {
            name: 'sms-worker',
            script: './dist/workers/sms-worker.js',
            instances: 1,  // 1 instance is fine for <50 users
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
        {
            name: 'email-worker',
            script: './dist/workers/email-worker.js',
            instances: 1,  // 1 instance is fine for <50 users
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
        {
            name: 'vapi-worker',
            script: './dist/workers/vapi-worker.js',
            instances: 1,
            max_memory_restart: '250M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
        {
            name: 'webhook-server',
            script: './dist/server/webhook-server.js',
            instances: 1,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
            // Webhook server is critical — listen for ready
            wait_ready: false,
            listen_timeout: 10000,
        },
        {
            name: 'event-processor',
            script: './dist/workers/event-processor.js',
            instances: 1,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
        {
            name: 'analytics-worker',
            script: './dist/workers/analytics-worker.js',
            instances: 1,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',
        },
    ],
};
