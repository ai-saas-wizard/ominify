/**
 * Email Webhook Routes
 *
 * Handles:
 * - Inbound email replies (POST /webhooks/email/inbound)
 * - Bounce notifications (POST /webhooks/email/bounce)
 * - Open tracking pixel (GET /track/open/:executionLogId)
 * - Click tracking redirect (GET /track/click/:executionLogId)
 * - Unsubscribe link (GET /unsubscribe/:enrollmentId)
 *
 * Inbound replies: Parses enrollmentId from reply-to address
 * (reply+{enrollmentId}@replies.ominify.io) and queues an email-reply event.
 *
 * Tracking: Lightweight endpoints that queue events and respond immediately.
 * Tracking URLs carry the execution-log id so opens/clicks attribute to the
 * exact send, and click redirect targets are HMAC-signed at render time so
 * this endpoint cannot be used as an open redirector.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventQueue } from '../../lib/redis.js';
import { supabase } from '../../lib/db.js';
import { requireBearer } from '../middleware/webhook-auth.js';
import { verifySignedUrl } from '../../lib/signing.js';
import { optOutContact } from '../../lib/opt-out.js';

// 1x1 transparent GIF (43 bytes)
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

export async function emailWebhooks(fastify: FastifyInstance) {
    // Inbound email replies come from a provider (Mailgun, SendGrid Inbound
    // Parse, etc.) that should send a shared bearer token. Tracking
    // pixel/click endpoints stay public — they're sent directly to
    // recipients and can't carry a secret.
    const inboundAuth = requireBearer('EMAIL_INBOUND_API_TOKEN');

    // ═══════════════════════════════════════════════════════════════════
    // Inbound Email Reply Webhook
    // ═══════════════════════════════════════════════════════════════════

    /**
     * POST /webhooks/email/inbound
     *
     * Receives inbound emails from an email service (SendGrid Inbound Parse,
     * Mailgun Routes, AWS SES, etc.)
     *
     * Expected fields (form or JSON):
     * - to: the reply-to address (contains enrollmentId)
     * - from: sender email
     * - subject: email subject
     * - text: plain text body
     * - html: HTML body (optional)
     */
    fastify.post('/inbound', { preHandler: inboundAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;

        const toAddress = body.to || body.To || body.envelope?.to?.[0] || '';
        const fromEmail = body.from || body.From || body.sender || '';
        const subject = body.subject || body.Subject || '';
        const textBody = body.text || body['body-plain'] || body.TextBody || '';
        const htmlBody = body.html || body['body-html'] || body.HtmlBody || '';

        console.log(`[EMAIL-WEBHOOK] Inbound email from ${fromEmail} to ${toAddress}`);

        // Parse enrollmentId from reply-to address: reply+{enrollmentId}@replies.ominify.io
        const enrollmentId = parseEnrollmentIdFromAddress(toAddress);

        if (!enrollmentId) {
            console.log(`[EMAIL-WEBHOOK] Could not parse enrollmentId from: ${toAddress}`);
            return reply.status(200).send({ status: 'ignored', reason: 'no_enrollment_id' });
        }

        // Verify the sender actually is the enrolled contact before feeding
        // the content into the AI pipeline — the enrollmentId is exposed in
        // Reply-To, so anyone who learns it could otherwise forge replies.
        const { data: enrollment, error: enrollmentError } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .maybeSingle();

        if (enrollmentError || !enrollment?.contact_id) {
            console.log(`[EMAIL-WEBHOOK] Unknown enrollment ${enrollmentId}; ignoring inbound email`);
            return reply.status(200).send({ status: 'ignored', reason: 'unknown_enrollment' });
        }

        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('email')
            .eq('id', enrollment.contact_id)
            .maybeSingle();

        const senderEmail = extractEmailAddress(fromEmail).trim().toLowerCase();
        const contactEmail = (contact?.email || '').trim().toLowerCase();

        if (contactError || !contactEmail || contactEmail !== senderEmail) {
            console.warn(`[EMAIL-WEBHOOK] Sender ${senderEmail || '<empty>'} does not match contact on enrollment ${enrollmentId}; ignoring`);
            return reply.status(200).send({ status: 'ignored', reason: 'sender_mismatch' });
        }

        // Queue the email-reply event
        await eventQueue.add('event:email-reply', {
            type: 'email-reply' as const,
            tenantId: '', // Will be resolved by event processor from enrollment
            enrollmentId,
            fromEmail: extractEmailAddress(fromEmail),
            emailSubject: subject,
            emailBodyText: textBody,
            emailBodyHtml: htmlBody,
        });

        console.log(`[EMAIL-WEBHOOK] Queued email-reply event for enrollment ${enrollmentId}`);
        return reply.status(200).send({ status: 'queued', enrollmentId });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Email Open Tracking Pixel
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /track/open/:executionLogId
     *
     * Returns a 1x1 transparent GIF and queues an email-opened event.
     * Called when the recipient's email client loads the tracking pixel.
     */
    fastify.get('/track/open/:executionLogId', async (request: FastifyRequest, reply: FastifyReply) => {
        const { executionLogId } = request.params as { executionLogId: string };

        // Fire and forget — don't block the pixel response. Deterministic
        // jobId dedupes repeated pixel loads to the first open event.
        eventQueue.add('event:email-opened', {
            type: 'email-opened' as const,
            tenantId: '',
            executionLogId,
        }, { jobId: `open:${executionLogId}` }).catch(err => console.error('[EMAIL-WEBHOOK] Failed to queue open event:', err));

        return reply
            .header('Content-Type', 'image/gif')
            .header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
            .header('Pragma', 'no-cache')
            .header('Expires', '0')
            .send(TRACKING_PIXEL);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Email Click Tracking Redirect
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /track/click/:executionLogId
     *
     * Queues an email-clicked event and 302 redirects to the original URL.
     * Query params: ?u={encodedOriginalUrl}&sig={hmac}
     *
     * The redirect target was signed when the email was rendered; the
     * signature MUST verify before redirecting, otherwise this endpoint is
     * an open redirector on our tracking domain.
     */
    fastify.get('/track/click/:executionLogId', async (request: FastifyRequest, reply: FastifyReply) => {
        const { executionLogId } = request.params as { executionLogId: string };
        const { u, url, sig } = request.query as { u?: string; url?: string; sig?: string };

        const encodedUrl = u || url;
        if (!encodedUrl) {
            return reply.status(400).send({ error: 'Missing url parameter' });
        }

        let decodedUrl: string;
        try {
            decodedUrl = decodeURIComponent(encodedUrl);
        } catch {
            return reply.status(400).send({ error: 'Malformed url parameter' });
        }

        if (!verifySignedUrl(decodedUrl, sig)) {
            console.warn(`[EMAIL-WEBHOOK] Invalid or missing click signature for log ${executionLogId}; refusing redirect`);
            return reply.status(403).send({ error: 'Invalid signature' });
        }

        // Fire and forget — first click wins via deterministic jobId
        eventQueue.add('event:email-clicked', {
            type: 'email-clicked' as const,
            tenantId: '',
            executionLogId,
            url: decodedUrl,
        }, { jobId: `click:${executionLogId}` }).catch(err => console.error('[EMAIL-WEBHOOK] Failed to queue click event:', err));

        return reply.redirect(302, decodedUrl);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Unsubscribe Link
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /unsubscribe/:enrollmentId
     *
     * One-click unsubscribe target (List-Unsubscribe / footer link).
     * Opts the enrollment's contact out at the contact level and stops all
     * in-flight enrollments. Always renders the same generic page — even
     * for unknown ids — so the endpoint can't be used as an enrollment-id
     * oracle.
     */
    const handleUnsubscribe = async (request: FastifyRequest, reply: FastifyReply) => {
        const { enrollmentId } = request.params as { enrollmentId: string };

        const { data: enrollment, error } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .maybeSingle();

        if (error) {
            console.error(`[EMAIL-WEBHOOK] Unsubscribe lookup failed for ${enrollmentId}:`, error);
        } else if (enrollment?.contact_id) {
            await optOutContact(supabase, enrollment.contact_id, 'email', 'unsubscribe_link');
        } else {
            console.log(`[EMAIL-WEBHOOK] Unsubscribe for unknown enrollment ${enrollmentId}`);
        }

        return reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .status(200)
            .send('<!doctype html><html><head><title>Unsubscribed</title></head><body><p>You&#39;ve been unsubscribed. You will not receive further emails from us.</p></body></html>');
    };

    fastify.get('/unsubscribe/:enrollmentId', handleUnsubscribe);
    // RFC 8058 one-click unsubscribe: List-Unsubscribe-Post requires the
    // listed URL to accept a POST (Gmail/Yahoo bulk-sender requirement).
    fastify.post('/unsubscribe/:enrollmentId', handleUnsubscribe);

    // ═══════════════════════════════════════════════════════════════════
    // Bounce Notifications
    // ═══════════════════════════════════════════════════════════════════

    /**
     * POST /webhooks/email/bounce
     *
     * Bounce ingestion from the email provider (or a relay). Guarded by the
     * same bearer token as the inbound route.
     * Body: { provider_id?, execution_log_id?, bounce_type? }
     */
    fastify.post('/bounce', { preHandler: inboundAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body || {}) as {
            provider_id?: string;
            execution_log_id?: string;
            bounce_type?: string;
        };
        const { provider_id, execution_log_id, bounce_type } = body;

        if (!provider_id && !execution_log_id) {
            return reply.status(400).send({ error: 'provider_id or execution_log_id required' });
        }

        await eventQueue.add('event:email-bounced', {
            type: 'email-bounced' as const,
            tenantId: '',
            providerId: provider_id,
            executionLogId: execution_log_id,
            bounceType: bounce_type,
        }, { jobId: `bounce:${provider_id || execution_log_id}` });

        console.log(`[EMAIL-WEBHOOK] Queued email-bounced event (${provider_id || execution_log_id})`);
        return reply.status(200).send({ status: 'queued' });
    });
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse enrollmentId from a reply-to address.
 * Expected format: reply+{enrollmentId}@replies.ominify.io
 * Also handles: reply+{enrollmentId}@<any-domain>
 */
function parseEnrollmentIdFromAddress(toAddress: string): string | null {
    // Handle comma-separated To addresses
    const addresses = toAddress.split(',').map(a => a.trim());

    for (const addr of addresses) {
        // Match reply+{uuid}@... pattern
        const match = addr.match(/reply\+([a-f0-9-]+)@/i);
        if (match) return match[1];
    }

    return null;
}

/**
 * Extract clean email address from a "Name <email>" format.
 */
function extractEmailAddress(fromField: string): string {
    const match = fromField.match(/<([^>]+)>/);
    return match ? match[1] : fromField.trim();
}
