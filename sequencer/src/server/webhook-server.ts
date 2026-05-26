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
import { emailWebhooks } from './routes/email-webhooks.js';
import { healthRoutes } from './routes/health.js';

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3000');

const fastify = Fastify({
    logger: {
        level: 'info',
    },
});

// Register CORS — webhook endpoints are server-to-server so CORS is
// only relevant for the few admin endpoints called from the dashboard.
// Allow only origins explicitly listed in CORS_ALLOWED_ORIGINS (comma-
// separated); fall back to no CORS reflection.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
});

// Register route modules
fastify.register(twilioWebhooks, { prefix: '/webhooks/twilio' });
fastify.register(vapiWebhooks, { prefix: '/webhooks/vapi' });
fastify.register(leadIngestion, { prefix: '/webhooks/leads' });
fastify.register(emailWebhooks, { prefix: '/webhooks/email' });
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
