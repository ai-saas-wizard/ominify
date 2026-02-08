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
 * Get tenant's email configuration
 * For now, use a simple SMTP config from env or tenant settings
 */
async function getTenantEmailConfig(tenantId: string): Promise<TenantEmailConfig | null> {
    // In production, fetch from tenant_email_accounts table
    // For now, use environment defaults

    const { data } = await supabase
        .from('tenant_profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .single();

    if (!data) {
        console.error(`[EMAIL] No tenant profile for ${tenantId}`);
        return null;
    }

    // Default SMTP config from environment
    // In production, each tenant would have their own email config
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

/**
 * Send email via SMTP
 */
async function sendViaSMTP(
    config: TenantEmailConfig,
    to: string,
    subject: string,
    html: string,
    text: string
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

    const result = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to,
        subject,
        html,
        text,
    });

    return { messageId: result.messageId };
}

/**
 * Send email via Gmail API
 * TODO: Implement Gmail OAuth flow and API sending
 */
async function sendViaGmailAPI(
    config: TenantEmailConfig,
    to: string,
    subject: string,
    html: string,
    text: string
): Promise<{ messageId: string }> {
    // Placeholder - would use googleapis library
    throw new Error('Gmail API not yet implemented');
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
        result = await sendViaGmailAPI(config, contactEmail, subject, bodyHtml, bodyText);
    } else {
        result = await sendViaSMTP(config, contactEmail, subject, bodyHtml, bodyText);
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

    return result;
}

// Create the worker
const emailWorker = new Worker<EmailJobPayload>('email:send', processEmailJob, {
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
