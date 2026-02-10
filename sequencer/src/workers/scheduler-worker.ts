/**
 * Scheduler Worker
 * 
 * The heart of the sequencer engine.
 * Polls every 5 seconds for due enrollments and dispatches to channel queues.
 * 
 * Responsibilities:
 * - Find enrollments where next_step_at <= NOW()
 * - Check skip conditions
 * - Check business hours and TCPA compliance
 * - Render templates with contact variables
 * - Dispatch to SMS/Email/VAPI queues
 * - Advance enrollment to next step
 */

import 'dotenv/config';
import { supabase } from '../lib/db.js';
import { smsQueue, emailQueue, vapiQueue } from '../lib/redis.js';
import {
    getConversationContext,
    buildTemplateVariables,
    buildVoiceAgentContext,
} from '../lib/conversation-memory.js';
import {
    buildVoiceAgentToneDirective,
    getToneTemplateVariables,
    getEmotionBasedDelayMultiplier,
} from '../lib/tone-adapter.js';
import {
    shouldMutate,
    mutateStepContent,
    recordMutation,
    MIN_CONFIDENCE,
} from '../lib/sequence-mutator.js';
import {
    getChannelOverride,
    checkContactValidity,
    handleFailure,
} from '../lib/self-healer.js';
import {
    selectVariant,
    recordVariantSent,
} from '../lib/outcome-learning.js';
import type {
    SequenceEnrollment,
    SequenceStep,
    Sequence,
    Contact,
    TenantProfile,
    SmsContent,
    EmailContent,
    VoiceContent,
    UrgencyTier,
    ConversationContext,
    SentimentTrend,
    PrimaryEmotion,
    RecommendedTone,
    ChannelType,
} from '../lib/types.js';
import { format, addSeconds, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

const POLL_INTERVAL_MS = 5000; // 5 seconds
const BATCH_SIZE = 100;

interface EnrollmentWithContext {
    enrollment: SequenceEnrollment;
    step: SequenceStep;
    sequence: Sequence;
    contact: Contact;
    tenantProfile: TenantProfile;
}

/**
 * Get priority number for VAPI queue based on urgency tier
 */
function getCallPriority(urgencyTier: UrgencyTier): number {
    const priorities: Record<UrgencyTier, number> = {
        critical: 1,
        high: 3,
        medium: 5,
        low: 8,
    };
    return priorities[urgencyTier] || 5;
}

/**
 * Check if current time is within TCPA-compliant window (8am - 9pm)
 */
function isTCPACompliant(timezone: string): boolean {
    const now = new Date();
    const zonedNow = utcToZonedTime(now, timezone);
    const hour = zonedNow.getHours();
    return hour >= 8 && hour < 21;
}

/**
 * Check if current time is within business hours
 */
function isWithinBusinessHours(
    timezone: string,
    businessHours: TenantProfile['business_hours']
): boolean {
    if (!businessHours) return true;
    if (businessHours.emergency_24_7) return true;

    const now = new Date();
    const zonedNow = utcToZonedTime(now, timezone);
    const day = zonedNow.getDay();
    const currentTime = format(zonedNow, 'HH:mm');

    let hours: { start: string; end: string } | undefined;

    if (day === 0) hours = businessHours.sunday;
    else if (day === 6) hours = businessHours.saturday;
    else hours = businessHours.weekdays;

    if (!hours) return false;

    return currentTime >= hours.start && currentTime <= hours.end;
}

/**
 * Get next business hours start time
 */
function getNextBusinessHoursStart(
    timezone: string,
    businessHours: TenantProfile['business_hours']
): Date {
    // Simple implementation: next 8am in timezone
    const now = new Date();
    const zonedNow = utcToZonedTime(now, timezone);
    const hour = zonedNow.getHours();

    if (hour < 8) {
        // Today at 8am
        return setMinutes(setHours(now, 8), 0);
    } else {
        // Tomorrow at 8am
        const tomorrow = addSeconds(now, 24 * 60 * 60);
        return setMinutes(setHours(tomorrow, 8), 0);
    }
}

/**
 * Get next TCPA-compliant window start
 */
function getNextTCPAWindow(timezone: string): Date {
    return getNextBusinessHoursStart(timezone, null);
}

/**
 * Check if step should be skipped based on conditions
 */
function shouldSkipStep(
    enrollment: SequenceEnrollment,
    stepConditions: SequenceStep['skip_conditions']
): boolean {
    if (!stepConditions) return false;

    const { skip_if, only_if } = stepConditions;

    // Skip if any of these conditions are true
    if (skip_if) {
        if (skip_if.includes('contact_replied') && enrollment.contact_replied) return true;
        if (skip_if.includes('contact_answered_call') && enrollment.contact_answered_call) return true;
        if (skip_if.includes('appointment_booked') && enrollment.appointment_booked) return true;
    }

    // Only execute if these conditions are true
    if (only_if && only_if.length > 0) {
        // For now, only support voicemail_left check
        // This would require tracking per-step outcomes
        // TODO: Implement step outcome tracking
    }

    return false;
}

/**
 * Render template with contact variables
 */
function renderTemplate(
    content: SmsContent | EmailContent | VoiceContent,
    variables: Record<string, any>
): SmsContent | EmailContent | VoiceContent {
    const render = (text: string): string => {
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return variables[key] ?? match;
        });
    };

    if ('body' in content && typeof content.body === 'string') {
        // SMS
        return { body: render(content.body) };
    } else if ('subject' in content) {
        // Email
        const emailContent = content as EmailContent;
        return {
            subject: render(emailContent.subject),
            body_html: render(emailContent.body_html),
            body_text: render(emailContent.body_text),
        };
    } else {
        // Voice
        const voiceContent = content as VoiceContent;
        return {
            ...voiceContent,
            first_message: render(voiceContent.first_message),
            system_prompt: render(voiceContent.system_prompt),
        };
    }
}

/**
 * Fetch due enrollments with all context
 */
async function fetchDueEnrollments(): Promise<EnrollmentWithContext[]> {
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
            *,
            sequences (*),
            contacts (*),
            tenant_profiles!sequence_enrollments_tenant_id_fkey (*)
        `)
        .eq('status', 'active')
        .lte('next_step_at', new Date().toISOString())
        .order('next_step_at', { ascending: true })
        .limit(BATCH_SIZE);

    if (error) {
        console.error('[SCHEDULER] Error fetching due enrollments:', error);
        return [];
    }

    if (!data || data.length === 0) {
        return [];
    }

    // Fetch the next step for each enrollment
    const results: EnrollmentWithContext[] = [];

    for (const row of data) {
        const enrollment = row as SequenceEnrollment & {
            sequences: Sequence;
            contacts: Contact;
            tenant_profiles: TenantProfile;
        };

        // Get the next step
        const { data: stepData, error: stepError } = await supabase
            .from('sequence_steps')
            .select('*')
            .eq('sequence_id', enrollment.sequence_id)
            .eq('step_order', enrollment.current_step_order + 1)
            .single();

        if (stepError || !stepData) {
            // No more steps - sequence complete
            await supabase
                .from('sequence_enrollments')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('id', enrollment.id);
            continue;
        }

        results.push({
            enrollment: enrollment,
            step: stepData as SequenceStep,
            sequence: enrollment.sequences,
            contact: enrollment.contacts,
            tenantProfile: enrollment.tenant_profiles,
        });
    }

    return results;
}

/**
 * Process a single enrollment step
 */
async function processStep(ctx: EnrollmentWithContext): Promise<void> {
    const { enrollment, step, sequence, contact, tenantProfile } = ctx;
    const timezone = tenantProfile.timezone || 'America/New_York';

    console.log(`[SCHEDULER] Processing enrollment ${enrollment.id}, step ${step.step_order} (${step.channel})`);

    // 0. Check if enrollment needs human intervention (EI flag)
    const enrollmentEI = enrollment as SequenceEnrollment & {
        needs_human_intervention?: boolean;
        sentiment_trend?: SentimentTrend;
        last_emotion?: PrimaryEmotion;
        recommended_tone?: RecommendedTone;
        is_hot_lead?: boolean;
        is_at_risk?: boolean;
        engagement_score?: number;
    };

    if (enrollmentEI.needs_human_intervention) {
        console.log(`[SCHEDULER] Enrollment ${enrollment.id} needs human intervention — skipping step`);
        return; // Don't advance, don't reschedule — wait for human to take over
    }

    // 1. Check skip conditions
    if (shouldSkipStep(enrollment, step.skip_conditions)) {
        console.log(`[SCHEDULER] Skipping step ${step.step_order} - conditions met`);
        await advanceToNextStep(enrollment, sequence.id);
        return;
    }

    // 2. Check business hours (for voice + SMS)
    if (
        sequence.respect_business_hours &&
        step.channel !== 'email' &&
        !isWithinBusinessHours(timezone, tenantProfile.business_hours)
    ) {
        const nextWindow = getNextBusinessHoursStart(timezone, tenantProfile.business_hours);
        console.log(`[SCHEDULER] Outside business hours, rescheduling to ${nextWindow.toISOString()}`);
        await rescheduleStep(enrollment.id, nextWindow);
        return;
    }

    // 3. TCPA check (no calls/texts before 8am or after 9pm)
    if (['sms', 'voice'].includes(step.channel) && !isTCPACompliant(timezone)) {
        const nextWindow = getNextTCPAWindow(timezone);
        console.log(`[SCHEDULER] Outside TCPA window, rescheduling to ${nextWindow.toISOString()}`);
        await rescheduleStep(enrollment.id, nextWindow);
        return;
    }

    // 4. Load conversation context for cross-channel awareness
    let conversationCtx: ConversationContext | null = null;
    try {
        conversationCtx = await getConversationContext(contact.id, enrollment.id);
    } catch (err) {
        console.log(`[SCHEDULER] Could not load conversation context, proceeding without it`);
    }

    // 5. Build template variables (contact core + custom_fields + enrollment vars + conversation memory + tone)
    const conversationVars = conversationCtx ? buildTemplateVariables(conversationCtx) : {};

    // Build tone/emotional state variables from enrollment EI data
    const toneVars = getToneTemplateVariables({
        recommendedTone: enrollmentEI.recommended_tone || 'professional',
        sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
        lastEmotion: enrollmentEI.last_emotion || null,
        isHotLead: enrollmentEI.is_hot_lead || false,
        isAtRisk: enrollmentEI.is_at_risk || false,
        engagementScore: enrollmentEI.engagement_score || 50,
    });

    const variables = {
        // Contact core fields
        first_name: contact.first_name || contact.name?.split(' ')[0] || '',
        last_name: contact.last_name || contact.name?.split(' ').slice(1).join(' ') || '',
        name: contact.name || '',
        phone: contact.phone,
        email: contact.email || '',
        company: contact.company || '',
        // Persistent contact custom fields (from manual entry / settings)
        ...(contact.custom_fields || {}),
        // Per-enrollment custom variables (from CSV / webhook — overrides contact fields)
        ...enrollment.custom_variables,
        // Conversation memory variables (cross-channel context)
        ...conversationVars,
        // Emotional intelligence / tone variables
        ...toneVars,
    };

    // 5b. A/B Variant Selection — check if step has active variants
    let selectedVariantId: string | null = null;
    let contentToRender = step.content;

    try {
        const variant = await selectVariant(step.id);
        if (variant) {
            contentToRender = variant.content;
            selectedVariantId = variant.variantId;
            await recordVariantSent(variant.variantId);
            console.log(`[SCHEDULER] A/B variant selected: ${variant.variantId} for step ${step.step_order}`);
        }
    } catch (err) {
        console.log('[SCHEDULER] Variant selection failed, using original content:', err);
    }

    let renderedContent = renderTemplate(contentToRender, variables);

    // 6. Adaptive Mutation — AI-rewrite step content based on conversation context
    let wasMutated = false;
    if (shouldMutate(step, sequence, enrollment, conversationCtx)) {
        try {
            const mutation = await mutateStepContent(
                step,
                conversationCtx!,
                tenantProfile,
                sequence.mutation_aggressiveness || 'moderate'
            );

            if (mutation.confidence >= MIN_CONFIDENCE) {
                // Re-render the mutated content with variables (mutation may include {{placeholders}})
                renderedContent = renderTemplate(mutation.content, variables);
                wasMutated = true;

                // Record the mutation for audit trail + analytics
                await recordMutation(
                    enrollment.id,
                    step.id,
                    enrollment.tenant_id,
                    step.content,
                    mutation,
                    sequence.mutation_aggressiveness || 'moderate'
                );

                console.log(`[SCHEDULER] Step mutated (confidence=${mutation.confidence.toFixed(2)}): ${mutation.reason}`);
            } else {
                console.log(`[SCHEDULER] Mutation confidence too low (${mutation.confidence.toFixed(2)}), using original template`);
            }
        } catch (err) {
            console.log('[SCHEDULER] Mutation failed, using original template:', err);
        }
    }

    // 7. Self-Healing: Check channel overrides and contact validity before dispatch
    let dispatchChannel: ChannelType = step.channel;

    // Check if this enrollment has a channel override (e.g., SMS → email because phone is landline)
    const override = getChannelOverride(enrollment, step.channel);
    if (override) {
        console.log(`[SCHEDULER] Channel override: ${step.channel} → ${override} for enrollment ${enrollment.id}`);
        dispatchChannel = override;
    }

    // Check contact validity for the dispatch channel
    const validity = checkContactValidity(contact, dispatchChannel);
    if (!validity.valid) {
        console.log(`[SCHEDULER] Contact invalid for ${dispatchChannel}: ${validity.reason}`);
        // Trigger self-healing which will find an alternative
        if (validity.failureType) {
            await handleFailure(enrollment.id, step.id, validity.failureType, {
                reason: validity.reason,
            });
        } else {
            await advanceToNextStep(enrollment, sequence.id);
        }
        return;
    }

    // 8. Dispatch to channel queue
    switch (dispatchChannel) {
        case 'sms':
            await smsQueue.add('sms:send', {
                tenantId: enrollment.tenant_id,
                contactPhone: contact.phone,
                body: (renderedContent as SmsContent).body,
                enrollmentId: enrollment.id,
                stepId: step.id,
            });
            console.log(`[SCHEDULER] Dispatched SMS for enrollment ${enrollment.id}`);
            break;

        case 'email':
            if (!contact.email) {
                console.log(`[SCHEDULER] No email for contact, skipping step`);
                await advanceToNextStep(enrollment, sequence.id);
                return;
            }
            const emailContent = renderedContent as EmailContent;
            await emailQueue.add('email:send', {
                tenantId: enrollment.tenant_id,
                contactEmail: contact.email,
                subject: emailContent.subject,
                bodyHtml: emailContent.body_html,
                bodyText: emailContent.body_text,
                enrollmentId: enrollment.id,
                stepId: step.id,
            });
            console.log(`[SCHEDULER] Dispatched email for enrollment ${enrollment.id}`);
            break;

        case 'voice': {
            // Inject conversation history into voice agent's system prompt
            const voiceContent = renderedContent as VoiceContent;
            if (conversationCtx && conversationCtx.interaction_count.total > 0) {
                const agentContext = buildVoiceAgentContext(conversationCtx);
                voiceContent.system_prompt = `${voiceContent.system_prompt}\n\n${agentContext}`;
            }

            // Inject tone directive from EI layer
            const toneDirective = buildVoiceAgentToneDirective({
                recommendedTone: enrollmentEI.recommended_tone || 'professional',
                sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
                lastEmotion: enrollmentEI.last_emotion || null,
                isHotLead: enrollmentEI.is_hot_lead || false,
                isAtRisk: enrollmentEI.is_at_risk || false,
                needsHuman: enrollmentEI.needs_human_intervention || false,
            });
            voiceContent.system_prompt = `${voiceContent.system_prompt}\n\n${toneDirective}`;

            await vapiQueue.add('vapi:call', {
                tenantId: enrollment.tenant_id,
                contactPhone: contact.phone,
                assistantConfig: voiceContent,
                enrollmentId: enrollment.id,
                stepId: step.id,
                urgencyPriority: getCallPriority(sequence.urgency_tier),
            }, {
                priority: getCallPriority(sequence.urgency_tier),
            });
            console.log(`[SCHEDULER] Dispatched VAPI call for enrollment ${enrollment.id}`);
            break;
        }
    }

    // 9. Track variant_id in execution log if A/B test variant was used
    if (selectedVariantId) {
        // Update the latest execution log entry for this step with variant_id
        await supabase
            .from('sequence_execution_log')
            .update({ variant_id: selectedVariantId })
            .eq('enrollment_id', enrollment.id)
            .eq('step_id', step.id)
            .is('variant_id', null);
    }

    // 10. Advance enrollment state (with emotion-aware delay adjustment)
    await advanceToNextStep(enrollment, sequence.id, {
        sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
        isHotLead: enrollmentEI.is_hot_lead || false,
        isAtRisk: enrollmentEI.is_at_risk || false,
        lastEmotion: enrollmentEI.last_emotion || null,
    });
}

/**
 * Advance enrollment to next step
 * Now supports emotion-based delay adjustment from EI layer
 */
async function advanceToNextStep(
    enrollment: SequenceEnrollment,
    sequenceId: string,
    emotionalState?: {
        sentimentTrend: SentimentTrend;
        isHotLead: boolean;
        isAtRisk: boolean;
        lastEmotion: PrimaryEmotion | null;
    }
): Promise<void> {
    // Get next step
    const { data: nextStep } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .eq('step_order', enrollment.current_step_order + 2)
        .single();

    if (!nextStep) {
        // Sequence complete
        await supabase
            .from('sequence_enrollments')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);
        console.log(`[SCHEDULER] Enrollment ${enrollment.id} completed`);
        return;
    }

    // Calculate next step time with emotion-based delay adjustment
    let adjustedDelaySeconds = nextStep.delay_seconds;

    if (emotionalState) {
        const multiplier = getEmotionBasedDelayMultiplier({
            sentimentTrend: emotionalState.sentimentTrend,
            isHotLead: emotionalState.isHotLead,
            isAtRisk: emotionalState.isAtRisk,
            lastEmotion: emotionalState.lastEmotion,
        });

        if (multiplier !== 1.0) {
            const originalDelay = nextStep.delay_seconds;
            adjustedDelaySeconds = Math.round(originalDelay * multiplier);
            console.log(`[SCHEDULER] EI delay adjustment: ${originalDelay}s → ${adjustedDelaySeconds}s (x${multiplier}, trend=${emotionalState.sentimentTrend})`);
        }
    }

    const nextStepAt = addSeconds(new Date(), adjustedDelaySeconds);

    await supabase
        .from('sequence_enrollments')
        .update({
            current_step_order: enrollment.current_step_order + 1,
            next_step_at: nextStepAt.toISOString(),
            total_attempts: enrollment.total_attempts + 1,
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollment.id);

    console.log(`[SCHEDULER] Enrollment ${enrollment.id} advanced to step ${enrollment.current_step_order + 2}, next at ${nextStepAt.toISOString()}`);
}

/**
 * Reschedule step to a later time
 */
async function rescheduleStep(enrollmentId: string, nextTime: Date): Promise<void> {
    await supabase
        .from('sequence_enrollments')
        .update({
            next_step_at: nextTime.toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
}

/**
 * Main scheduler tick
 */
async function tick(): Promise<void> {
    const startTime = Date.now();

    try {
        const dueEnrollments = await fetchDueEnrollments();

        if (dueEnrollments.length === 0) {
            return;
        }

        console.log(`[SCHEDULER] Processing ${dueEnrollments.length} due enrollments`);

        for (const ctx of dueEnrollments) {
            try {
                await processStep(ctx);
            } catch (error) {
                console.error(`[SCHEDULER] Error processing enrollment ${ctx.enrollment.id}:`, error);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[SCHEDULER] Tick completed in ${duration}ms, processed ${dueEnrollments.length} enrollments`);
    } catch (error) {
        console.error('[SCHEDULER] Tick error:', error);
    }
}

/**
 * Start the scheduler
 */
async function start(): Promise<void> {
    console.log('[SCHEDULER] Starting scheduler worker...');
    console.log(`[SCHEDULER] Poll interval: ${POLL_INTERVAL_MS}ms, Batch size: ${BATCH_SIZE}`);

    // Run initial tick
    await tick();

    // Set up interval
    setInterval(tick, POLL_INTERVAL_MS);

    console.log('[SCHEDULER] Scheduler running');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SCHEDULER] Received SIGTERM, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[SCHEDULER] Received SIGINT, shutting down...');
    process.exit(0);
});

// Start the scheduler
start().catch((error) => {
    console.error('[SCHEDULER] Fatal error:', error);
    process.exit(1);
});
