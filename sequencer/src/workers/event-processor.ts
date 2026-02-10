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
import {
    recordInteraction,
    updateInteraction,
    findInteractionByProviderId,
    updateContactConversationSummary,
} from '../lib/conversation-memory.js';
import {
    analyzeMessage,
    analyzeCallTranscript,
    updateEnrollmentEI,
    generateEINotifications,
    createNotification,
} from '../lib/emotional-intelligence.js';
import { handleFailure } from '../lib/self-healer.js';
import { computeStepAttribution } from '../lib/outcome-learning.js';
import type { EventJobPayload, EnrollmentStatus, EmotionalAnalysis, ContactInteraction, FailureType, ConversionType } from '../lib/types.js';

/**
 * Fetch recent interactions for a contact (for EI scoring and trend analysis)
 */
async function getRecentInteractions(contactId: string, limit: number = 10): Promise<ContactInteraction[]> {
    const { data } = await supabase
        .from('contact_interactions')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(limit);

    return (data as ContactInteraction[]) || [];
}

/**
 * Build a brief conversation history string for EI analysis context
 */
async function buildConversationHistoryString(contactId: string): Promise<string> {
    const interactions = await getRecentInteractions(contactId, 5);
    if (interactions.length === 0) return '';

    return interactions.reverse().map(i => {
        const dir = i.direction === 'inbound' ? 'Customer' : 'Agent';
        const ch = i.channel.toUpperCase();
        const content = i.content_summary || (i.content_body || '').substring(0, 100);
        return `[${ch}] ${dir}: ${content}`;
    }).join('\n');
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

            // Phase 5: Compute step attribution on conversion
            try {
                await computeStepAttribution(enrollmentId, 'booked');
            } catch (err) {
                console.error('[EVENT] Attribution computation failed:', err);
            }
        }
    }

    await updateEnrollmentStatus(enrollmentId, updates);

    // Phase 4: Self-Healing — trigger healing on call failures
    if (!wasAnswered && enrollmentId && event.stepId) {
        let callFailureType: FailureType | null = null;

        if (disposition === 'no-answer' || disposition === 'no_answer') {
            callFailureType = 'call_no_answer';
        } else if (disposition === 'busy') {
            callFailureType = 'call_busy';
        } else if (disposition === 'failed' || disposition === 'error') {
            callFailureType = 'call_failed';
        }
        // Note: voicemail is not a failure — it's a partial success

        if (callFailureType) {
            console.log(`[EVENT] Call failure (${callFailureType}) for enrollment ${enrollmentId} — triggering self-healing`);
            await handleFailure(enrollmentId, event.stepId, callFailureType, {
                disposition,
                duration,
                callId,
            });
        }
    }

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

    // 4. Run Emotional Intelligence analysis on the call transcript
    let eiAnalysis: EmotionalAnalysis | null = null;
    if (event.transcript && event.transcript.length > 30) {
        try {
            eiAnalysis = await analyzeCallTranscript(
                event.transcript,
                duration || 0,
                disposition || 'unknown'
            );
            console.log(`[EVENT] EI analysis: emotion=${eiAnalysis.primary_emotion}, intent=${eiAnalysis.intent}, hot=${eiAnalysis.is_hot_lead}`);
        } catch (err) {
            console.error('[EVENT] EI analysis failed for call transcript:', err);
        }
    }

    // 5. Update the voice interaction record with call outcome + EI data
    if (callId) {
        const existingInteraction = await findInteractionByProviderId(callId);
        if (existingInteraction) {
            await updateInteraction(existingInteraction.id, {
                content_body: event.transcript || null,
                outcome: wasAnswered ? 'answered' : (disposition as any) || 'failed',
                call_duration_seconds: duration || null,
                call_disposition: disposition || null,
                appointment_booked: appointmentBooked || false,
            });

            // Store EI analysis on the interaction
            if (eiAnalysis) {
                await supabase
                    .from('contact_interactions')
                    .update({ emotional_analysis: eiAnalysis })
                    .eq('id', existingInteraction.id);
            }
        }
    }

    // 6. Update the contact's rolling conversation summary
    if (enrollmentId) {
        const { data: enroll } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, contacts(name)')
            .eq('id', enrollmentId)
            .single();

        if (enroll?.contact_id) {
            await updateContactConversationSummary(enroll.contact_id);

            // 7. Update enrollment EI state + generate notifications
            if (eiAnalysis) {
                const interactions = await getRecentInteractions(enroll.contact_id);
                await updateEnrollmentEI(enrollmentId, eiAnalysis, interactions);

                const contactName = (enroll as any).contacts?.name || undefined;
                await generateEINotifications(
                    enroll.tenant_id,
                    enroll.contact_id,
                    enrollmentId,
                    eiAnalysis,
                    contactName
                );

                // Handle recommended actions from EI
                if (eiAnalysis.recommended_action === 'escalate_to_human') {
                    await supabase
                        .from('sequence_enrollments')
                        .update({
                            needs_human_intervention: true,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', enrollmentId);
                    console.log(`[EVENT] Enrollment ${enrollmentId} flagged for human intervention`);
                }
            }
        }
    }
}

/**
 * Handle SMS reply event — now powered by Emotional Intelligence
 */
async function handleSmsReply(event: EventJobPayload): Promise<void> {
    const { enrollmentId, tenantId, messageBody } = event;

    if (!messageBody) {
        console.log('[EVENT] No message body in SMS reply');
        return;
    }

    console.log(`[EVENT] SMS reply received: "${messageBody.substring(0, 50)}..."`);

    // 1. Run EI analysis on the reply (replaces old classifyReplyIntent)
    let eiAnalysis: EmotionalAnalysis | null = null;
    let conversationHistory = '';

    if (enrollmentId) {
        const { data: enroll } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, contacts(name)')
            .eq('id', enrollmentId)
            .single();

        if (enroll) {
            // Build conversation history for context-aware analysis
            conversationHistory = await buildConversationHistoryString(enroll.contact_id);

            // Analyze with full EI
            try {
                eiAnalysis = await analyzeMessage(messageBody, 'sms', conversationHistory);
                console.log(`[EVENT] EI analysis: emotion=${eiAnalysis.primary_emotion}, intent=${eiAnalysis.intent}, hot=${eiAnalysis.is_hot_lead}, at_risk=${eiAnalysis.is_at_risk}`);
            } catch (err) {
                console.error('[EVENT] EI analysis failed, using fallback:', err);
            }

            // Map EI sentiment for the interaction record
            const emotionToSentiment: Record<string, 'positive' | 'negative' | 'neutral' | 'interested' | 'objection' | 'confused'> = {
                excited: 'positive',
                interested: 'interested',
                neutral: 'neutral',
                hesitant: 'neutral',
                frustrated: 'negative',
                confused: 'confused',
                angry: 'negative',
                dismissive: 'negative',
            };

            const sentiment = eiAnalysis
                ? (emotionToSentiment[eiAnalysis.primary_emotion] || 'neutral')
                : 'neutral';

            const intent = eiAnalysis?.intent || 'unknown';

            // 2. Record inbound SMS interaction with EI data
            const interactionId = await recordInteraction({
                clientId: enroll.tenant_id,
                contactId: enroll.contact_id,
                enrollmentId,
                channel: 'sms',
                direction: 'inbound',
                contentBody: messageBody,
                outcome: 'replied',
                sentiment,
                intent: intent as any,
            });

            // Store full EI analysis on the interaction
            if (interactionId && eiAnalysis) {
                await supabase
                    .from('contact_interactions')
                    .update({
                        emotional_analysis: eiAnalysis,
                        engagement_score: eiAnalysis.is_hot_lead ? 80 : eiAnalysis.is_at_risk ? 25 : 50,
                    })
                    .eq('id', interactionId);
            }

            // 3. Update contact conversation summary
            await updateContactConversationSummary(enroll.contact_id);

            // 4. Update enrollment EI state + generate notifications
            if (eiAnalysis) {
                const interactions = await getRecentInteractions(enroll.contact_id);
                await updateEnrollmentEI(enrollmentId, eiAnalysis, interactions);

                const contactName = (enroll as any).contacts?.name || undefined;
                await generateEINotifications(
                    enroll.tenant_id,
                    enroll.contact_id,
                    enrollmentId,
                    eiAnalysis,
                    contactName
                );
            }
        }
    }

    if (!enrollmentId) {
        console.log('[EVENT] No enrollmentId in SMS reply, creating notification only');
        if (tenantId && messageBody) {
            await createNotification({
                clientId: tenantId,
                type: 'needs_human',
                title: 'SMS reply from untracked contact',
                body: `Reply: "${messageBody.substring(0, 100)}"`,
                priority: 'normal',
            });
        }
        return;
    }

    // 5. Update enrollment status based on EI intent (or fallback)
    const intent = eiAnalysis?.intent || 'unknown';

    switch (intent) {
        case 'stop':
            await updateEnrollmentStatus(enrollmentId, {
                status: 'manual_stop',
                contact_replied: true,
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} stopped (opt-out)`);
            break;

        case 'interested':
        case 'ready_to_buy':
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            console.log(`[EVENT] Hot lead! Enrollment ${enrollmentId} replied with: ${intent}`);

            // Phase 5: Compute attribution on positive reply (conversion event)
            try {
                await computeStepAttribution(enrollmentId, 'replied');
            } catch (err) {
                console.error('[EVENT] Attribution computation failed:', err);
            }
            break;

        case 'not_interested':
            await updateEnrollmentStatus(enrollmentId, {
                status: 'completed',
                contact_replied: true,
                completed_at: new Date().toISOString(),
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} not interested, sequence ended`);
            break;

        case 'objection':
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} raised objection — sequence continues with EI adjustments`);
            break;

        default:
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} replied (${intent})`);
    }

    // 6. Handle EI recommended actions
    if (eiAnalysis) {
        switch (eiAnalysis.recommended_action) {
            case 'escalate_to_human':
                await supabase
                    .from('sequence_enrollments')
                    .update({
                        needs_human_intervention: true,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                console.log(`[EVENT] Enrollment ${enrollmentId} escalated to human`);
                break;

            case 'fast_track':
                // Move the next step time to now (speed up the sequence)
                await supabase
                    .from('sequence_enrollments')
                    .update({
                        next_step_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                console.log(`[EVENT] Enrollment ${enrollmentId} fast-tracked — next step moved to now`);
                break;

            case 'end_sequence':
                // Already handled by 'stop' intent above
                break;
        }
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

    // Phase 4: Self-Healing — trigger healing on SMS delivery failures
    if (deliveryStatus === 'failed' || deliveryStatus === 'undelivered') {
        console.log(`[EVENT] SMS delivery failed for enrollment ${enrollmentId} — triggering self-healing`);

        if (enrollmentId && stepId) {
            const failureType: FailureType = deliveryStatus === 'undelivered'
                ? 'sms_undelivered'
                : 'sms_failed';

            await handleFailure(enrollmentId, stepId, failureType, {
                deliveryStatus,
                tenantId,
            });
        }
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

    // Update interaction record with opened status
    if (stepId) {
        const { data: logEntry } = await supabase
            .from('sequence_execution_log')
            .select('provider_id')
            .eq('step_id', stepId)
            .eq('channel', 'email')
            .single();

        if (logEntry?.provider_id) {
            const existing = await findInteractionByProviderId(logEntry.provider_id);
            if (existing) {
                await updateInteraction(existing.id, { outcome: 'opened' });
            }
        }
    }
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

    // Update interaction record with clicked status
    if (stepId) {
        const { data: logEntry } = await supabase
            .from('sequence_execution_log')
            .select('provider_id')
            .eq('step_id', stepId)
            .eq('channel', 'email')
            .single();

        if (logEntry?.provider_id) {
            const existing = await findInteractionByProviderId(logEntry.provider_id);
            if (existing) {
                await updateInteraction(existing.id, { outcome: 'clicked' });
            }
        }
    }
}

/**
 * Handle email bounced event (Phase 4: Self-Healing)
 */
async function handleEmailBounced(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId, tenantId } = event;
    const bounceType = (event as any).bounceType || 'hard'; // 'hard' or 'soft'

    console.log(`[EVENT] Email bounced (${bounceType}) for enrollment ${enrollmentId}`);

    if (stepId) {
        await supabase
            .from('sequence_execution_log')
            .update({ email_status: 'bounced' })
            .eq('step_id', stepId)
            .eq('channel', 'email');
    }

    // Update interaction record
    if (stepId) {
        const { data: logEntry } = await supabase
            .from('sequence_execution_log')
            .select('provider_id')
            .eq('step_id', stepId)
            .eq('channel', 'email')
            .single();

        if (logEntry?.provider_id) {
            const existing = await findInteractionByProviderId(logEntry.provider_id);
            if (existing) {
                await updateInteraction(existing.id, { outcome: 'bounced' });
            }
        }
    }

    // Trigger self-healing
    if (enrollmentId && stepId) {
        await handleFailure(enrollmentId, stepId, 'email_bounced', {
            bounceType,
            tenantId,
        });
    }
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

        case 'email-bounced':
            await handleEmailBounced(event);
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
