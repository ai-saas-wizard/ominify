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
    summarizeInteraction,
    getConversationContext as getConvCtx,
} from '../lib/conversation-memory.js';
import {
    analyzeMessage,
    analyzeCallTranscript,
    updateEnrollmentEI,
    generateEINotifications,
    createNotification,
} from '../lib/emotional-intelligence.js';
import { handleFailure } from '../lib/self-healer.js';
import {
    isStopMessage,
    isStopEmailBody,
    isStartMessage,
    isHelpMessage,
    isContactOptedOut,
    optOutContact,
    reoptInContact,
} from '../lib/opt-out.js';
import { getTenantCapableChannels } from '../lib/channel-capabilities.js';
import { isTCPACompliant, getNextBusinessHoursStart } from '../lib/compliance.js';
import { computeStepAttribution } from '../lib/outcome-learning.js';
import { phoneLookupCandidates } from '../lib/phone.js';
import {
    generateNextStep,
    getExecutedSteps,
    claimEnrollmentForGeneration,
    insertGeneratedStep,
    getSequenceVapiAssistantId,
    endDynamicSequence,
    activateEnrollmentForNextStep,
} from '../lib/dynamic-step-generator.js';
import { handleInboundSMS } from '../lib/sms-responder.js';
import { handleInboundEmail } from '../lib/email-responder.js';
import { autoAdvancePipelineStage } from '../lib/pipeline-advance.js';
import { smsQueue, emailQueue } from '../lib/redis.js';
import { clampTestDelayMs } from '../lib/test-mode.js';
import type {
    EventJobPayload,
    EnrollmentStatus,
    EmotionalAnalysis,
    ContactInteraction,
    FailureType,
    ConversionType,
    Sequence,
    SequenceEnrollment,
    Contact,
    TenantProfile,
    OutcomeContext,
    ChannelType,
    ConversationContext,
    TriggeringStepContext,
    EmailReplyMode,
} from '../lib/types.js';

/**
 * How long to hold a sequence while a lead is actively conversing with the SMS
 * chatbot, so a scheduled template step can't fire over the live chat. The hold
 * rolls forward on every inbound reply and lapses after this much silence, at
 * which point the normal schedule resumes (dynamic: outcome_timeout_at fires
 * and JIT-generates the next step; static: next_step_at comes due and the
 * scheduler sends the next template touch).
 */
const CHATBOT_CONVERSATION_HOLD_MS = 24 * 60 * 60 * 1000; // 24h

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
 * A/B variant attribution (last-touch): credit the most recently sent
 * variant for this enrollment with a reply or a conversion. Closes the
 * learning loop — step_variants counters were previously written nowhere.
 */
async function attributeVariantOutcome(
    enrollmentId: string,
    kind: 'reply' | 'conversion'
): Promise<void> {
    const { data: logRow, error: logErr } = await supabase
        .from('sequence_execution_log')
        .select('variant_id')
        .eq('enrollment_id', enrollmentId)
        .not('variant_id', 'is', null)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (logErr) {
        console.error(`[EVENT] Variant attribution lookup failed for enrollment ${enrollmentId}:`, logErr);
        return;
    }
    if (!logRow?.variant_id) return;

    const rpcName = kind === 'reply' ? 'increment_variant_replies' : 'increment_variant_conversions';
    const { error: rpcErr } = await supabase.rpc(rpcName, { p_variant_id: logRow.variant_id });
    if (rpcErr) {
        console.error(`[EVENT] ${rpcName} failed for variant ${logRow.variant_id}:`, rpcErr);
    } else {
        console.log(`[EVENT] Variant ${logRow.variant_id} credited with ${kind} (enrollment ${enrollmentId})`);
    }
}

/**
 * Maybe trigger dynamic (JIT) step generation after an outcome event.
 * Only fires for dynamic sequences where enrollment is awaiting_outcome.
 */
async function maybeTriggerDynamicGeneration(
    enrollmentId: string,
    outcomeCtx: OutcomeContext
): Promise<void> {
    // 1. Fetch enrollment with sequence join
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('*, sequences(*), contacts(*)')
        .eq('id', enrollmentId)
        .single();

    if (!enrollment) return;

    const sequence = (enrollment as any).sequences as Sequence;
    const contact = (enrollment as any).contacts as Contact;

    // 2. Guard: not a dynamic sequence
    if (sequence?.generation_mode !== 'dynamic') return;

    // 3. Guard: not awaiting outcome (already handled, terminal, or claimed)
    if (enrollment.status !== 'awaiting_outcome') return;

    // 4. Guard: needs_human_intervention — don't auto-generate
    if ((enrollment as any).needs_human_intervention) {
        console.log(`[EVENT] Dynamic gen skipped for ${enrollmentId} — needs human intervention`);
        return;
    }

    // 5. Atomic claim
    const claimed = await claimEnrollmentForGeneration(enrollmentId);
    if (!claimed) {
        console.log(`[EVENT] Dynamic gen for ${enrollmentId} already claimed — skipping`);
        return;
    }

    try {
        // 6. Load tenant profile
        const { data: tenantProfile } = await supabase
            .from('tenant_profiles')
            .select('*')
            .eq('client_id', enrollment.tenant_id)
            .single();

        if (!tenantProfile) {
            await endDynamicSequence(enrollmentId, 'no_profile', 'Tenant profile not found');
            return;
        }

        // 7. Load conversation context + executed steps
        let conversationCtx: ConversationContext | null = null;
        try {
            conversationCtx = await getConvCtx(contact.id, enrollmentId);
        } catch { /* proceed without */ }

        const executedSteps = await getExecutedSteps(sequence.id, enrollmentId);

        // 8. Generate next step
        const result = await generateNextStep({
            enrollment: enrollment as SequenceEnrollment,
            sequence,
            contact,
            tenantProfile: tenantProfile as TenantProfile,
            conversationContext: conversationCtx,
            lastOutcome: outcomeCtx,
            previousSteps: executedSteps,
        });

        // 9. Insert step or end sequence
        if (result.should_continue && result.step) {
            const newStepOrder = (enrollment.current_step_order || 0) + 1;
            const vapiId = await getSequenceVapiAssistantId(sequence.id);

            const insertedStep = await insertGeneratedStep({
                sequenceId: sequence.id,
                enrollmentId,
                stepOrder: newStepOrder,
                result,
                vapiAssistantId: vapiId,
            });

            if (!insertedStep) {
                // Hard failure inserting the generated step — do NOT activate,
                // or the scheduler would dispatch whatever row sits at that
                // step_order (possibly another lead's content). Revert so the
                // timeout path can retry.
                console.error(`[EVENT] insertGeneratedStep returned null for ${enrollmentId} (step ${newStepOrder}) — reverting to awaiting_outcome`);
                const { error: revertErr } = await supabase
                    .from('sequence_enrollments')
                    .update({ status: 'awaiting_outcome', updated_at: new Date().toISOString() })
                    .eq('id', enrollmentId);
                if (revertErr) {
                    console.error(`[EVENT] Failed to revert ${enrollmentId} to awaiting_outcome:`, revertErr);
                }
                return;
            }

            await activateEnrollmentForNextStep(
                enrollmentId,
                result.step.delay_seconds || 0,
                enrollment.current_step_order,
                (enrollment as any).is_test === true
            );
        } else if (result.end_reason === 'generation_failed') {
            // Transient LLM failure (empty/invalid response) — retry via the
            // timeout poll instead of permanently ending the sequence.
            console.error(`[EVENT] Generation failed for enrollment ${enrollmentId} — retrying in 15min`);
            const { error: retryErr } = await supabase
                .from('sequence_enrollments')
                .update({
                    status: 'awaiting_outcome',
                    // Clamped for test enrollments — a 15min park on a
                    // transient LLM failure makes a test look dead.
                    outcome_timeout_at: new Date(
                        Date.now() + clampTestDelayMs(15 * 60 * 1000, (enrollment as any).is_test === true)
                    ).toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);
            if (retryErr) {
                console.error(`[EVENT] Failed to schedule generation retry for ${enrollmentId}:`, retryErr);
            }
        } else {
            await endDynamicSequence(enrollmentId, result.end_reason || 'ai_decided', result.reasoning);
        }
    } catch (error) {
        console.error(`[EVENT] Dynamic generation failed for ${enrollmentId}:`, error);
        // Revert to awaiting_outcome so timeout can retry
        const { error: revertErr } = await supabase
            .from('sequence_enrollments')
            .update({ status: 'awaiting_outcome', updated_at: new Date().toISOString() })
            .eq('id', enrollmentId);
        if (revertErr) {
            console.error(`[EVENT] Failed to revert ${enrollmentId} to awaiting_outcome:`, revertErr);
        }
    }
}

/** EI intents that read as a positive call for the booking-link follow-up. */
const BOOKING_LINK_POSITIVE_INTENTS = new Set(['interested', 'ready_to_buy']);

/**
 * Deterministic booking-link SMS after a positive answered call.
 *
 * When a call was answered, NO appointment was booked on it, and the EI
 * analysis reads the lead as positive (hot lead or interested/ready-to-buy
 * intent), text the tenant's booking link right away instead of relying on
 * the AI's next generated step to remember to include one.
 *
 * Skips silently when no booking_link is configured or the tenant can't send
 * SMS. Honors contact opt-out; outside the TCPA window the job is queued with
 * a delay to the next business-hours start (same policy as healing sends).
 */
async function maybeSendBookingLinkSms(
    enrollmentId: string,
    callId: string | undefined,
    eiAnalysis: EmotionalAnalysis | null
): Promise<void> {
    if (!eiAnalysis) return;
    if (!eiAnalysis.is_hot_lead && !BOOKING_LINK_POSITIVE_INTENTS.has(eiAnalysis.intent)) return;

    const { data: enrollment, error: enrollErr } = await supabase
        .from('sequence_enrollments')
        .select('contact_id, tenant_id, status, appointment_booked, is_test, contacts(phone, first_name, name, opted_out_at)')
        .eq('id', enrollmentId)
        .single();

    if (enrollErr || !enrollment) {
        if (enrollErr) {
            console.error(`[EVENT] Booking-link SMS: enrollment fetch failed for ${enrollmentId}:`, enrollErr);
        }
        return;
    }

    // Already booked (e.g. on an earlier call) — nothing to invite them to.
    if (enrollment.appointment_booked || enrollment.status === 'booked') return;

    const contact = (enrollment as any).contacts as {
        phone?: string | null;
        first_name?: string | null;
        name?: string | null;
        opted_out_at?: string | null;
    } | null;
    if (!contact?.phone) return;
    if (isContactOptedOut(contact)) {
        console.log(`[EVENT] Booking-link SMS skipped for ${enrollmentId} — contact opted out`);
        return;
    }

    const { data: profile, error: profileErr } = await supabase
        .from('tenant_profiles')
        .select('booking_link, timezone, business_hours')
        .eq('client_id', enrollment.tenant_id)
        .maybeSingle();
    if (profileErr) {
        console.error(`[EVENT] Booking-link SMS: profile fetch failed for tenant ${enrollment.tenant_id}:`, profileErr);
        return;
    }

    const bookingLink = (profile?.booking_link || '').trim();
    if (!bookingLink) return; // not configured — silent skip

    const capableChannels = await getTenantCapableChannels(enrollment.tenant_id);
    if (!capableChannels.includes('sms')) return; // tenant can't send SMS — silent skip

    // TCPA: never text outside the 8am-9pm window — delay to the next
    // business-hours start instead of dropping the send.
    const timezone = profile?.timezone || 'America/New_York';
    let delayMs = 0;
    if (!isTCPACompliant(timezone)) {
        const resumeAt = getNextBusinessHoursStart(timezone, profile?.business_hours || null, new Date());
        delayMs = Math.max(0, resumeAt.getTime() - Date.now());
    }
    delayMs = clampTestDelayMs(delayMs, (enrollment as any).is_test === true);

    const firstName = contact.first_name || contact.name?.split(' ')[0] || '';
    const body = `${firstName ? `${firstName}, great` : 'Great'} talking with you just now! You can grab a time that works for you here: ${bookingLink}`;

    await smsQueue.add('sms:booking-link', {
        tenantId: enrollment.tenant_id,
        contactPhone: contact.phone,
        body,
        enrollmentId,
        stepId: null,
        // One send per call: a replayed/retried call-outcome event for the
        // same callId must not re-text the link.
        dedupKey: `booking-link:${enrollmentId}:${callId || 'no-call-id'}`,
        metadata: { source: 'booking_link', callId: callId || null },
    }, delayMs > 0 ? { delay: delayMs } : {});

    console.log(
        `[EVENT] Booking-link SMS queued for enrollment ${enrollmentId}` +
        (delayMs > 0 ? ` (delayed ${Math.round(delayMs / 1000)}s for TCPA window)` : '')
    );
}

/**
 * Handle call outcome event
 */
async function handleCallOutcome(event: EventJobPayload): Promise<void> {
    const { enrollmentId, umbrellaId, tenantId, disposition, appointmentBooked, duration, callId } = event;

    console.log(`[EVENT] Call outcome: ${disposition}, duration: ${duration}s, booked: ${appointmentBooked}`);

    // 1. Release concurrency slot (pass the slot token so only the slot
    // this enrollment actually holds is released)
    if (umbrellaId && tenantId) {
        await concurrencyManager.release(umbrellaId, tenantId, enrollmentId);
        console.log(`[EVENT] Released concurrency slot for umbrella ${umbrellaId}, tenant ${tenantId}`);
    }

    if (!enrollmentId) {
        console.log('[EVENT] No enrollmentId in call outcome, skipping enrollment update');
        return;
    }

    // 2. Update enrollment based on outcome
    // "transferred" counts as answered — the caller spoke to the bot and was connected to a human
    const wasAnswered = disposition === 'answered' || disposition === 'completed' || disposition === 'transferred';

    // Increment calls_made atomically (the old select-then-update raced
    // concurrent outcome events and lost increments)
    const { error: callsErr } = await supabase.rpc('increment_enrollment_calls', {
        enrollment_id: enrollmentId,
    });
    if (callsErr) {
        console.error(`[EVENT] increment_enrollment_calls failed for ${enrollmentId}:`, callsErr);
    }

    const updates: Partial<{
        status: EnrollmentStatus;
        contact_replied: boolean;
        contact_answered_call: boolean;
        appointment_booked: boolean;
        completed_at: string;
        calls_made: number;
    }> = {};

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

            // A/B loop: credit the last-sent variant with the conversion
            await attributeVariantOutcome(enrollmentId, 'conversion');
        }
    }

    if (Object.keys(updates).length > 0) {
        await updateEnrollmentStatus(enrollmentId, updates);
    }

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
        // Note: transferred calls are successful — caller reached a human

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
            // Derive clean, structured call context so downstream messaging
            // (SMS generation + inbound replies) sees a real summary + the
            // objections/topics raised on the call — not a raw transcript
            // truncation. Without this, getConversationContext().last_call has
            // an empty objections list and the timeline shows raw transcript.
            const callObjections = (eiAnalysis?.objections || [])
                .map((o) => (o.detail ? `${o.type}: ${o.detail}` : o.type))
                .filter(Boolean);
            const callKeyTopics = (eiAnalysis?.buying_signals || [])
                .map((s) => s.signal)
                .filter(Boolean);
            let callSummary: string | null = null;
            if (event.transcript && event.transcript.length > 30) {
                try {
                    callSummary = await summarizeInteraction(
                        'voice',
                        existingInteraction.direction,
                        event.transcript,
                        disposition || undefined
                    );
                } catch (err) {
                    console.error('[EVENT] Failed to summarize call transcript:', err);
                }
            }

            await updateInteraction(existingInteraction.id, {
                content_body: event.transcript || null,
                content_summary: callSummary || undefined,
                outcome: wasAnswered ? 'answered' : (disposition as any) || 'failed',
                call_duration_seconds: duration || null,
                call_disposition: disposition || null,
                appointment_booked: appointmentBooked || false,
                objections_raised: callObjections.length ? callObjections : undefined,
                key_topics: callKeyTopics.length ? callKeyTopics : undefined,
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

                // Handle recommended actions from EI. Push outcome_timeout_at
                // forward so the dynamic timeout generator doesn't race the human.
                if (eiAnalysis.recommended_action === 'escalate_to_human') {
                    const { error: escErr } = await supabase
                        .from('sequence_enrollments')
                        .update({
                            needs_human_intervention: true,
                            outcome_timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', enrollmentId);
                    if (escErr) {
                        console.error(`[EVENT] Failed to flag ${enrollmentId} for human intervention:`, escErr);
                    } else {
                        console.log(`[EVENT] Enrollment ${enrollmentId} flagged for human intervention`);
                    }
                }
            }
        }
    }

    // 8. Pipeline auto-advance based on call outcome
    if (enrollmentId) {
        const { data: enrollForPipeline } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, is_hot_lead')
            .eq('id', enrollmentId)
            .single();

        if (enrollForPipeline?.contact_id && enrollForPipeline?.tenant_id) {
            if (wasAnswered) {
                await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Engaged');
            }
            if (appointmentBooked) {
                await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Booked');
            }
            if (eiAnalysis?.is_hot_lead || enrollForPipeline.is_hot_lead) {
                await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Qualified');
            }
        }
    }

    // 8b. Deterministic booking-link SMS — an answered call that ended
    // positive but WITHOUT a booking gets the tenant's booking link texted.
    // 'transferred' is deliberately excluded: a human took over that call.
    if (enrollmentId && (disposition === 'answered' || disposition === 'completed') && !appointmentBooked) {
        try {
            await maybeSendBookingLinkSms(enrollmentId, callId, eiAnalysis);
        } catch (err) {
            console.error(`[EVENT] Booking-link SMS failed for ${enrollmentId}:`, err);
        }
    }

    // 9. Dynamic (JIT) step generation — trigger on call outcome (call is over)
    if (enrollmentId) {
        const outcomeCtx: OutcomeContext = {
            type: wasAnswered ? 'call_answered'
                : disposition === 'voicemail' ? 'call_voicemail'
                : disposition === 'busy' ? 'call_busy'
                : disposition === 'failed' || disposition === 'error' ? 'call_failed'
                : 'call_no_answer',
            details: `disposition: ${disposition}, duration: ${duration}s, booked: ${appointmentBooked}`,
            channel: 'voice',
            eiAnalysis: eiAnalysis || undefined,
        };
        await maybeTriggerDynamicGeneration(enrollmentId, outcomeCtx);
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

    // Fetch the enrollment up front. supabase-js returns {error} instead of
    // throwing, so we MUST inspect it: a transient failure here used to yield
    // enroll=null, which silently skipped the STOP check below and let the job
    // "complete" with no BullMQ retry. We capture the error and (a) still honor
    // STOP/START/HELP at the CONTACT level via a phone lookup that needs no
    // enrollment, and (b) throw so the rest of the handler is retried.
    let enroll: { contact_id: string; tenant_id: string; contacts?: { name?: string | null } | null } | null = null;
    let enrollFetchError: { message: string } | null = null;
    if (enrollmentId) {
        const { data, error } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, contacts(name)')
            .eq('id', enrollmentId)
            .single();
        enroll = (data as any) ?? null;
        // PGRST116 = zero rows: the enrollment is permanently gone (e.g. its
        // sequence was deleted with cascade). Retrying can never succeed, so
        // treat it as enroll=null and fall through to the untracked paths.
        enrollFetchError = error && (error as { code?: string }).code !== 'PGRST116' ? error : null;
    }

    // 0. Deterministic STOP/START/HELP keyword handling — MUST run before any
    // LLM call AND before the enrollment gate. TCPA/carrier compliance cannot
    // depend on GPT availability, classification accuracy, or the enrollment
    // fetch succeeding. The opt-out is contact-level, so we resolve the contact
    // from the enrollment when present, else by phone (works for just-completed
    // sequences, paused leads, and contacts ingested without an enrollment).
    if (isStopMessage(messageBody) || isStartMessage(messageBody) || isHelpMessage(messageBody)) {
        const kwTenantId = enroll?.tenant_id || tenantId || null;
        let kwContactId: string | null = enroll?.contact_id || null;
        if (!kwContactId && kwTenantId && event.fromPhone) {
            const { data: c, error: lookupErr } = await supabase
                .from('contacts')
                .select('id')
                .eq('client_id', kwTenantId)
                .in('phone', phoneLookupCandidates(event.fromPhone))
                .limit(1)
                .maybeSingle();
            if (lookupErr) {
                console.error('[EVENT] Contact lookup for keyword handling failed:', lookupErr);
            }
            kwContactId = c?.id || null;
        }

        if (kwContactId) {
            if (isStopMessage(messageBody)) {
                console.log(`[EVENT] STOP keyword detected — opting out contact ${kwContactId}`);
                await optOutContact(supabase, kwContactId, 'sms', enrollmentId ? 'keyword' : 'keyword_untracked');
                if (enrollmentId) {
                    await updateEnrollmentStatus(enrollmentId, { contact_replied: true });
                    const { error: stopLogErr } = await supabase.from('sequence_execution_log').insert({
                        enrollment_id: enrollmentId,
                        step_id: null,
                        channel: 'sms',
                        action: 'opt_out_keyword',
                        provider_id: null,
                        provider_response: { body: messageBody.substring(0, 200) },
                        executed_at: new Date().toISOString(),
                    });
                    if (stopLogErr) {
                        console.error(`[EVENT] Failed to log STOP keyword for ${enrollmentId}:`, stopLogErr);
                    }
                }
                return; // Skip the LLM entirely
            }

            if (isStartMessage(messageBody)) {
                console.log(`[EVENT] START keyword detected — re-opting in contact ${kwContactId}`);
                await reoptInContact(supabase, kwContactId);
                return;
            }

            // HELP
            console.log(`[EVENT] HELP keyword detected — notifying tenant`);
            if (enrollmentId) {
                await updateEnrollmentStatus(enrollmentId, { contact_replied: true });
            }
            if (kwTenantId) {
                await createNotification({
                    clientId: kwTenantId,
                    enrollmentId: enrollmentId || undefined,
                    contactId: kwContactId,
                    type: 'needs_human',
                    title: 'HELP keyword received',
                    body: `Contact replied: "${messageBody.substring(0, 100)}"`,
                    priority: 'high',
                });
            }
            return;
        }

        // Keyword detected but no contact resolved. If the enrollment fetch
        // errored, throw so BullMQ retries (the contact may resolve on retry);
        // otherwise fall through to the untracked-notification path below.
        if (enrollFetchError) {
            throw new Error(`[EVENT] enrollment fetch failed for ${enrollmentId} during STOP/START/HELP handling: ${enrollFetchError.message}`);
        }
    }

    // A transient enrollment-fetch failure on a non-keyword reply must retry,
    // not silently complete — throw so BullMQ re-runs the EI/record/status path.
    if (enrollFetchError) {
        throw new Error(`[EVENT] enrollment fetch failed for ${enrollmentId}: ${enrollFetchError.message}`);
    }

    // 1. Run EI analysis on the reply (replaces old classifyReplyIntent)
    let eiAnalysis: EmotionalAnalysis | null = null;
    let conversationHistory = '';
    let contactId: string | null = null;

    // enrollmentId is guaranteed when enroll is set (enroll is only fetched
    // inside `if (enrollmentId)`); the `&& enrollmentId` narrows it to string.
    if (enroll && enrollmentId) {
        contactId = enroll.contact_id;

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

    if (!enrollmentId) {
        // STOP/START/HELP was already handled above at the contact level
        // (phone-resolved), so opted_out_at is set even without an enrollment.
        // Anything else from an untracked contact just notifies a human.
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
            // Persist the opt-out at the CONTACT level (the keyword check
            // above missed it — this is the LLM classifying a free-form
            // opt-out like "please don't text me again").
            if (contactId) {
                await optOutContact(supabase, contactId, 'sms', 'ei_intent');
            }
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

        case 'not_interested': {
            // 'unenrolled' (not 'completed') — counting lead-lost as
            // completed inflates completion analytics.
            const { error: unenrollErr } = await supabase
                .from('sequence_enrollments')
                .update({
                    status: 'unenrolled',
                    contact_replied: true,
                    completed_at: new Date().toISOString(),
                    completed_reason: 'not_interested',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);
            if (unenrollErr) {
                console.error(`[EVENT] Failed to unenroll ${enrollmentId} (not_interested):`, unenrollErr);
            }
            console.log(`[EVENT] Enrollment ${enrollmentId} not interested, unenrolled`);
            break;
        }

        case 'objection':
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} raised objection — sequence continues with EI adjustments`);
            break;

        default:
            // EI failed or returned an unmapped intent. The deterministic
            // keyword check already ran above, so this cannot be a missed
            // STOP/START/HELP — treat as a plain reply.
            await updateEnrollmentStatus(enrollmentId, {
                contact_replied: true,
            });
            console.log(`[EVENT] Enrollment ${enrollmentId} replied (${intent})`);
    }

    // A/B loop: credit the last-sent variant with this reply (last-touch)
    await attributeVariantOutcome(enrollmentId, 'reply');

    // 6. Handle EI recommended actions
    if (eiAnalysis) {
        switch (eiAnalysis.recommended_action) {
            case 'escalate_to_human': {
                // Push outcome_timeout_at forward so the dynamic timeout
                // generator doesn't race the human.
                const { error: escErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        needs_human_intervention: true,
                        outcome_timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                if (escErr) {
                    console.error(`[EVENT] Failed to escalate ${enrollmentId} to human:`, escErr);
                } else {
                    console.log(`[EVENT] Enrollment ${enrollmentId} escalated to human`);
                }
                break;
            }

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

    // 7. Pipeline auto-advance on SMS reply
    {
        const { data: enrollForPipeline } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, is_hot_lead')
            .eq('id', enrollmentId)
            .single();

        if (enrollForPipeline?.contact_id && enrollForPipeline?.tenant_id) {
            // Any reply = Engaged
            await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Engaged');

            // Hot lead = Qualified
            if (eiAnalysis?.is_hot_lead || enrollForPipeline.is_hot_lead) {
                await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Qualified');
            }
        }
    }

    // 8. SMS Chatbot Mode — if enrollment's sequence has chatbot enabled, generate AI reply
    const chatbotHandled = await maybeTriggerChatbotReply(event, enrollmentId, eiAnalysis);

    // 9. Dynamic (JIT) step generation — trigger on SMS reply (lead responded)
    // Skip JIT generation if chatbot already handled the reply
    if (!chatbotHandled) {
        const smsOutcomeCtx: OutcomeContext = {
            type: 'sms_reply',
            details: `Reply: "${(messageBody || '').substring(0, 100)}"`,
            channel: 'sms',
            eiAnalysis: eiAnalysis || undefined,
        };
        await maybeTriggerDynamicGeneration(enrollmentId, smsOutcomeCtx);
    }
}

/**
 * Maybe trigger chatbot reply for an inbound SMS on an active enrollment.
 * Returns true if chatbot handled the reply (caller should skip JIT generation).
 *
 * The chatbot path is enabled when:
 * - The enrollment exists and is in an active/awaiting_outcome status
 * - The enrollment's sequence has enable_chatbot_mode = true
 * - The EI analysis didn't already trigger opt-out or escalation
 */
async function maybeTriggerChatbotReply(
    event: EventJobPayload,
    enrollmentId: string,
    eiAnalysis: EmotionalAnalysis | null
): Promise<boolean> {
    try {
        // 1. Fetch enrollment with sequence and contact joins
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('*, sequences(*), contacts(*)')
            .eq('id', enrollmentId)
            .single();

        if (!enrollment) return false;

        const sequence = (enrollment as any).sequences as any;
        const contact = (enrollment as any).contacts as any;

        // 2. Guard: sequence must have chatbot mode enabled
        if (!sequence?.enable_chatbot_mode) return false;

        // 3. Guard: enrollment must be in an active state (not already completed/stopped)
        const activeStatuses: EnrollmentStatus[] = ['active', 'awaiting_outcome', 'generating_next_step'];
        if (!activeStatuses.includes(enrollment.status)) {
            console.log(`[EVENT] Chatbot skipped — enrollment ${enrollmentId} status is ${enrollment.status}`);
            return false;
        }

        // 4. Guard: if EI already determined opt-out or escalation, don't chatbot
        if (eiAnalysis?.intent === 'stop') {
            console.log(`[EVENT] Chatbot skipped — EI detected opt-out for ${enrollmentId}`);
            return false;
        }

        // 5. Guard: if needs_human_intervention is already set, don't chatbot
        if ((enrollment as any).needs_human_intervention) {
            console.log(`[EVENT] Chatbot skipped — enrollment ${enrollmentId} needs human intervention`);
            return false;
        }

        console.log(`[EVENT] Chatbot mode active for enrollment ${enrollmentId} — generating AI reply`);

        // 6. Fetch triggering step context for the SMS responder
        const triggeringStep = await getTriggeringStepContext(enrollmentId);

        // 7. Call SMS responder
        const fromPhone = event.fromPhone || contact?.phone || '';
        const result = await handleInboundSMS({
            enrollmentId,
            sequenceId: enrollment.sequence_id,
            contactId: enrollment.contact_id,
            clientId: enrollment.tenant_id,
            inboundMessage: event.messageBody || '',
            fromPhone,
            triggeringStep,
        });

        // 7. Act on the chatbot's decision
        switch (result.action) {
            case 'reply': {
                if (!result.message) {
                    console.error(`[EVENT] Chatbot returned reply without message for ${enrollmentId}`);
                    return false;
                }

                // Send the reply SMS via the sms-send queue. dedupKey is keyed
                // off the inbound MessageSid so a replayed/retried event job
                // can't double-send the same chatbot reply.
                const inboundSid = (event as any).messageSid || (event as any).providerId || (event as any).eventJobId || null;
                if (!inboundSid) {
                    console.log(`[EVENT] Chatbot reply for ${enrollmentId} has no inbound MessageSid — dedupKey falls back to timestamp`);
                }
                // Record the outbound interaction exactly ONCE — in sms-worker
                // after a confirmed send — by carrying the chatbot metadata
                // through the job payload. Recording it here at enqueue time as
                // well double-counted every chatbot turn in the GPT-fed timeline
                // and inflated engagement scoring.
                const turnNumber = result.metadata?.turn || 1;

                // TCPA — this was the one outbound SMS producer with NO
                // time-of-day gate at all. A lead texting at 11:40pm got an AI
                // reply at 11:40pm. Replying to an inbound message is the most
                // defensible send there is, but the 8am-9pm rule still governs
                // it, so delay rather than drop, matching the booking-link and
                // healer paths.
                let chatbotDelayMs = 0;
                try {
                    const { data: tp } = await supabase
                        .from('tenant_profiles')
                        .select('timezone, business_hours')
                        .eq('client_id', enrollment.tenant_id)
                        .maybeSingle();
                    const tz = (tp as any)?.timezone || 'America/New_York';
                    if (!isTCPACompliant(tz)) {
                        const resumeAt = getNextBusinessHoursStart(tz, (tp as any)?.business_hours || null, new Date());
                        chatbotDelayMs = Math.max(0, resumeAt.getTime() - Date.now());
                    }
                    chatbotDelayMs = clampTestDelayMs(chatbotDelayMs, (enrollment as any).is_test === true);
                } catch (err) {
                    console.error(`[EVENT] Chatbot TCPA check failed for ${enrollmentId} — sending without delay:`, err);
                }

                await smsQueue.add('sms:chatbot-reply', {
                    tenantId: enrollment.tenant_id,
                    contactPhone: contact?.phone || fromPhone,
                    body: result.message,
                    enrollmentId,
                    stepId: null, // No specific step — this is a chatbot reply
                    dedupKey: `chatbot:${enrollmentId}:${inboundSid || Date.now()}`,
                    metadata: { source: 'chatbot', turn: turnNumber },
                }, chatbotDelayMs > 0 ? { delay: chatbotDelayMs } : {});
                if (chatbotDelayMs > 0) {
                    console.log(`[EVENT] Chatbot reply for ${enrollmentId} delayed ${Math.round(chatbotDelayMs / 1000)}s for the TCPA window`);
                }

                // Hold the sequence while the lead is mid-conversation with the
                // chatbot so a scheduled step can't fire over the live chat.
                // DYNAMIC enrollments are gated by outcome_timeout_at (the timeout
                // generator would otherwise JIT a parallel step). STATIC
                // enrollments — the default (generation_mode !== 'dynamic') — are
                // gated by next_step_at, which the chatbot previously never
                // touched, so the next scheduled template SMS/call still went out
                // mid-conversation. Push whichever clock applies forward by the
                // hold window; it rolls forward on each reply and lapses after
                // CHATBOT_CONVERSATION_HOLD_MS of silence, resuming the schedule.
                // Key the hold off the enrollment's STATE, not generation_mode:
                // dynamic enrollments sit in 'awaiting_outcome' (gated by
                // outcome_timeout_at) but ALSO in 'active' while a JIT-generated
                // step waits on next_step_at — that state needs the same
                // next_step_at hold as static sequences. Exactly one of the two
                // updates matches. The next_step_at hold only pushes FORWARD
                // (.lt guard): a step already scheduled beyond the hold window
                // must not be pulled earlier.
                // Clamped for test enrollments: a 24h hold the moment the test
                // lead replies would make the test look dead. The .lt()
                // forward-only guard below still behaves with a 30s hold.
                const holdUntil = new Date(
                    Date.now() + clampTestDelayMs(CHATBOT_CONVERSATION_HOLD_MS, (enrollment as any).is_test === true)
                ).toISOString();
                const { error: timeoutErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        outcome_timeout_at: holdUntil,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId)
                    .eq('status', 'awaiting_outcome');
                if (timeoutErr) {
                    console.error(`[EVENT] Failed to extend outcome_timeout_at for ${enrollmentId}:`, timeoutErr);
                }
                const { error: holdErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        next_step_at: holdUntil,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId)
                    .eq('status', 'active')
                    .lt('next_step_at', holdUntil);
                if (holdErr) {
                    console.error(`[EVENT] Failed to hold sequence ${enrollmentId} during chatbot conversation:`, holdErr);
                }

                console.log(`[EVENT] Chatbot reply sent for ${enrollmentId} (turn ${turnNumber}): "${result.message.substring(0, 60)}..."`);
                return true;
            }

            case 'goal_achieved': {
                const conversionType = result.conversion_type || 'replied';
                await updateEnrollmentStatus(enrollmentId, {
                    status: 'completed' as EnrollmentStatus,
                    contact_replied: true,
                    completed_at: new Date().toISOString(),
                });

                // Record the conversion interaction
                await recordInteraction({
                    clientId: enrollment.tenant_id,
                    contactId: enrollment.contact_id,
                    enrollmentId,
                    channel: 'sms',
                    direction: 'inbound',
                    contentBody: `Goal achieved: ${conversionType}`,
                    outcome: 'replied',
                    sentiment: 'positive',
                    intent: 'interested',
                });

                // Compute step attribution on conversion
                try {
                    await computeStepAttribution(enrollmentId, conversionType as any);
                } catch (err) {
                    console.error('[EVENT] Attribution computation failed:', err);
                }

                // A/B loop: credit the last-sent variant with the conversion
                await attributeVariantOutcome(enrollmentId, 'conversion');

                // Notify the tenant
                await createNotification({
                    clientId: enrollment.tenant_id,
                    enrollmentId,
                    contactId: enrollment.contact_id,
                    type: 'sequence_completed',
                    title: `Goal achieved: ${conversionType}`,
                    body: `Chatbot conversation resulted in conversion (${conversionType}) for ${contact?.name || contact?.phone || 'contact'}`,
                    priority: 'high',
                    metadata: { conversion_type: conversionType, source: 'chatbot' },
                });

                console.log(`[EVENT] Chatbot goal achieved for ${enrollmentId}: ${conversionType}`);
                return true;
            }

            case 'escalate': {
                // Flag enrollment for human intervention. Push the dynamic
                // timeout forward so the generator doesn't race the human.
                const { error: escErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        needs_human_intervention: true,
                        outcome_timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                if (escErr) {
                    console.error(`[EVENT] Failed to flag ${enrollmentId} for human intervention:`, escErr);
                }

                // Notify the tenant
                await createNotification({
                    clientId: enrollment.tenant_id,
                    enrollmentId,
                    contactId: enrollment.contact_id,
                    type: 'escalation',
                    title: 'Chatbot escalation — human needed',
                    body: `Reason: ${result.escalation_reason || 'Unknown'}. Last message: "${(event.messageBody || '').substring(0, 100)}"`,
                    priority: 'urgent',
                    metadata: {
                        escalation_reason: result.escalation_reason,
                        source: 'chatbot',
                    },
                });

                console.log(`[EVENT] Chatbot escalated ${enrollmentId}: ${result.escalation_reason}`);
                return true;
            }

            case 'opt_out': {
                await updateEnrollmentStatus(enrollmentId, {
                    status: 'manual_stop' as EnrollmentStatus,
                    contact_replied: true,
                });

                // Persist opt-out at the CONTACT level and stop every other
                // in-flight enrollment for this contact.
                await optOutContact(supabase, enrollment.contact_id, 'sms', 'chatbot');

                // Record the opt-out interaction
                await recordInteraction({
                    clientId: enrollment.tenant_id,
                    contactId: enrollment.contact_id,
                    enrollmentId,
                    channel: 'sms',
                    direction: 'inbound',
                    contentBody: event.messageBody || '',
                    outcome: 'replied',
                    sentiment: 'negative',
                    intent: 'stop',
                });

                console.log(`[EVENT] Chatbot detected opt-out for ${enrollmentId}`);
                return true;
            }

            default:
                console.error(`[EVENT] Chatbot returned unknown action: ${result.action}`);
                return false;
        }
    } catch (err) {
        console.error(`[EVENT] Chatbot reply failed for ${enrollmentId}:`, err);
        return false; // Fallback to JIT generation
    }
}

/**
 * Handle SMS delivery status
 */
async function handleSmsDelivery(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId, deliveryStatus, tenantId } = event;
    const providerId = (event as any).providerId as string | undefined;

    console.log(`[EVENT] SMS delivery status: ${deliveryStatus}`);

    // Update the execution log by provider_id (Twilio MessageSid) — never by
    // bare step_id: step rows are shared across enrollments, so a step_id
    // filter smears one contact's delivery status over everyone's.
    if (providerId) {
        let updateQuery = supabase
            .from('sequence_execution_log')
            .update({
                sms_status: deliveryStatus,
            })
            .eq('provider_id', providerId);
        if (enrollmentId) {
            // Extra guard when the enrollment is known
            updateQuery = updateQuery.eq('enrollment_id', enrollmentId);
        }
        const { error: logErr } = await updateQuery;
        if (logErr) {
            console.error(`[EVENT] Failed to update SMS delivery status for provider ${providerId}:`, logErr);
        }
    } else if (enrollmentId && stepId) {
        // Fallback for events without a providerId — enrollment-scoped
        const { error: logErr } = await supabase
            .from('sequence_execution_log')
            .update({
                sms_status: deliveryStatus,
            })
            .eq('enrollment_id', enrollmentId)
            .eq('step_id', stepId)
            .eq('channel', 'sms');
        if (logErr) {
            console.error(`[EVENT] Failed to update SMS delivery status for enrollment ${enrollmentId}:`, logErr);
        }
    } else {
        console.log('[EVENT] SMS delivery event without providerId or enrollment/step — skipping log update');
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
    const { enrollmentId } = event;
    const executionLogId = (event as any).executionLogId as string | undefined;

    console.log(`[EVENT] Email opened for enrollment ${enrollmentId}`);

    if (!executionLogId) {
        console.log('[EVENT] Email-opened event without executionLogId — skipping log update');
        return;
    }

    // Update the exact execution-log row (tracking URLs now encode the log
    // id) — step_id is shared across enrollments and must not be used.
    const { data: logRow, error: logErr } = await supabase
        .from('sequence_execution_log')
        .update({
            email_status: 'opened',
        })
        .eq('id', executionLogId)
        .select('provider_id, enrollment_id')
        .maybeSingle();

    if (logErr) {
        console.error(`[EVENT] Failed to update execution log ${executionLogId} (opened):`, logErr);
        return;
    }

    // Update interaction record with opened status, keyed off this row's
    // per-enrollment provider_id
    if (logRow?.provider_id) {
        const existing = await findInteractionByProviderId(logRow.provider_id);
        if (existing) {
            await updateInteraction(existing.id, { outcome: 'opened' });
        }
    }
}

/**
 * Handle email clicked event
 */
async function handleEmailClicked(event: EventJobPayload): Promise<void> {
    const { enrollmentId } = event;
    const executionLogId = (event as any).executionLogId as string | undefined;

    console.log(`[EVENT] Email link clicked for enrollment ${enrollmentId}`);

    if (!executionLogId) {
        console.log('[EVENT] Email-clicked event without executionLogId — skipping log update');
        return;
    }

    // Update the exact execution-log row (tracking URLs now encode the log
    // id) — step_id is shared across enrollments and must not be used.
    const { data: logRow, error: logErr } = await supabase
        .from('sequence_execution_log')
        .update({
            email_status: 'clicked',
        })
        .eq('id', executionLogId)
        .select('provider_id, enrollment_id')
        .maybeSingle();

    if (logErr) {
        console.error(`[EVENT] Failed to update execution log ${executionLogId} (clicked):`, logErr);
        return;
    }

    // Update interaction record with clicked status, keyed off this row's
    // per-enrollment provider_id
    if (logRow?.provider_id) {
        const existing = await findInteractionByProviderId(logRow.provider_id);
        if (existing) {
            await updateInteraction(existing.id, { outcome: 'clicked' });
        }
    }
}

/**
 * Handle email bounced event (Phase 4: Self-Healing)
 */
async function handleEmailBounced(event: EventJobPayload): Promise<void> {
    const { enrollmentId, stepId, tenantId } = event;
    const executionLogId = ((event as any).execution_log_id ?? (event as any).executionLogId) as string | undefined;
    const providerId = ((event as any).provider_id ?? (event as any).providerId) as string | undefined;
    const bounceType = ((event as any).bounce_type ?? (event as any).bounceType ?? 'hard') as string; // 'hard' or 'soft'

    console.log(`[EVENT] Email bounced (${bounceType}) for enrollment ${enrollmentId}`);

    // Locate + update the execution log row by id or provider_id — never by
    // bare step_id (step rows are shared across enrollments).
    let logRow: { enrollment_id: string | null; step_id: string | null; provider_id: string | null } | null = null;

    if (executionLogId) {
        const { data, error: logErr } = await supabase
            .from('sequence_execution_log')
            .update({ email_status: 'bounced' })
            .eq('id', executionLogId)
            .select('enrollment_id, step_id, provider_id')
            .maybeSingle();
        if (logErr) {
            console.error(`[EVENT] Failed to update execution log ${executionLogId} (bounced):`, logErr);
        }
        logRow = data ?? null;
    } else if (providerId) {
        const { data, error: logErr } = await supabase
            .from('sequence_execution_log')
            .update({ email_status: 'bounced' })
            .eq('provider_id', providerId)
            .select('enrollment_id, step_id, provider_id');
        if (logErr) {
            console.error(`[EVENT] Failed to update execution log by provider ${providerId} (bounced):`, logErr);
        }
        logRow = data?.[0] ?? null;
    } else {
        console.log('[EVENT] Email bounce without execution_log_id/provider_id — skipping log update');
    }

    // Update interaction record keyed off the row's per-enrollment provider_id
    if (logRow?.provider_id) {
        const existing = await findInteractionByProviderId(logRow.provider_id);
        if (existing) {
            await updateInteraction(existing.id, { outcome: 'bounced' });
        }
    }

    const resolvedEnrollmentId = enrollmentId || logRow?.enrollment_id || undefined;
    const resolvedStepId = stepId || logRow?.step_id || undefined;

    // Hard bounce is permanent — mark the contact's email invalid now so the
    // scheduler's contact-validity gate stops emailing this address. (The
    // healer's mark_invalid only fires on the 2nd bounce.)
    if (bounceType === 'hard' && resolvedEnrollmentId) {
        const { data: enrollRow, error: enrollErr } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', resolvedEnrollmentId)
            .single();
        if (enrollErr) {
            console.error(`[EVENT] Could not resolve contact for enrollment ${resolvedEnrollmentId}:`, enrollErr);
        } else if (enrollRow?.contact_id) {
            const { error: invalidErr } = await supabase
                .from('contacts')
                .update({ email_valid: false })
                .eq('id', enrollRow.contact_id);
            if (invalidErr) {
                console.error(`[EVENT] Failed to mark email invalid for contact ${enrollRow.contact_id}:`, invalidErr);
            } else {
                console.log(`[EVENT] Marked contact ${enrollRow.contact_id} email invalid (hard bounce)`);
            }
        }
    }

    // Trigger self-healing
    if (resolvedEnrollmentId && resolvedStepId) {
        await handleFailure(resolvedEnrollmentId, resolvedStepId, 'email_bounced', {
            bounceType,
            tenantId,
        });
    }

    // Dynamic (JIT) — bounce means failed delivery, need to try another channel
    if (resolvedEnrollmentId) {
        await maybeTriggerDynamicGeneration(resolvedEnrollmentId, {
            type: 'email_bounced',
            details: `${bounceType} bounce`,
            channel: 'email',
        });
    }
}

/**
 * Fetch the triggering step context — the last outbound step executed for this enrollment.
 * Used to give SMS/email responders context about what message the customer is replying to.
 */
async function getTriggeringStepContext(enrollmentId: string): Promise<TriggeringStepContext | undefined> {
    try {
        const { data: logEntry } = await supabase
            .from('sequence_execution_log')
            .select('step_id, channel, executed_at')
            .eq('enrollment_id', enrollmentId)
            .in('action', ['sent', 'call_initiated'])
            .order('executed_at', { ascending: false })
            .limit(1)
            .single();

        if (!logEntry?.step_id) return undefined;

        const { data: step } = await supabase
            .from('sequence_steps')
            .select('step_order, channel, content, step_brief')
            .eq('id', logEntry.step_id)
            .single();

        if (!step) return undefined;

        // Build content summary
        let contentSummary = '';
        const content = step.content as any;
        if (step.channel === 'sms') {
            contentSummary = content?.body?.substring(0, 200) || '';
        } else if (step.channel === 'email') {
            contentSummary = `Subject: ${content?.subject || ''} — ${(content?.body_text || '').substring(0, 150)}`;
        } else if (step.channel === 'voice') {
            contentSummary = content?.first_message?.substring(0, 200) || '';
        }

        return {
            step_order: step.step_order,
            channel: step.channel,
            content_summary: contentSummary,
            step_brief: step.step_brief || null,
            sent_at: logEntry.executed_at,
        };
    } catch {
        return undefined;
    }
}

/**
 * Handle email reply event — mirrors handleSmsReply with email-specific behavior
 */
async function handleEmailReply(event: EventJobPayload): Promise<void> {
    const { enrollmentId, emailSubject, emailBodyText, emailBodyHtml, fromEmail } = event;
    const messageBody = emailBodyText || '';

    if (!messageBody && !emailBodyHtml) {
        console.log('[EVENT] No body in email reply');
        return;
    }

    console.log(`[EVENT] Email reply received: "${(emailSubject || '').substring(0, 60)}"`);

    // Resolve tenantId from enrollment if not provided
    let tenantId = event.tenantId;

    if (enrollmentId) {
        const { data: enroll } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id, sequence_id, contacts(name)')
            .eq('id', enrollmentId)
            .single();

        if (enroll) {
            tenantId = enroll.tenant_id;

            // 0. Deterministic STOP/START/HELP keyword handling — MUST run
            // before any LLM call (CAN-SPAM/compliance cannot depend on GPT).
            // isStopEmailBody checks the first non-quoted line — real email
            // replies carry quoted text/signatures below the actual reply.
            if (isStopMessage(messageBody) || isStopEmailBody(messageBody)) {
                console.log(`[EVENT] STOP keyword detected in email reply for enrollment ${enrollmentId} — opting out contact ${enroll.contact_id}`);
                await optOutContact(supabase, enroll.contact_id, 'email', 'keyword');
                await updateEnrollmentStatus(enrollmentId, { contact_replied: true });
                const { error: stopLogErr } = await supabase.from('sequence_execution_log').insert({
                    enrollment_id: enrollmentId,
                    step_id: null,
                    channel: 'email',
                    action: 'opt_out_keyword',
                    provider_id: null,
                    provider_response: { body: messageBody.substring(0, 200), subject: emailSubject || null },
                    executed_at: new Date().toISOString(),
                });
                if (stopLogErr) {
                    console.error(`[EVENT] Failed to log STOP keyword for ${enrollmentId}:`, stopLogErr);
                }
                return; // Skip the LLM entirely
            }

            if (isStartMessage(messageBody)) {
                console.log(`[EVENT] START keyword detected in email reply — re-opting in contact ${enroll.contact_id}`);
                await reoptInContact(supabase, enroll.contact_id);
                return;
            }

            if (isHelpMessage(messageBody)) {
                console.log(`[EVENT] HELP keyword detected in email reply for enrollment ${enrollmentId} — notifying tenant`);
                await updateEnrollmentStatus(enrollmentId, { contact_replied: true });
                await createNotification({
                    clientId: enroll.tenant_id,
                    enrollmentId,
                    contactId: enroll.contact_id,
                    type: 'needs_human',
                    title: 'HELP keyword received (email)',
                    body: `Contact replied: "${messageBody.substring(0, 100)}"`,
                    priority: 'high',
                });
                return;
            }

            // 1. EI Analysis on the reply
            let eiAnalysis: EmotionalAnalysis | null = null;
            const conversationHistory = await buildConversationHistoryString(enroll.contact_id);

            try {
                eiAnalysis = await analyzeMessage(messageBody, 'email', conversationHistory);
                console.log(`[EVENT] Email EI: emotion=${eiAnalysis.primary_emotion}, intent=${eiAnalysis.intent}`);
            } catch (err) {
                console.error('[EVENT] Email EI analysis failed:', err);
            }

            const emotionToSentiment: Record<string, 'positive' | 'negative' | 'neutral' | 'interested' | 'objection' | 'confused'> = {
                excited: 'positive', interested: 'interested', neutral: 'neutral',
                hesitant: 'neutral', frustrated: 'negative', confused: 'confused',
                angry: 'negative', dismissive: 'negative',
            };

            const sentiment = eiAnalysis
                ? (emotionToSentiment[eiAnalysis.primary_emotion] || 'neutral')
                : 'neutral';
            const intent = eiAnalysis?.intent || 'unknown';

            // 2. Record inbound email interaction
            const interactionId = await recordInteraction({
                clientId: enroll.tenant_id,
                contactId: enroll.contact_id,
                enrollmentId,
                channel: 'email',
                direction: 'inbound',
                contentBody: messageBody,
                contentSubject: emailSubject,
                outcome: 'replied',
                sentiment,
                intent: intent as any,
            });

            if (interactionId && eiAnalysis) {
                await supabase
                    .from('contact_interactions')
                    .update({
                        emotional_analysis: eiAnalysis,
                        engagement_score: eiAnalysis.is_hot_lead ? 80 : eiAnalysis.is_at_risk ? 25 : 50,
                    })
                    .eq('id', interactionId);
            }

            // 3. Update conversation summary
            await updateContactConversationSummary(enroll.contact_id);

            // 4. Update enrollment EI + notifications
            if (eiAnalysis) {
                const interactions = await getRecentInteractions(enroll.contact_id);
                await updateEnrollmentEI(enrollmentId, eiAnalysis, interactions);

                const contactName = (enroll as any).contacts?.name || undefined;
                await generateEINotifications(enroll.tenant_id, enroll.contact_id, enrollmentId, eiAnalysis, contactName);
            }

            // 5. Update enrollment status
            await updateEnrollmentStatus(enrollmentId, { contact_replied: true });

            if (intent === 'stop') {
                await updateEnrollmentStatus(enrollmentId, { status: 'manual_stop', contact_replied: true });
                // Persist the opt-out at the CONTACT level (keyword check
                // above missed it — LLM caught a free-form opt-out)
                await optOutContact(supabase, enroll.contact_id, 'email', 'ei_intent');
            } else if (intent === 'not_interested') {
                // 'unenrolled' (not 'completed') — counting lead-lost as
                // completed inflates completion analytics.
                const { error: unenrollErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        status: 'unenrolled',
                        contact_replied: true,
                        completed_at: new Date().toISOString(),
                        completed_reason: 'not_interested',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                if (unenrollErr) {
                    console.error(`[EVENT] Failed to unenroll ${enrollmentId} (not_interested):`, unenrollErr);
                }
            } else if (intent === 'interested' || intent === 'ready_to_buy') {
                try { await computeStepAttribution(enrollmentId, 'replied'); } catch {}
            }

            // A/B loop: credit the last-sent variant with this reply (last-touch)
            await attributeVariantOutcome(enrollmentId, 'reply');

            // 6. Pipeline auto-advance
            const { data: enrollForPipeline } = await supabase
                .from('sequence_enrollments')
                .select('contact_id, tenant_id, is_hot_lead')
                .eq('id', enrollmentId)
                .single();

            if (enrollForPipeline?.contact_id && enrollForPipeline?.tenant_id) {
                await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Engaged');
                if (eiAnalysis?.is_hot_lead || enrollForPipeline.is_hot_lead) {
                    await autoAdvancePipelineStage(enrollForPipeline.contact_id, enrollForPipeline.tenant_id, 'Qualified');
                }
            }

            // 7. Email responder chatbot — check email_reply_mode
            const emailChatbotHandled = await maybeTriggerEmailReply(event, enrollmentId, enroll, eiAnalysis);

            // 8. Dynamic JIT generation
            if (!emailChatbotHandled) {
                await maybeTriggerDynamicGeneration(enrollmentId, {
                    type: 'sms_reply', // reuse type — email reply is similar
                    details: `Email reply: "${(messageBody).substring(0, 100)}"`,
                    channel: 'email',
                    eiAnalysis: eiAnalysis || undefined,
                });
            }
        }
    }
}

/**
 * Maybe trigger email chatbot reply for an inbound email on an active enrollment.
 */
async function maybeTriggerEmailReply(
    event: EventJobPayload,
    enrollmentId: string,
    enroll: any,
    eiAnalysis: EmotionalAnalysis | null
): Promise<boolean> {
    try {
        // Check email_reply_mode from tenant_email_accounts
        const { data: emailAccount } = await supabase
            .from('tenant_email_accounts')
            .select('email_reply_mode')
            .eq('client_id', enroll.tenant_id)
            .eq('is_active', true)
            .single();

        const replyMode: EmailReplyMode = emailAccount?.email_reply_mode || 'notify_only';

        if (replyMode === 'notify_only') {
            // Just notify — don't generate a response
            await createNotification({
                clientId: enroll.tenant_id,
                enrollmentId,
                contactId: enroll.contact_id,
                type: 'needs_human',
                title: 'Email reply received',
                body: `Subject: "${(event.emailSubject || '').substring(0, 100)}" — ${(event.emailBodyText || '').substring(0, 150)}`,
                priority: 'normal',
                metadata: { source: 'email_reply', from: event.fromEmail },
            });
            return false;
        }

        // Fetch full enrollment with sequence
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('*, sequences(*), contacts(*)')
            .eq('id', enrollmentId)
            .single();

        if (!enrollment) return false;

        const sequence = (enrollment as any).sequences as any;
        const contact = (enrollment as any).contacts as any;

        // Guard: active status
        const activeStatuses: EnrollmentStatus[] = ['active', 'awaiting_outcome', 'generating_next_step'];
        if (!activeStatuses.includes(enrollment.status)) return false;

        if (eiAnalysis?.intent === 'stop') return false;
        if ((enrollment as any).needs_human_intervention) return false;

        // Fetch triggering step context
        const triggeringStep = await getTriggeringStepContext(enrollmentId);

        // Call email responder
        const result = await handleInboundEmail({
            enrollmentId,
            sequenceId: enrollment.sequence_id,
            contactId: enrollment.contact_id,
            clientId: enrollment.tenant_id,
            inboundSubject: event.emailSubject || '',
            inboundBody: event.emailBodyText || '',
            fromEmail: event.fromEmail || '',
            triggeringStep,
        });

        switch (result.action) {
            case 'reply': {
                if (!result.message) return false;

                if (replyMode === 'auto') {
                    // Send the reply email via the email queue. dedupKey keyed
                    // off the stable event-job id so a retried event job can't
                    // double-send the same chatbot reply.
                    await emailQueue.add('email:chatbot-reply', {
                        tenantId: enrollment.tenant_id,
                        contactEmail: contact?.email || event.fromEmail || '',
                        subject: result.subject || `Re: ${event.emailSubject || ''}`,
                        bodyHtml: result.message,
                        bodyText: result.message,
                        enrollmentId,
                        stepId: null, // No specific step — this is a chatbot reply
                        dedupKey: `chatbot-email:${enrollmentId}:${(event as any).eventJobId || Date.now()}`,
                    });

                    await recordInteraction({
                        clientId: enrollment.tenant_id,
                        contactId: enrollment.contact_id,
                        enrollmentId,
                        channel: 'email',
                        direction: 'outbound',
                        contentBody: result.message,
                        contentSubject: result.subject,
                        outcome: 'delivered',
                        metadata: { source: 'chatbot', turn: result.metadata?.turn || 1 },
                    });

                    console.log(`[EVENT] Email chatbot reply sent for ${enrollmentId}`);
                } else if (replyMode === 'draft') {
                    // Save as draft + notify
                    await createNotification({
                        clientId: enrollment.tenant_id,
                        enrollmentId,
                        contactId: enrollment.contact_id,
                        type: 'needs_human',
                        title: 'Email draft ready for review',
                        body: `AI generated a reply to "${(event.emailSubject || '').substring(0, 60)}". Review and send.`,
                        priority: 'normal',
                        metadata: {
                            source: 'email_chatbot_draft',
                            draft_subject: result.subject,
                            draft_body: result.message,
                            from: event.fromEmail,
                        },
                    });
                    console.log(`[EVENT] Email chatbot draft saved for ${enrollmentId}`);
                }
                return true;
            }

            case 'goal_achieved': {
                await updateEnrollmentStatus(enrollmentId, {
                    status: 'completed' as EnrollmentStatus,
                    contact_replied: true,
                    completed_at: new Date().toISOString(),
                });
                try { await computeStepAttribution(enrollmentId, (result.conversion_type || 'replied') as any); } catch {}
                // A/B loop: credit the last-sent variant with the conversion
                await attributeVariantOutcome(enrollmentId, 'conversion');
                await createNotification({
                    clientId: enrollment.tenant_id,
                    enrollmentId,
                    contactId: enrollment.contact_id,
                    type: 'sequence_completed',
                    title: `Email goal achieved: ${result.conversion_type}`,
                    body: `Email conversation resulted in conversion for ${contact?.name || contact?.email || 'contact'}`,
                    priority: 'high',
                    metadata: { conversion_type: result.conversion_type, source: 'email_chatbot' },
                });
                return true;
            }

            case 'escalate': {
                // Push the dynamic timeout forward so the generator doesn't
                // race the human.
                const { error: escErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        needs_human_intervention: true,
                        outcome_timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);
                if (escErr) {
                    console.error(`[EVENT] Failed to flag ${enrollmentId} for human intervention:`, escErr);
                }
                await createNotification({
                    clientId: enrollment.tenant_id,
                    enrollmentId,
                    contactId: enrollment.contact_id,
                    type: 'escalation',
                    title: 'Email escalation — human needed',
                    body: `Reason: ${result.escalation_reason}`,
                    priority: 'urgent',
                    metadata: { escalation_reason: result.escalation_reason, source: 'email_chatbot' },
                });
                return true;
            }

            case 'opt_out': {
                await updateEnrollmentStatus(enrollmentId, {
                    status: 'manual_stop' as EnrollmentStatus,
                    contact_replied: true,
                });
                // Persist opt-out at the CONTACT level and stop every other
                // in-flight enrollment for this contact.
                await optOutContact(supabase, enrollment.contact_id, 'email', 'chatbot');
                return true;
            }

            default:
                return false;
        }
    } catch (err) {
        console.error(`[EVENT] Email chatbot failed for ${enrollmentId}:`, err);
        return false;
    }
}

/**
 * Event Processor processor
 */
async function processEvent(job: Job<EventJobPayload>): Promise<void> {
    const event = job.data;

    // The BullMQ job id is stable across retries of the same event, so
    // downstream dispatches can use it as an idempotency fallback when the
    // payload carries no provider message id.
    (event as any).eventJobId = job.id;

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

        case 'email-reply':
            await handleEmailReply(event);
            break;

        default:
            console.log(`[EVENT] Unknown event type: ${event.type}`);
    }
}

// Create the worker
const eventWorker = new Worker<EventJobPayload>('events-process', processEvent, {
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
