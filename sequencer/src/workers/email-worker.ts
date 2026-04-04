/**
 * Email Worker
 * 
 * Processes email sending jobs from the email:send queue.
 * Supports Gmail API and SMTP fallback.
 */

import 'dotenv/config';
import nodemailer from 'nodemailer';
import { Worker, Job } from 'bullmq';
import { supabase } from '../lib/db.js';
import { redisConnection } from '../lib/redis.js';
import { decrypt } from '../lib/encryption.js';
import { recordInteraction } from '../lib/conversation-memory.js';
import type { EmailJobPayload } from '../lib/types.js';

interface TenantEmailConfig {
    provider: 'gmail' | 'smtp';
    fromEmail: string;
    fromName: string;
    // Gmail
    gmailAccessToken?: string;
    gmailRefreshToken?: string;
    // SMTP
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpSecure?: boolean;
}

/**
 * Get tenant's email configuration.
 * 1. Try tenant_email_accounts table (per-tenant SMTP config from frontend)
 * 2. Fall back to environment defaults (platform-wide SMTP)
 */
async function getTenantEmailConfig(tenantId: string): Promise<TenantEmailConfig | null> {
    // 1. Try per-tenant config from tenant_email_accounts
    try {
        const { data: emailAccount } = await supabase
            .from('tenant_email_accounts')
            .select('*')
            .eq('client_id', tenantId)
            .eq('is_active', true)
            .single();

        if (emailAccount) {
            let smtpPass: string | undefined;
            if (emailAccount.smtp_pass_encrypted) {
                try {
                    smtpPass = decrypt(emailAccount.smtp_pass_encrypted);
                } catch (err) {
                    console.error(`[EMAIL] Failed to decrypt SMTP password for tenant ${tenantId}:`, err);
                }
            }

            console.log(`[EMAIL] Using tenant-specific email config for ${tenantId} (${emailAccount.from_email})`);
            return {
                provider: emailAccount.provider || 'smtp',
                fromEmail: emailAccount.from_email,
                fromName: emailAccount.from_name || 'Ominify',
                smtpHost: emailAccount.smtp_host,
                smtpPort: emailAccount.smtp_port || 587,
                smtpUser: emailAccount.smtp_user,
                smtpPass,
                smtpSecure: emailAccount.smtp_secure || false,
                gmailAccessToken: emailAccount.gmail_access_token_encrypted
                    ? decrypt(emailAccount.gmail_access_token_encrypted)
                    : undefined,
                gmailRefreshToken: emailAccount.gmail_refresh_token_encrypted
                    ? decrypt(emailAccount.gmail_refresh_token_encrypted)
                    : undefined,
            };
        }
    } catch (err) {
        // Table may not exist yet or no row — fall through to defaults
        console.log(`[EMAIL] No tenant email config for ${tenantId}, using env defaults`);
    }

    // 2. Fall back to environment defaults
    if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
        console.error(`[EMAIL] No email configuration for tenant ${tenantId} and no env defaults`);
        return null;
    }

    return {
        provider: 'smtp',
        fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@ominify.io',
        fromName: 'Ominify',
        smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
        smtpPort: parseInt(process.env.SMTP_PORT || '587'),
        smtpUser: process.env.SMTP_USER,
        smtpPass: process.env.SMTP_PASS,
        smtpSecure: process.env.SMTP_SECURE === 'true',
    };
}

const TRACKING_BASE_URL = process.env.TRACKING_BASE_URL || process.env.WEBHOOK_BASE_URL || 'http://localhost:3000';
const REPLY_DOMAIN = process.env.REPLY_DOMAIN || 'replies.ominify.io';

/**
 * Inject tracking pixel into HTML email body.
 * Adds a 1x1 transparent GIF that triggers an open event.
 */
function injectTrackingPixel(html: string, enrollmentId: string, stepId: string): string {
    const pixelUrl = `${TRACKING_BASE_URL}/webhooks/email/track/open/${stepId}`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

    // Insert before </body> if present, otherwise append
    if (html.includes('</body>')) {
        return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
}

/**
 * Rewrite URLs in HTML body for click tracking.
 * Wraps each href in a redirect through our click tracker.
 */
function rewriteLinksForTracking(html: string, stepId: string): string {
    // Match href="..." but skip mailto: and tel: links
    return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
        const encodedUrl = encodeURIComponent(url);
        return `href="${TRACKING_BASE_URL}/webhooks/email/track/click/${stepId}?url=${encodedUrl}"`;
    });
}

/**
 * Send email via SMTP with Reply-To routing and tracking
 */
async function sendViaSMTP(
    config: TenantEmailConfig,
    to: string,
    subject: string,
    html: string,
    text: string,
    enrollmentId?: string,
    stepId?: string
): Promise<{ messageId: string }> {
    const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser ? {
            user: config.smtpUser,
            pass: config.smtpPass,
        } : undefined,
    });

    // Inject tracking pixel and rewrite links if we have step tracking info
    let trackedHtml = html;
    if (stepId) {
        trackedHtml = injectTrackingPixel(trackedHtml, enrollmentId || '', stepId);
        trackedHtml = rewriteLinksForTracking(trackedHtml, stepId);
    }

    // Set Reply-To header for reply routing
    const replyTo = enrollmentId
        ? `reply+${enrollmentId}@${REPLY_DOMAIN}`
        : undefined;

    const result = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to,
        subject,
        html: trackedHtml,
        text,
        ...(replyTo ? { replyTo } : {}),
    });

    return { messageId: result.messageId };
}

/**
 * Send email via Gmail API
 * TODO: Implement Gmail OAuth flow and API sending
 * Currently falls back to SMTP if SMTP config is available.
 */
async function sendViaGmailAPI(
    config: TenantEmailConfig,
    to: string,
    subject: string,
    html: string,
    text: string,
    enrollmentId?: string,
    stepId?: string
): Promise<{ messageId: string }> {
    console.warn('[EMAIL] Gmail API is not yet implemented. Attempting SMTP fallback.');

    // Fall back to SMTP if credentials are available
    if (config.smtpHost && config.smtpUser) {
        console.log('[EMAIL] SMTP config available, falling back to SMTP.');
        return sendViaSMTP(config, to, subject, html, text, enrollmentId, stepId);
    }

    throw new Error(
        'Gmail API is not yet implemented and no SMTP fallback is configured. ' +
        'Please configure SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) or wait for Gmail API support.'
    );
}

/**
 * Log execution to database
 */
async function logExecution(params: {
    enrollmentId: string;
    stepId: string;
    channel: string;
    action: string;
    providerId: string;
    providerResponse: any;
    emailStatus?: string;
}): Promise<void> {
    try {
        await supabase.from('sequence_execution_log').insert({
            enrollment_id: params.enrollmentId,
            step_id: params.stepId,
            channel: params.channel,
            action: params.action,
            provider_id: params.providerId,
            provider_response: params.providerResponse,
            email_status: params.emailStatus,
            executed_at: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[EMAIL] Error logging execution:', error);
    }
}

/**
 * Email Worker processor
 */
async function processEmailJob(job: Job<EmailJobPayload>): Promise<{ messageId: string }> {
    const { tenantId, contactEmail, subject, bodyHtml, bodyText, enrollmentId, stepId } = job.data;

    console.log(`[EMAIL] Processing job ${job.id} for tenant ${tenantId}, email ${contactEmail}`);

    // Get tenant's email configuration
    const config = await getTenantEmailConfig(tenantId);

    if (!config) {
        throw new Error(`No email configuration for tenant ${tenantId}`);
    }

    let result: { messageId: string };

    if (config.provider === 'gmail' && config.gmailAccessToken) {
        result = await sendViaGmailAPI(config, contactEmail, subject, bodyHtml, bodyText, enrollmentId, stepId);
    } else {
        result = await sendViaSMTP(config, contactEmail, subject, bodyHtml, bodyText, enrollmentId, stepId);
    }

    console.log(`[EMAIL] Sent to ${contactEmail}, MessageId: ${result.messageId}`);

    // Log execution
    await logExecution({
        enrollmentId,
        stepId,
        channel: 'email',
        action: 'sent',
        providerId: result.messageId,
        providerResponse: result,
        emailStatus: 'sent',
    });

    // Record interaction for conversation memory
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('contact_id, tenant_id')
        .eq('id', enrollmentId)
        .single();

    if (enrollment) {
        await recordInteraction({
            clientId: enrollment.tenant_id,
            contactId: enrollment.contact_id,
            enrollmentId,
            stepId,
            channel: 'email',
            direction: 'outbound',
            contentBody: bodyText,
            contentSubject: subject,
            outcome: 'delivered',
            providerId: result.messageId,
        });
    }

    return result;
}

// Create the worker
const emailWorker = new Worker<EmailJobPayload>('email-send', processEmailJob, {
    connection: redisConnection,
    concurrency: 5,
    limiter: {
        max: 20,
        duration: 60000, // 20 emails per minute (conservative for Gmail)
    },
});

// Event listeners
emailWorker.on('completed', (job, result) => {
    console.log(`[EMAIL] Job ${job.id} completed:`, result);
});

emailWorker.on('failed', (job, error) => {
    console.error(`[EMAIL] Job ${job?.id} failed:`, error.message);
});

emailWorker.on('error', (error) => {
    console.error('[EMAIL] Worker error:', error);
});

console.log('[EMAIL] Email worker started');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[EMAIL] Received SIGTERM, closing worker...');
    await emailWorker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[EMAIL] Received SIGINT, closing worker...');
    await emailWorker.close();
    process.exit(0);
});

export { emailWorker };
