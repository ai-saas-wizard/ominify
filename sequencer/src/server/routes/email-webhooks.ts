/**
 * Email Webhook Routes
 *
 * Handles:
 * - Inbound email replies (POST /webhooks/email/inbound)
 * - Open tracking pixel (GET /track/open/:executionLogId)
 * - Click tracking redirect (GET /track/click/:executionLogId)
 *
 * Inbound replies: Parses enrollmentId from reply-to address
 * (reply+{enrollmentId}@replies.ominify.io) and queues an email-reply event.
 *
 * Tracking: Lightweight endpoints that queue events and respond immediately.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventQueue } from '../../lib/redis.js';

// 1x1 transparent GIF (43 bytes)
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

export async function emailWebhooks(fastify: FastifyInstance) {
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
    fastify.post('/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
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

        // Fire and forget — don't block the pixel response
        eventQueue.add('event:email-opened', {
            type: 'email-opened' as const,
            tenantId: '',
            stepId: executionLogId, // executionLogId maps to step_id in the log
        }).catch(err => console.error('[EMAIL-WEBHOOK] Failed to queue open event:', err));

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
     * Query param: ?url={encodedOriginalUrl}
     */
    fastify.get('/track/click/:executionLogId', async (request: FastifyRequest, reply: FastifyReply) => {
        const { executionLogId } = request.params as { executionLogId: string };
        const { url } = request.query as { url?: string };

        if (!url) {
            return reply.status(400).send({ error: 'Missing url parameter' });
        }

        const decodedUrl = decodeURIComponent(url);

        // Fire and forget
        eventQueue.add('event:email-clicked', {
            type: 'email-clicked' as const,
            tenantId: '',
            stepId: executionLogId,
        }).catch(err => console.error('[EMAIL-WEBHOOK] Failed to queue click event:', err));

        return reply.redirect(302, decodedUrl);
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
