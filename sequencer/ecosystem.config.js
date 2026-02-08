module.exports = {
    apps: [
        {
            name: 'scheduler',
            script: './dist/workers/scheduler-worker.js',
            instances: 1,
            max_memory_restart: '500M',
            env_production: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'sms-worker',
            script: './dist/workers/sms-worker.js',
            instances: 2,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'email-worker',
            script: './dist/workers/email-worker.js',
            instances: 2,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'vapi-worker',
            script: './dist/workers/vapi-worker.js',
            instances: 1,  // Single instance — concurrency managed by Redis
            max_memory_restart: '500M',
            env_production: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'webhook-server',
            script: './dist/server/webhook-server.js',
            instances: 1,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'event-processor',
            script: './dist/workers/event-processor.js',
            instances: 1,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production'
            }
        }
    ]
};
