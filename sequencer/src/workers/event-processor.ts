/**
 * Event Processor Worker
 * 
 * Processes webhook events from the events:process queue.
 * Updates enrollment state based on channel outcomes.
 * 
 * Event types handled:
 * - call-outcome: VAPI call ended
 * - sms-reply: Inbound SMS received
 * - sms-delivery: SMS delivery status update
 * - email-opened: Email tracking pixel hit
 * - email-clicked: Email link clicked
 */

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { supabase } from '../lib/db.js';
import { redisConnection } from '../lib/redis.js';
import { concurrencyManager } from '../lib/concurrency-manager.js';
import type { EventJobPayload, EnrollmentStatus } from '../lib/types.js';

/**
 * AI classification of SMS reply intent
 * In production, this would use OpenAI
 */
async function classifyReplyIntent(messageBody: string): Promise<'interested' | 'not_interested' | 'reschedule' | 'stop' | 'question' | 'unknown'> {
    const lowerBody = messageBody.toLowerCase();

    // Simple keyword matching - replace with AI classification
    if (['stop', 'unsubscribe', 'remove', 'opt out', 'dont text', "don't text"].some(kw => lowerBody.includes(kw))) {
        return 'stop';
    }

    if (['not interested', 'no thanks', 'no thank you', 'remove me'].some(kw => lowerBody.includes(kw))) {
        return 'not_interested';
    }

    if (['yes', 'interested', 'call me', 'tell me more', 'more info'].some(kw => lowerBody.includes(kw))) {
        return 'interested';
    }

    if (['reschedule', 'different time', 'not now', 'later', 'busy'].some(kw => lowerBody.includes(kw))) {
        return 'reschedule';
    }

    if (lowerBody.includes('?')) {
        return 'question';
    }

    return 'unknown';
}

/**
 * Update enrollment status
 */
async function updateEnrollmentStatus(
    enrollmentId: string,
    updates: Partial<{
        status: EnrollmentStatus;
        contact_replied: boolean;
        contact_answered_call: boolean;
        appointment_booked: boolean;
        completed_at: string;
        calls_made: number;
    }>
): Promise<void> {
    await supabase
        .from('sequence_enrollments')
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
}

/**
 * Handle call outcome event
 */
async function handleCallOutcome(event: EventJobPayload): Promise<void> {
    const { enrollmentId, umbrellaId, tenantId, disposition, appointmentBooked, duration, callId } = event;

    console.log(`[EVENT] Call outcome: ${disposition}, duration: ${duration}s, booked: ${appointmentBooked}`);

    // 1. Release concurrency slot
    if (umbrellaId && tenantId) {
        await concurrencyManager.release(umbrellaId, tenantId);
        console.log(`[EVENT] Released concurrency slot for umbrella ${umbrellaId}, tenant ${tenantId}`);
    }

    if (!enrollmentId) {
        console.log('[EVENT] No enrollmentId in call outcome, skipping enrollment update');
        return;
    }

    // 2. Update enrollment based on outcome
    const wasAnswered = disposition === 'answered' || disposition === 'completed';

    // Increment calls_made
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('calls_made')
        .eq('id', enrollmentId)
        .single();

    const updates: Partial<{
        status: EnrollmentStatus;
        contact_replied: boolean;
        contact_answered_call: boolean;
        appointment_booked: boolean;
        completed_at: string;
        calls_made: number;
    }> = {
        calls_made: (enrollment?.calls_made || 0) + 1,
    };

    if (wasAnswered) {
        updates.contact_answered_call = true;

        if (appointmentBooked) {
            updates.status = 'booked';
            updates.appointment_booked = true;
            updates.completed_at = new Date().toISOString();
            console.log(`[EVENT] Enrollment ${enrollmentId} marked as BOOKED`);
        }
    }

    await updateEnrollmentStatus(enrollmentId, updates);

    // 3. Update execution log with final call details
    await supabase
        .from('sequence_execution_log')
        .update({
            call_duration_seconds: duration,
            call_status: disposition,
            call_transcript: event.transcript,
            provider_response: { disposition, duration, appointmentBooked },
        })
        .eq('provider_id', callId);
}

/**
 * Handle SMS reply event
 */
async function handleSmsReply(event: EventJobPayload): Promise<void> {
    const { enrollmentId, tenantId, messageBody } = event;

    if (!messageBody) {
        console.log('[EVENT] No message body in SMS reply');
        return;
    }

    console.log(`[EVENT] SMS reply received: "${messageBody.substring(0, 50)}..."`);

    // Classify the reply intent
    const intent = await classifyReplyIntent(messageBody);
    console.log(`[EVENT] Reply intent: ${intent}`);

    if (!enrollmentId) {
        console.log('[EVENT] No enrollmentId in SMS reply, creating notification only');
        // TODO: Create notification for tenant
        return;
    }

    switch (intent) {
        case 'stop':
            await updateEnrollmentStatus(enrollmentId, {
                status: 'manual_stop',
                contact_replied: true,
            });
            // TODO: Add to opt-out list
            console.log(`[EVENT] Enrollment ${enrollmentId} stopped (opt-out)`);
            break;

        case 'interested':
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            // TODO: Notify tenant: "Hot lead replied!"
            console.log(`[EVENT] Hot lead! Enrollment ${enrollmentId} replied with interest`);
            break;

        case 'not_interested':
            await updateEnrollmentStatus(enrollmentId, {
                status: 'completed',
                contact_replied: true,
                completed_at: new Date().toISOString(),
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} not interested, sequence ended`);
            break;

        default:
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            // TODO: Notify tenant of reply
            console.log(`[EVENT] Enrollment ${enrollmentId} replied (${intent})`);
    }
}

/**
 * Handle SMS delivery status
 */
async function handleSmsDelivery(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId, deliveryStatus, tenantId } = event;

    console.log(`[EVENT] SMS delivery status: ${deliveryStatus}`);

    if (stepId) {
        await supabase
            .from('sequence_execution_log')
            .update({
                sms_status: deliveryStatus,
            })
            .eq('step_id', stepId)
            .eq('channel', 'sms');
    }

    // Handle failures
    if (deliveryStatus === 'failed' || deliveryStatus === 'undelivered') {
        // TODO: Increment failure count, potentially pause sequence
        console.log(`[EVENT] SMS delivery failed for enrollment ${enrollmentId}`);
    }
}

/**
 * Handle email opened event
 */
async function handleEmailOpened(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId } = event;

    console.log(`[EVENT] Email opened for enrollment ${enrollmentId}`);

    if (stepId) {
        await supabase
            .from('sequence_execution_log')
            .update({
                email_status: 'opened',
            })
            .eq('step_id', stepId)
            .eq('channel', 'email');
    }

    // Track engagement metrics
    // TODO: This could influence branching logic
}

/**
 * Handle email clicked event
 */
async function handleEmailClicked(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId } = event;

    console.log(`[EVENT] Email link clicked for enrollment ${enrollmentId}`);

    if (stepId) {
        await supabase
            .from('sequence_execution_log')
            .update({
                email_status: 'clicked',
            })
            .eq('step_id', stepId)
            .eq('channel', 'email');
    }

    // High engagement - potentially fast-track this contact
    // TODO: Notify tenant of engaged lead
}

/**
 * Event Processor processor
 */
async function processEvent(job: Job<EventJobPayload>): Promise<void> {
    const event = job.data;

    console.log(`[EVENT] Processing event: ${event.type}`);

    switch (event.type) {
        case 'call-outcome':
            await handleCallOutcome(event);
            break;

        case 'sms-reply':
            await handleSmsReply(event);
            break;

        case 'sms-delivery':
            await handleSmsDelivery(event);
            break;

        case 'email-opened':
            await handleEmailOpened(event);
            break;

        case 'email-clicked':
            await handleEmailClicked(event);
            break;

        default:
            console.log(`[EVENT] Unknown event type: ${event.type}`);
    }
}

// Create the worker
const eventWorker = new Worker<EventJobPayload>('events:process', processEvent, {
    connection: redisConnection,
    concurrency: 10,
});

// Event listeners
eventWorker.on('completed', (job) => {
    console.log(`[EVENT] Job ${job.id} completed`);
});

eventWorker.on('failed', (job, error) => {
    console.error(`[EVENT] Job ${job?.id} failed:`, error.message);
});

eventWorker.on('error', (error) => {
    console.error('[EVENT] Worker error:', error);
});

console.log('[EVENT] Event processor started');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[EVENT] Received SIGTERM, closing worker...');
    await eventWorker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[EVENT] Received SIGINT, closing worker...');
    await eventWorker.close();
    process.exit(0);
});

export { eventWorker };
