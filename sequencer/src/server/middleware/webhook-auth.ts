/**
 * Webhook authentication middleware.
 *
 * Validates inbound webhook requests from Twilio (HMAC signature),
 * VAPI (shared header secret), and internal callers (bearer token).
 *
 * All checks soft-warn if the required secret/env is missing rather than
 * failing closed, so a deploy that hasn't yet set the env doesn't black-
 * hole production traffic. Once the env is set the check is strict.
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import Twilio from 'twilio';
import { supabase } from '../../lib/db.js';
import { decrypt } from '../../lib/encryption.js';
import { timingSafeEqualStr } from '../../lib/signing.js';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'http://localhost:3000';

/**
 * Dev-only escape hatch. NEVER honored in production — a single env var
 * must not be able to open every endpoint (including admin) on a live deploy.
 */
export function isWebhookAuthDisabled(): boolean {
    return process.env.SEQUENCER_DISABLE_WEBHOOK_AUTH === '1'
        && process.env.NODE_ENV !== 'production';
}

const tenantAuthTokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadTenantTwilioAuthToken(tenantId: string): Promise<string | null> {
    const cached = tenantAuthTokenCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const { data, error } = await supabase
        .from('tenant_twilio_accounts')
        .select('auth_token_encrypted')
        .eq('client_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();

    if (error) {
        console.error(`[WEBHOOK-AUTH] Failed to load Twilio account for tenant ${tenantId}:`, error);
        return null;
    }
    if (!data?.auth_token_encrypted) return null;
    try {
        const token = decrypt(data.auth_token_encrypted);
        tenantAuthTokenCache.set(tenantId, { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
        return token;
    } catch (err) {
        console.error(`[WEBHOOK-AUTH] Failed to decrypt Twilio auth token for tenant ${tenantId}:`, err);
        return null;
    }
}

/**
 * Validate the Twilio X-Twilio-Signature header against the per-tenant
 * auth token. Returns true on success; on failure, replies 403 and
 * returns false so the route handler can short-circuit.
 */
export async function requireTwilioSignature(
    request: FastifyRequest,
    reply: FastifyReply,
    tenantId: string,
): Promise<boolean> {
    if (isWebhookAuthDisabled()) return true;

    const signature = (request.headers['x-twilio-signature'] || request.headers['X-Twilio-Signature']) as string | undefined;
    if (!signature) {
        reply.status(403).send({ error: 'Missing X-Twilio-Signature' });
        return false;
    }

    const authToken = await loadTenantTwilioAuthToken(tenantId);
    if (!authToken) {
        console.warn(`[WEBHOOK-AUTH] No Twilio auth token on file for tenant ${tenantId}; rejecting signed callback`);
        reply.status(403).send({ error: 'Unknown tenant' });
        return false;
    }

    const fullUrl = `${WEBHOOK_BASE_URL.replace(/\/$/, '')}${request.url}`;
    const params = (request.body && typeof request.body === 'object') ? (request.body as Record<string, any>) : {};

    const valid = Twilio.validateRequest(authToken, signature, fullUrl, params);
    if (!valid) {
        console.warn(`[WEBHOOK-AUTH] Invalid Twilio signature for tenant ${tenantId} on ${request.url}`);
        reply.status(403).send({ error: 'Invalid signature' });
        return false;
    }
    return true;
}

/**
 * Require a fixed shared secret in the X-Vapi-Secret header. The expected
 * value comes from VAPI_WEBHOOK_SECRET; if unset the request is rejected
 * (no soft mode, since VAPI webhooks mutate enrollment state).
 */
export const requireVapiSecret: preHandlerHookHandler = async (request, reply) => {
    if (isWebhookAuthDisabled()) return;

    const expected = process.env.VAPI_WEBHOOK_SECRET;
    if (!expected) {
        console.warn('[WEBHOOK-AUTH] VAPI_WEBHOOK_SECRET unset; rejecting VAPI callback');
        reply.status(503).send({ error: 'Server missing VAPI secret config' });
        return reply;
    }
    const provided = (request.headers['x-vapi-secret'] || request.headers['x-vapi-signature']) as string | undefined;
    if (!timingSafeEqualStr(provided, expected)) {
        reply.status(403).send({ error: 'Invalid VAPI secret' });
        return reply;
    }
};

/**
 * Factory: build a preHandler that requires Authorization: Bearer <token>
 * matching the named env var. Returns 503 if env is unset (fail-closed).
 */
export function requireBearer(envName: string): preHandlerHookHandler {
    return async (request, reply) => {
        if (isWebhookAuthDisabled()) return;

        const expected = process.env[envName];
        if (!expected) {
            console.warn(`[WEBHOOK-AUTH] ${envName} unset; rejecting request to ${request.url}`);
            reply.status(503).send({ error: `Server missing ${envName} config` });
            return reply;
        }
        const header = request.headers['authorization'];
        if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
            reply.status(401).send({ error: 'Missing bearer token' });
            return reply;
        }
        const token = header.slice(7).trim();
        if (!timingSafeEqualStr(token, expected)) {
            reply.status(403).send({ error: 'Invalid token' });
            return reply;
        }
    };
}
