/**
 * Webhook Server
 * 
 * Fastify server that receives webhooks from:
 * - Twilio (SMS inbound, delivery status)
 * - VAPI (call events, concurrency sync)
 * - Lead sources (Google Ads, Facebook, generic)
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { twilioWebhooks } from './routes/twilio-webhooks.js';
import { vapiWebhooks } from './routes/vapi-webhooks.js';
import { leadIngestion } from './routes/lead-ingestion.js';
import { healthRoutes } from './routes/health.js';

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3000');

const fastify = Fastify({
    logger: {
        level: 'info',
    },
});

// Register CORS
fastify.register(cors, {
    origin: true,
});

// Register route modules
fastify.register(twilioWebhooks, { prefix: '/webhooks/twilio' });
fastify.register(vapiWebhooks, { prefix: '/webhooks/vapi' });
fastify.register(leadIngestion, { prefix: '/webhooks/leads' });
fastify.register(healthRoutes, { prefix: '' });

// Start server
async function start() {
    try {
        await fastify.listen({ port: WEBHOOK_PORT, host: '0.0.0.0' });
        console.log(`[SERVER] Webhook server running on port ${WEBHOOK_PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

start();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[SERVER] Received SIGTERM, shutting down...');
    await fastify.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SERVER] Received SIGINT, shutting down...');
    await fastify.close();
    process.exit(0);
});

export { fastify };
