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
import { claimOnce, releaseClaim } from '../lib/idempotency.js';
import { isContactOptedOut } from '../lib/opt-out.js';
import { signUrl } from '../lib/signing.js';
import type { EmailJobPayload } from '../lib/types.js';

interface TenantEmailConfig {
    provider: 'gmail' | 'smtp';
    accountId?: string;
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
                accountId: emailAccount.id,
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
 * Keyed by execution-log id so opens attribute to THIS send, not to every
 * enrollment sharing the step (review C8).
 */
function injectTrackingPixel(html: string, executionLogId: string): string {
    const pixelUrl = `${TRACKING_BASE_URL}/webhooks/email/track/open/${executionLogId}`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

    // Insert before </body> if present, otherwise append
    if (html.includes('</body>')) {
        return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
}

/**
 * Rewrite URLs in HTML body for click tracking.
 * Wraps each href in a redirect through our click tracker, keyed by
 * execution-log id and HMAC-signed so the tracker can't be used as an
 * open redirector (review C8 + server I5).
 */
function rewriteLinksForTracking(html: string, executionLogId: string): string {
    // Match href="..." but skip mailto: and tel: links
    return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
        const encodedUrl = encodeURIComponent(url);
        return `href="${TRACKING_BASE_URL}/webhooks/email/track/click/${executionLogId}?u=${encodedUrl}&sig=${signUrl(url)}"`;
    });
}

/**
 * Append a small visible unsubscribe footer link (CAN-SPAM, review C3).
 */
function appendUnsubscribeFooter(html: string, unsubscribeUrl: string): string {
    const footer = `<p style="font-size:12px;color:#888;margin-top:24px">If you no longer wish to receive these emails, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`;

    if (html.includes('</body>')) {
        return html.replace('</body>', `${footer}</body>`);
    }
    return html + footer;
}

// Module-level transporter cache keyed by email-account id — SMTP pools the
// connection instead of building a fresh transporter per job.
type Transporter = ReturnType<typeof nodemailer.createTransport>;
const transporterCache = new Map<string, Transporter>();

function getTransporter(config: TenantEmailConfig): Transporter {
    const cacheKey = config.accountId || 'env-default';
    let transporter = transporterCache.get(cacheKey);

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            auth: config.smtpUser ? {
                user: config.smtpUser,
                pass: config.smtpPass,
            } : undefined,
        });
        transporterCache.set(cacheKey, transporter);
    }

    return transporter;
}

/**
 * Send email via SMTP with Reply-To routing and List-Unsubscribe headers.
 * Tracking pixel/link rewriting happens in processEmailJob (needs the
 * execution-log id), so `html` arrives fully prepared.
 */
async function sendViaSMTP(
    config: TenantEmailConfig,
    to: string,
    subject: string,
    html: string,
    text: string,
    enrollmentId?: string
): Promise<{ messageId: string }> {
    const transporter = getTransporter(config);

    // Set Reply-To header for reply routing
    const replyTo = enrollmentId
        ? `reply+${enrollmentId}@${REPLY_DOMAIN}`
        : undefined;

    // One-click unsubscribe headers (CAN-SPAM / Gmail bulk-sender requirements)
    const unsubscribeUrl = enrollmentId
        ? `${TRACKING_BASE_URL}/webhooks/email/unsubscribe/${enrollmentId}`
        : undefined;

    const result = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(unsubscribeUrl ? {
            headers: {
                'List-Unsubscribe': `<${unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
        } : {}),
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
    enrollmentId?: string
): Promise<{ messageId: string }> {
    console.warn('[EMAIL] Gmail API is not yet implemented. Attempting SMTP fallback.');

    // Fall back to SMTP if credentials are available
    if (config.smtpHost && config.smtpUser) {
        console.log('[EMAIL] SMTP config available, falling back to SMTP.');
        return sendViaSMTP(config, to, subject, html, text, enrollmentId);
    }

    throw new Error(
        'Gmail API is not yet implemented and no SMTP fallback is configured. ' +
        'Please configure SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) or wait for Gmail API support.'
    );
}

/**
 * Email Worker processor
 */
async function processEmailJob(job: Job<EmailJobPayload>): Promise<{ messageId: string }> {
    const { tenantId, contactEmail, subject, bodyHtml, bodyText, enrollmentId, stepId } = job.data;
    // variantId/dedupKey are stamped by the scheduler (see lib/types.ts payload contract)
    const { variantId, dedupKey } = job.data as EmailJobPayload & { variantId?: string; dedupKey?: string };

    console.log(`[EMAIL] Processing job ${job.id} for tenant ${tenantId}, email ${contactEmail}`);

    // Defense-in-depth opt-out gate (review C3): never email an opted-out contact,
    // regardless of which path dispatched this job.
    const { data: enrollment, error: enrollmentError } = await supabase
        .from('sequence_enrollments')
        .select('contact_id, tenant_id')
        .eq('id', enrollmentId)
        .single();

    if (enrollmentError) {
        console.error(`[EMAIL] Error fetching enrollment ${enrollmentId}:`, enrollmentError);
    }

    if (enrollment?.contact_id) {
        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('opted_out_at')
            .eq('id', enrollment.contact_id)
            .single();

        if (contactError) {
            console.error(`[EMAIL] Error fetching contact ${enrollment.contact_id}:`, contactError);
        }

        if (isContactOptedOut(contact)) {
            console.log(`[EMAIL] Contact ${enrollment.contact_id} is opted out — skipping send for enrollment ${enrollmentId}`);
            return { messageId: '' };
        }
    }

    // Get tenant's email configuration
    const config = await getTenantEmailConfig(tenantId);

    if (!config) {
        throw new Error(`No email configuration for tenant ${tenantId}`);
    }

    // Send idempotency (review C5): claim before the provider call so a
    // duplicate dispatch cannot re-email the lead. dedupKey wins when
    // present — healing/chatbot dispatches reuse the original stepId, and
    // keying them by stepId would collide with the already-claimed
    // original send and silently skip the healing send.
    const claimKey = dedupKey || (stepId ? `send:${enrollmentId}:${stepId}` : null);
    if (claimKey && !(await claimOnce(claimKey))) {
        console.log(`[EMAIL] duplicate dispatch, skipping (${claimKey})`);
        return { messageId: '' };
    }

    // Insert the execution-log row BEFORE sending so its id can key the
    // tracking URLs — opens/clicks then attribute to this exact send
    // instead of smearing across every enrollment on the step (review C8).
    const { data: logRow, error: logInsertError } = await supabase
        .from('sequence_execution_log')
        .insert({
            enrollment_id: enrollmentId,
            // Chatbot/healing ad-hoc sends arrive with an empty stepId — the column is a nullable UUID
            step_id: stepId || null,
            variant_id: variantId ?? null,
            channel: 'email',
            action: 'sending',
            status: 'executing',
            executed_at: new Date().toISOString(),
        })
        .select('id')
        .single();

    if (logInsertError) {
        console.error('[EMAIL] Error inserting execution log:', logInsertError);
    }
    const executionLogId: string | undefined = logRow?.id;

    // Prepare the HTML body: click tracking first, then the pixel, then the
    // unsubscribe footer (after rewriting, so the unsubscribe link itself is
    // never wrapped in the click tracker).
    let preparedHtml = bodyHtml;
    if (executionLogId) {
        preparedHtml = rewriteLinksForTracking(preparedHtml, executionLogId);
        preparedHtml = injectTrackingPixel(preparedHtml, executionLogId);
    } else {
        console.warn('[EMAIL] No execution log id — sending without open/click tracking');
    }
    preparedHtml = appendUnsubscribeFooter(
        preparedHtml,
        `${TRACKING_BASE_URL}/webhooks/email/unsubscribe/${enrollmentId}`
    );

    let result: { messageId: string };
    try {
        if (config.provider === 'gmail' && config.gmailAccessToken) {
            result = await sendViaGmailAPI(config, contactEmail, subject, preparedHtml, bodyText, enrollmentId);
        } else {
            result = await sendViaSMTP(config, contactEmail, subject, preparedHtml, bodyText, enrollmentId);
        }
    } catch (error: any) {
        // Mark the pre-inserted log row failed, release the send claim so a
        // legitimate BullMQ retry can resend, then rethrow.
        if (executionLogId) {
            const { error: failUpdateError } = await supabase
                .from('sequence_execution_log')
                .update({
                    action: 'failed',
                    status: 'failed',
                    error_message: error?.message || String(error),
                })
                .eq('id', executionLogId);

            if (failUpdateError) {
                console.error('[EMAIL] Error marking execution log failed:', failUpdateError);
            }
        }
        if (claimKey) {
            await releaseClaim(claimKey);
        }
        throw error;
    }

    console.log(`[EMAIL] Sent to ${contactEmail}, MessageId: ${result.messageId}`);

    // Update the execution-log row with the provider result
    if (executionLogId) {
        const { error: logUpdateError } = await supabase
            .from('sequence_execution_log')
            .update({
                action: 'sent',
                status: 'completed',
                provider_id: result.messageId,
                provider_response: result,
                email_status: 'sent',
                completed_at: new Date().toISOString(),
            })
            .eq('id', executionLogId);

        if (logUpdateError) {
            console.error('[EMAIL] Error updating execution log:', logUpdateError);
        }
    }

    // Increment the enrollment's emails_sent counter (review: was never incremented)
    const { error: rpcError } = await supabase.rpc('increment_enrollment_emails', { enrollment_id: enrollmentId });
    if (rpcError) {
        console.error(`[EMAIL] Failed to increment emails_sent for enrollment ${enrollmentId}:`, rpcError);
    }

    // Record interaction for conversation memory
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
