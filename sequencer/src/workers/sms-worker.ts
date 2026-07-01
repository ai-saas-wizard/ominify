/**
 * SMS Worker
 * 
 * Processes SMS sending jobs from the sms:send queue.
 * Uses tenant's Twilio subaccount for complete isolation.
 */

import 'dotenv/config';
import Twilio from 'twilio';
import { Worker, Job } from 'bullmq';
import { supabase } from '../lib/db.js';
import { redisConnection } from '../lib/redis.js';
import { decrypt } from '../lib/encryption.js';
import { recordInteraction } from '../lib/conversation-memory.js';
import { handleFailure } from '../lib/self-healer.js';
import { claimOnce, releaseClaim } from '../lib/idempotency.js';
import { isContactOptedOut } from '../lib/opt-out.js';
import type { SmsJobPayload, TenantTwilioAccount, PhoneType } from '../lib/types.js';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'http://localhost:3000';

interface TenantTwilioConfig {
    subaccountSid: string;
    authToken: string;
    messagingServiceSid: string | null;
    primaryPhoneNumber: string | null;
}

/**
 * Get tenant's Twilio configuration
 */
async function getTenantTwilioConfig(tenantId: string): Promise<TenantTwilioConfig | null> {
    // Schema keys these tables by client_id with a status column (review C1)
    const { data, error } = await supabase
        .from('tenant_twilio_accounts')
        .select('*')
        .eq('client_id', tenantId)
        .eq('status', 'active')
        .single();

    if (error || !data) {
        console.error(`[SMS] No Twilio config for tenant ${tenantId}:`, error);
        return null;
    }

    const account = data as TenantTwilioAccount;

    if (!account.subaccount_sid || !account.auth_token_encrypted) {
        console.error(`[SMS] Incomplete Twilio config for tenant ${tenantId}`);
        return null;
    }

    // Get primary phone number
    const { data: phoneData, error: phoneError } = await supabase
        .from('tenant_phone_numbers')
        .select('phone_number')
        .eq('client_id', tenantId)
        .eq('status', 'active')
        .eq('purpose', 'sequencer')
        .limit(1)
        .maybeSingle();

    if (phoneError) {
        console.error(`[SMS] Error fetching phone number for tenant ${tenantId}:`, phoneError);
    }

    return {
        subaccountSid: account.subaccount_sid,
        authToken: decrypt(account.auth_token_encrypted),
        messagingServiceSid: account.messaging_service_sid,
        primaryPhoneNumber: phoneData?.phone_number || null,
    };
}

/**
 * Check A2P registration status for tenant
 */
async function getA2PStatus(tenantId: string): Promise<{ campaignStatus: string }> {
    // tenant_a2p_registrations is keyed by client_id (review C1)
    const { data, error } = await supabase
        .from('tenant_a2p_registrations')
        .select('campaign_status')
        .eq('client_id', tenantId)
        .maybeSingle();

    if (error) {
        console.error(`[SMS] Error fetching A2P status for tenant ${tenantId}:`, error);
    }

    return {
        campaignStatus: data?.campaign_status || 'unknown',
    };
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
    smsStatus?: string;
    variantId?: string | null;
}): Promise<void> {
    const { error } = await supabase.from('sequence_execution_log').insert({
        enrollment_id: params.enrollmentId,
        // Chatbot/healing ad-hoc sends arrive with an empty stepId — the column is a nullable UUID
        step_id: params.stepId || null,
        variant_id: params.variantId ?? null,
        channel: params.channel,
        action: params.action,
        provider_id: params.providerId,
        provider_response: params.providerResponse,
        sms_status: params.smsStatus,
        executed_at: new Date().toISOString(),
    });

    if (error) {
        console.error('[SMS] Error logging execution:', error);
    }
}

/**
 * Update enrollment SMS count
 */
async function updateEnrollmentSmsCount(enrollmentId: string): Promise<void> {
    const { error } = await supabase.rpc('increment_enrollment_sms', { enrollment_id: enrollmentId });
    if (error) {
        console.error(`[SMS] Failed to increment sms_sent for enrollment ${enrollmentId}:`, error);
    }
}

/**
 * Phase 4: Detect phone type via Twilio Lookup API and cache it.
 * Only runs once per contact (checks if phone_type is already set).
 * If landline is detected, triggers self-healing.
 */
async function detectAndCachePhoneType(
    twilioClient: any,
    phone: string,
    enrollmentId: string,
    tenantId: string,
): Promise<PhoneType> {
    try {
        // Check if we already have phone_type cached for this contact
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .single();

        if (!enrollment) return 'unknown';

        const { data: contact } = await supabase
            .from('contacts')
            .select('phone_type')
            .eq('id', enrollment.contact_id)
            .single();

        // Already detected — skip lookup
        if (contact?.phone_type && contact.phone_type !== 'unknown') {
            if (contact.phone_type === 'landline') {
                // Trigger self-healing for landline (switch channel)
                const { data: step } = await supabase
                    .from('sequence_enrollments')
                    .select('current_step_order, sequence_id')
                    .eq('id', enrollmentId)
                    .single();

                if (step) {
                    const { data: currentStep } = await supabase
                        .from('sequence_steps')
                        .select('id')
                        .eq('sequence_id', step.sequence_id)
                        .eq('step_order', step.current_step_order)
                        .single();

                    if (currentStep) {
                        await handleFailure(enrollmentId, currentStep.id, 'landline_detected', {
                            phone_type: 'landline',
                        });
                    }
                }

                throw new Error('LANDLINE_DETECTED'); // Stop SMS processing
            }
            return contact.phone_type as PhoneType;
        }

        // Perform Twilio Lookup
        let phoneType: PhoneType = 'unknown';
        try {
            const lookup = await twilioClient.lookups.v2.phoneNumbers(phone).fetch({
                fields: 'line_type_intelligence',
            });

            const lineType = lookup?.lineTypeIntelligence?.type;
            if (lineType === 'landline' || lineType === 'fixedVoip') {
                phoneType = 'landline';
            } else if (lineType === 'mobile') {
                phoneType = 'mobile';
            } else if (lineType === 'voip' || lineType === 'nonFixedVoip') {
                phoneType = 'voip';
            }

            console.log(`[SMS] Phone type lookup for ${phone}: ${lineType} → ${phoneType}`);
        } catch (lookupErr) {
            console.log(`[SMS] Phone type lookup failed for ${phone}, continuing as unknown`);
        }

        // Cache the result on the contact
        await supabase
            .from('contacts')
            .update({ phone_type: phoneType })
            .eq('id', enrollment.contact_id);

        // If landline detected, trigger healing and abort SMS
        if (phoneType === 'landline') {
            const { data: step } = await supabase
                .from('sequence_enrollments')
                .select('current_step_order, sequence_id')
                .eq('id', enrollmentId)
                .single();

            if (step) {
                const { data: currentStep } = await supabase
                    .from('sequence_steps')
                    .select('id')
                    .eq('sequence_id', step.sequence_id)
                    .eq('step_order', step.current_step_order)
                    .single();

                if (currentStep) {
                    await handleFailure(enrollmentId, currentStep.id, 'landline_detected', {
                        phone_type: 'landline',
                    });
                }
            }

            throw new Error('LANDLINE_DETECTED');
        }

        return phoneType;
    } catch (err: any) {
        if (err.message === 'LANDLINE_DETECTED') throw err;
        console.log('[SMS] Phone type detection error (non-blocking):', err);
        return 'unknown';
    }
}

/**
 * SMS Worker processor
 */
async function processSmsJob(job: Job<SmsJobPayload>): Promise<{ sid: string; status: string }> {
    const { tenantId, contactPhone, body, enrollmentId, stepId, metadata } = job.data;
    // variantId/dedupKey are stamped by the scheduler (see lib/types.ts payload contract)
    const { variantId, dedupKey } = job.data as SmsJobPayload & { variantId?: string; dedupKey?: string };

    console.log(`[SMS] Processing job ${job.id} for tenant ${tenantId}, phone ${contactPhone}`);

    // Defense-in-depth opt-out gate (review C3): the scheduler checks too,
    // but ad-hoc dispatches (chatbot, healing) and races must never reach
    // an opted-out contact.
    const { data: enrollment, error: enrollmentError } = await supabase
        .from('sequence_enrollments')
        .select('contact_id, tenant_id')
        .eq('id', enrollmentId)
        .single();

    if (enrollmentError) {
        console.error(`[SMS] Error fetching enrollment ${enrollmentId}:`, enrollmentError);
        // Chatbot turns are recorded post-send from this enrollment row; a
        // send without the record corrupts conversation memory and the
        // MAX_CHATBOT_TURNS cap. Retry the job instead of sending blind.
        if (metadata?.source === 'chatbot') {
            throw new Error(`[SMS] Enrollment fetch failed for chatbot reply ${enrollmentId}: ${enrollmentError.message}`);
        }
    }

    if (enrollment?.contact_id) {
        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('opted_out_at')
            .eq('id', enrollment.contact_id)
            .single();

        if (contactError) {
            console.error(`[SMS] Error fetching contact ${enrollment.contact_id}:`, contactError);
        }

        if (isContactOptedOut(contact)) {
            console.log(`[SMS] Contact ${enrollment.contact_id} is opted out — skipping send for enrollment ${enrollmentId}`);
            return { sid: '', status: 'skipped_opted_out' };
        }
    }

    // Get tenant's Twilio subaccount credentials
    const config = await getTenantTwilioConfig(tenantId);

    if (!config) {
        throw new Error(`No Twilio configuration for tenant ${tenantId}`);
    }

    // Check A2P registration status
    const a2p = await getA2PStatus(tenantId);
    if (a2p.campaignStatus !== 'approved') {
        console.log(`[SMS] Tenant ${tenantId}: A2P not yet approved (${a2p.campaignStatus}). Sending at reduced throughput.`);
    }

    // Create Twilio client with subaccount credentials
    const client = Twilio(config.subaccountSid, config.authToken);

    // Phase 4: Phone type detection — check if the number is a landline on first SMS
    await detectAndCachePhoneType(client, contactPhone, enrollmentId, tenantId);

    // Prepare message options
    const messageOptions: any = {
        to: contactPhone,
        body: body,
        statusCallback: `${WEBHOOK_BASE_URL}/webhooks/twilio/sms-status/${tenantId}`,
    };

    // Use Messaging Service if available (for A2P), otherwise use direct number
    if (config.messagingServiceSid) {
        messageOptions.messagingServiceSid = config.messagingServiceSid;
    } else if (config.primaryPhoneNumber) {
        messageOptions.from = config.primaryPhoneNumber;
    } else {
        throw new Error(`No phone number or messaging service for tenant ${tenantId}`);
    }

    // Send idempotency (review C5): claim before the provider call so a
    // duplicate dispatch (lease expiry, stalled-job retry) cannot re-text
    // the lead. dedupKey wins when present — healing/chatbot dispatches
    // reuse the original stepId, and keying them by stepId would collide
    // with the already-claimed original send and silently skip them.
    const claimKey = dedupKey || (stepId ? `send:${enrollmentId}:${stepId}` : null);
    if (claimKey && !(await claimOnce(claimKey))) {
        console.log(`[SMS] duplicate dispatch, skipping (${claimKey})`);
        return { sid: '', status: 'duplicate_skipped' };
    }

    // Send the message
    let message;
    try {
        message = await client.messages.create(messageOptions);
    } catch (error) {
        // Release the claim so a legitimate BullMQ retry can resend
        if (claimKey) {
            await releaseClaim(claimKey);
        }
        throw error;
    }

    console.log(`[SMS] Sent to ${contactPhone}, SID: ${message.sid}, Status: ${message.status}`);

    // Log execution
    await logExecution({
        enrollmentId,
        stepId,
        channel: 'sms',
        action: 'sent',
        providerId: message.sid,
        providerResponse: {
            sid: message.sid,
            status: message.status,
            to: message.to,
            dateCreated: message.dateCreated,
        },
        smsStatus: message.status,
        variantId: variantId ?? null,
    });

    // Increment the enrollment's sms_sent counter (review C7: was never called)
    await updateEnrollmentSmsCount(enrollmentId);

    // Record interaction for conversation memory. Ad-hoc sends (e.g. chatbot
    // replies) pass metadata through the job so it's recorded exactly once here
    // after a confirmed send, rather than at enqueue time by the caller.
    if (enrollment) {
        await recordInteraction({
            clientId: enrollment.tenant_id,
            contactId: enrollment.contact_id,
            enrollmentId,
            stepId,
            channel: 'sms',
            direction: 'outbound',
            contentBody: body,
            outcome: 'delivered',
            providerId: message.sid,
            metadata,
        });
    }

    return { sid: message.sid, status: message.status };
}

// Create the worker
const smsWorker = new Worker<SmsJobPayload>('sms-send', processSmsJob, {
    connection: redisConnection,
    concurrency: 10,
    limiter: {
        max: 100,
        duration: 1000, // 100 messages per second
    },
});

// Event listeners
smsWorker.on('completed', (job, result) => {
    console.log(`[SMS] Job ${job.id} completed:`, result);
});

smsWorker.on('failed', (job, error) => {
    console.error(`[SMS] Job ${job?.id} failed:`, error.message);
});

smsWorker.on('error', (error) => {
    console.error('[SMS] Worker error:', error);
});

console.log('[SMS] SMS worker started');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[SMS] Received SIGTERM, closing worker...');
    await smsWorker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SMS] Received SIGINT, closing worker...');
    await smsWorker.close();
    process.exit(0);
});

export { smsWorker };
