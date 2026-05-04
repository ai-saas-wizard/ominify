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
    getConversationContext as getDynamicConversationContext,
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
import {
    generateNextStep,
    getExecutedSteps,
    getOutcomeTimeout,
    claimEnrollmentForGeneration,
    insertGeneratedStep,
    getSequenceVapiAssistantId,
    endDynamicSequence,
    activateEnrollmentForNextStep,
} from '../lib/dynamic-step-generator.js';
import {
    assembleInlineAgent,
    isValidBlueprint,
} from '../lib/blueprint-assembler.js';
import {
    generateOutboundContent,
} from '../lib/outbound-generator.js';
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
    OutcomeContext,
    AgentBlueprint,
    InlineVapiAgent,
    StepBrief,
} from '../lib/types.js';
import { format, addSeconds, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

const POLL_INTERVAL_MS = 5000; // 5 seconds
const BATCH_SIZE = 100;
const TEST_MODE_DELAY_SECONDS = 30; // Compressed delay for test enrollments

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
 * Fetch due enrollments with all context.
 *
 * NOTE: sequence_enrollments.tenant_id is misnamed — it actually FKs to
 * clients(id), not tenant_profiles(id). PostgREST has no direct FK from
 * sequence_enrollments to tenant_profiles, so we fetch profiles in a
 * second batched query keyed by client_id.
 */
async function fetchDueEnrollments(): Promise<EnrollmentWithContext[]> {
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
            *,
            sequences (*),
            contacts (*)
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

    // Batch-load tenant profiles for every distinct client (tenant_id) in
    // this poll's results. One extra round-trip per tick instead of N.
    const clientIds = Array.from(
        new Set(data.map((row: any) => row.tenant_id as string).filter(Boolean))
    );

    const profilesByClientId = new Map<string, TenantProfile>();
    if (clientIds.length > 0) {
        const { data: profiles, error: profileErr } = await supabase
            .from('tenant_profiles')
            .select('*')
            .in('client_id', clientIds);

        if (profileErr) {
            console.error('[SCHEDULER] Error fetching tenant profiles:', profileErr);
        } else if (profiles) {
            for (const p of profiles as any[]) {
                if (p.client_id) profilesByClientId.set(p.client_id, p as TenantProfile);
            }
        }
    }

    // Fetch the next step for each enrollment
    const results: EnrollmentWithContext[] = [];

    for (const row of data) {
        const enrollment = row as SequenceEnrollment & {
            sequences: Sequence;
            contacts: Contact;
        };

        const tenantProfile = profilesByClientId.get(enrollment.tenant_id as string);
        if (!tenantProfile) {
            console.warn(
                `[SCHEDULER] No tenant_profile for client ${enrollment.tenant_id} (enrollment ${enrollment.id}) — skipping.`
            );
            continue;
        }

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
            tenantProfile,
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

    // 0b. DNC / opt-out gate — applies to outbound channels only.
    // Set at the CONTACT level so it covers every sequence the contact is in.
    if (['sms', 'voice'].includes(step.channel) && contact.opted_out_at) {
        console.log(
            `[SCHEDULER] Contact ${contact.id} opted out on ${contact.opted_out_channel || 'unknown'} at ${contact.opted_out_at} — marking enrollment ${enrollment.id} as manual_stop`
        );
        await supabase
            .from('sequence_enrollments')
            .update({
                status: 'manual_stop',
                completed_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);
        await supabase.from('sequence_execution_log').insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            channel: step.channel,
            action: 'skipped_opt_out',
            provider_id: null,
            provider_response: { opted_out_channel: contact.opted_out_channel, opted_out_at: contact.opted_out_at },
            call_status: 'skipped',
            executed_at: new Date().toISOString(),
        });
        return;
    }

    // 1. Check skip conditions
    if (shouldSkipStep(enrollment, step.skip_conditions)) {
        console.log(`[SCHEDULER] Skipping step ${step.step_order} - conditions met`);
        await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step);
        return;
    }

    // Test enrollments bypass business-hours + TCPA so the operator can
    // dial themselves on demand without waiting for a window. Live
    // enrollments still respect the gates below.
    const isTestEnrollment = enrollment.is_test === true;

    // 2. Check business hours (for voice + SMS) — skipped for test enrollments
    if (
        !isTestEnrollment &&
        sequence.respect_business_hours &&
        step.channel !== 'email' &&
        !isWithinBusinessHours(timezone, tenantProfile.business_hours)
    ) {
        const nextWindow = getNextBusinessHoursStart(timezone, tenantProfile.business_hours);
        console.log(`[SCHEDULER] Outside business hours, rescheduling to ${nextWindow.toISOString()}`);
        await rescheduleStep(enrollment.id, nextWindow);
        return;
    }

    // 3. TCPA check (no calls/texts before 8am or after 9pm) — skipped for test enrollments
    if (
        !isTestEnrollment &&
        ['sms', 'voice'].includes(step.channel) &&
        !isTCPACompliant(timezone)
    ) {
        const nextWindow = getNextTCPAWindow(timezone);
        console.log(`[SCHEDULER] Outside TCPA window, rescheduling to ${nextWindow.toISOString()}`);
        await rescheduleStep(enrollment.id, nextWindow);
        return;
    }

    if (isTestEnrollment) {
        console.log(`[SCHEDULER] Test enrollment ${enrollment.id} — bypassing business-hours & TCPA gates.`);
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
        // Aliases used by frontend templates (dynamic-prompt-builder / conversation-flow-actions)
        contact_name: contact.name || contact.first_name || '',
        customer_name: contact.name || contact.first_name || '',
        contact_phone: contact.phone || '',
        contact_email: contact.email || '',
        // Property / account reference (from contact custom_fields — set by frontend override_variables)
        property_address: (contact.custom_fields as any)?.property_address || '',
        // Callback number: tenant phone, then contact phone as fallback
        callback_number: (tenantProfile as any).phone_number || (tenantProfile as any).emergency_phone || contact.phone || '',
        // Business / agent context
        business_name: sequence.name?.split(' - ')[0] || (tenantProfile as any).business_name || '',
        agent_name: (sequence as any).agent_name || sequence.name || '',
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
            await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step);
        }
        return;
    }

    // 7b. Intent-guided generation — if step has a brief, generate content from it
    // This bypasses the template+mutation path for brief-based steps
    if (step.step_brief && (dispatchChannel === 'sms' || dispatchChannel === 'email')) {
        try {
            console.log(`[SCHEDULER] Brief-based generation for step ${step.step_order} (${dispatchChannel}): "${step.step_brief.intent}"`);
            const generated = await generateOutboundContent({
                channel: dispatchChannel as 'sms' | 'email',
                brief: step.step_brief,
                conversationContext: conversationCtx,
                tenantProfile,
                contact,
                enrollment,
                sequence,
                step,
                emotionalState: {
                    sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
                    lastEmotion: enrollmentEI.last_emotion || null,
                    recommendedTone: enrollmentEI.recommended_tone || 'professional',
                    isHotLead: enrollmentEI.is_hot_lead || false,
                    isAtRisk: enrollmentEI.is_at_risk || false,
                },
            });
            renderedContent = generated.content;
            console.log(`[SCHEDULER] Brief generation succeeded: ${generated.reasoning}`);
        } catch (err) {
            console.log(`[SCHEDULER] Brief generation failed, using template fallback:`, err);
        }
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
                await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step);
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
            const voiceContent = renderedContent as VoiceContent;

            // Build conversation history injection
            let conversationHistoryInjection = '';
            if (conversationCtx && conversationCtx.interaction_count.total > 0) {
                conversationHistoryInjection = buildVoiceAgentContext(conversationCtx);
            }

            // Build tone directive injection
            const toneDirective = buildVoiceAgentToneDirective({
                recommendedTone: enrollmentEI.recommended_tone || 'professional',
                sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
                lastEmotion: enrollmentEI.last_emotion || null,
                isHotLead: enrollmentEI.is_hot_lead || false,
                isAtRisk: enrollmentEI.is_at_risk || false,
                needsHuman: enrollmentEI.needs_human_intervention || false,
            });

            // Pack enrollment custom_variables as override_variables
            if (enrollment.custom_variables && Object.keys(enrollment.custom_variables).length > 0) {
                const overrides: Record<string, string> = {};
                for (const [key, val] of Object.entries(enrollment.custom_variables)) {
                    overrides[key] = String(val);
                }
                voiceContent.override_variables = overrides;
            }

            // Look up the agent's assigned phone number for outbound caller ID
            let phoneNumberId: string | null = null;
            const stepWithAgent = step as SequenceStep & { voice_agent_id?: string };
            if (stepWithAgent.voice_agent_id) {
                const { data: phoneRow } = await supabase
                    .from('tenant_phone_numbers')
                    .select('vapi_phone_number_id')
                    .eq('agent_id', stepWithAgent.voice_agent_id)
                    .eq('status', 'active')
                    .single();
                phoneNumberId = phoneRow?.vapi_phone_number_id || null;
            }

            // ── Blueprint-based dispatch: load blueprint and assemble inline agent
            let inlineAgent: InlineVapiAgent | undefined;

            if (stepWithAgent.voice_agent_id) {
                const { data: agentRow } = await supabase
                    .from('agents')
                    .select('agent_blueprint')
                    .eq('id', stepWithAgent.voice_agent_id)
                    .single();

                const blueprint = agentRow?.agent_blueprint as AgentBlueprint | null;

                if (blueprint && isValidBlueprint(blueprint)) {
                    // Build runtime injections
                    const promptInjections: Record<string, string> = {};
                    if (conversationHistoryInjection) {
                        promptInjections.conversation_history = conversationHistoryInjection;
                    }
                    if (toneDirective) {
                        promptInjections.tone_directive = toneDirective;
                    }

                    // Merge per-task operator context ("current offer") into
                    // business_context; explicit step override still wins.
                    const sectionOverrides: Record<string, string> = {
                        ...(sequence.task_context
                            ? {
                                  business_context: `${blueprint.prompt_sections.business_context}\n\nCampaign context:\n${sequence.task_context}`,
                              }
                            : {}),
                        ...(voiceContent.prompt_section_overrides || {}),
                    };

                    inlineAgent = assembleInlineAgent({
                        blueprint,
                        promptSectionOverrides: sectionOverrides,
                        promptInjections,
                        toolOverrides: voiceContent.tool_overrides,
                        firstMessageOverride: voiceContent.first_message !== blueprint.first_message
                            ? voiceContent.first_message
                            : undefined,
                        variableValues: voiceContent.override_variables,
                    });

                    console.log(`[SCHEDULER] Blueprint assembled for enrollment ${enrollment.id} (model: ${blueprint.model.model}, voice: ${blueprint.voice.voiceId})`);
                } else {
                    console.log(`[SCHEDULER] No valid blueprint for agent ${stepWithAgent.voice_agent_id}, falling back to legacy dispatch`);
                }
            }

            // Fallback: if no blueprint, inject context into system_prompt the legacy way
            if (!inlineAgent) {
                if (sequence.task_context) {
                    voiceContent.system_prompt = `${voiceContent.system_prompt}\n\nCampaign context:\n${sequence.task_context}`;
                }
                if (conversationHistoryInjection) {
                    voiceContent.system_prompt = `${voiceContent.system_prompt}\n\n${conversationHistoryInjection}`;
                }
                voiceContent.system_prompt = `${voiceContent.system_prompt}\n\n${toneDirective}`;
            }

            await vapiQueue.add('vapi:call', {
                tenantId: enrollment.tenant_id,
                contactPhone: contact.phone,
                assistantConfig: voiceContent,
                enrollmentId: enrollment.id,
                stepId: step.id,
                urgencyPriority: getCallPriority(sequence.urgency_tier),
                ...(phoneNumberId ? { phoneNumberId } : {}),
                ...(inlineAgent ? { inlineAgent } : {}),
            }, {
                priority: getCallPriority(sequence.urgency_tier),
            });
            console.log(`[SCHEDULER] Dispatched VAPI call for enrollment ${enrollment.id}${phoneNumberId ? ` (caller ID: ${phoneNumberId})` : ''}${inlineAgent ? ' (blueprint inline)' : ' (legacy)'}`);
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
    }, sequence, step);
}

/**
 * Advance enrollment to next step
 * Now supports emotion-based delay adjustment from EI layer
 * and dynamic (JIT) sequence generation.
 */
async function advanceToNextStep(
    enrollment: SequenceEnrollment,
    sequenceId: string,
    emotionalState?: {
        sentimentTrend: SentimentTrend;
        isHotLead: boolean;
        isAtRisk: boolean;
        lastEmotion: PrimaryEmotion | null;
    },
    sequence?: Sequence,
    step?: SequenceStep
): Promise<void> {
    // ── Dynamic mode: enter awaiting_outcome instead of advancing
    if (sequence?.generation_mode === 'dynamic') {
        const lastChannel = step?.channel || 'sms';
        const isTestEnrollment = enrollment.is_test === true;
        // Test mode: use 30-second timeout instead of hours-long outcome window
        const timeoutMs = isTestEnrollment
            ? TEST_MODE_DELAY_SECONDS * 1000
            : getOutcomeTimeout(lastChannel as ChannelType) * 60 * 60 * 1000;
        const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

        await supabase
            .from('sequence_enrollments')
            .update({
                status: 'awaiting_outcome',
                current_step_order: enrollment.current_step_order + 1,
                total_attempts: enrollment.total_attempts + 1,
                outcome_timeout_at: timeoutAt,
                next_step_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);

        const timeoutLabel = isTestEnrollment ? `${TEST_MODE_DELAY_SECONDS}s (test mode)` : `${getOutcomeTimeout(lastChannel as ChannelType)}h`;
        console.log(`[SCHEDULER] Dynamic enrollment ${enrollment.id} now awaiting outcome (timeout: ${timeoutLabel})`);
        return;
    }

    // ── Static mode: existing behavior
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

    // Test mode: compress all delays to 30 seconds
    const isTestEnrollment = enrollment.is_test === true;
    if (isTestEnrollment) {
        const originalDelay = nextStep.delay_seconds;
        adjustedDelaySeconds = TEST_MODE_DELAY_SECONDS;
        console.log(`[SCHEDULER] Test mode: delay compressed ${originalDelay}s → ${adjustedDelaySeconds}s for enrollment ${enrollment.id}`);
    } else if (emotionalState) {
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
 * Handle a timed-out dynamic enrollment — generate the next step based on no-response.
 */
async function handleDynamicTimeout(enrollment: SequenceEnrollment & {
    sequences: Sequence;
    contacts: Contact;
    tenant_profiles?: TenantProfile;
}): Promise<void> {
    const sequence = enrollment.sequences;
    const contact = enrollment.contacts;

    if (!sequence || sequence.generation_mode !== 'dynamic') return;

    // Atomic claim
    const claimed = await claimEnrollmentForGeneration(enrollment.id);
    if (!claimed) {
        console.log(`[SCHEDULER] Dynamic timeout for ${enrollment.id} already claimed — skipping`);
        return;
    }

    try {
        // Load tenant profile if not joined
        let tenantProfile = enrollment.tenant_profiles || null;
        if (!tenantProfile) {
            const { data: tp } = await supabase
                .from('tenant_profiles')
                .select('*')
                .eq('tenant_id', enrollment.tenant_id)
                .single();
            tenantProfile = tp as TenantProfile | null;
        }

        if (!tenantProfile) {
            console.error(`[SCHEDULER] No tenant profile for ${enrollment.tenant_id}`);
            await endDynamicSequence(enrollment.id, 'no_profile', 'Tenant profile not found');
            return;
        }

        // Determine last channel from previous steps
        const executedSteps = await getExecutedSteps(sequence.id, enrollment.id);
        const lastStep = executedSteps[executedSteps.length - 1];
        const lastChannel: ChannelType = lastStep?.channel || 'sms';

        // Load conversation context
        let conversationCtx: ConversationContext | null = null;
        try {
            conversationCtx = await getDynamicConversationContext(contact.id, enrollment.id);
        } catch { /* proceed without */ }

        const outcomeCtx: OutcomeContext = {
            type: 'timeout_no_response',
            details: `No response after ${lastChannel} step within timeout window`,
            channel: lastChannel,
        };

        const result = await generateNextStep({
            enrollment,
            sequence,
            contact,
            tenantProfile,
            conversationContext: conversationCtx,
            lastOutcome: outcomeCtx,
            previousSteps: executedSteps,
        });

        if (result.should_continue && result.step) {
            const newStepOrder = (enrollment.current_step_order || 0) + 1;
            const vapiId = await getSequenceVapiAssistantId(sequence.id);

            await insertGeneratedStep({
                sequenceId: sequence.id,
                enrollmentId: enrollment.id,
                stepOrder: newStepOrder,
                result,
                vapiAssistantId: vapiId,
            });

            await activateEnrollmentForNextStep(
                enrollment.id,
                result.step.delay_seconds || 0,
                enrollment.current_step_order // current_step_order stays — scheduler will pick up newStepOrder
            );
        } else {
            await endDynamicSequence(enrollment.id, result.end_reason || 'ai_decided', result.reasoning);
        }
    } catch (error) {
        console.error(`[SCHEDULER] Dynamic timeout handling failed for ${enrollment.id}:`, error);
        // Revert to awaiting_outcome so it can retry
        await supabase
            .from('sequence_enrollments')
            .update({ status: 'awaiting_outcome', updated_at: new Date().toISOString() })
            .eq('id', enrollment.id);
    }
}

/**
 * Main scheduler tick
 */
async function tick(): Promise<void> {
    const startTime = Date.now();

    try {
        const dueEnrollments = await fetchDueEnrollments();

        if (dueEnrollments.length > 0) {
            console.log(`[SCHEDULER] Processing ${dueEnrollments.length} due enrollments`);

            for (const ctx of dueEnrollments) {
                try {
                    await processStep(ctx);
                } catch (error) {
                    console.error(`[SCHEDULER] Error processing enrollment ${ctx.enrollment.id}:`, error);
                }
            }
        }

        // ── Dynamic sequence timeout polling
        const { data: timedOutEnrollments } = await supabase
            .from('sequence_enrollments')
            .select('*, sequences(*), contacts(*), tenant_profiles!sequence_enrollments_tenant_id_fkey(*)')
            .eq('status', 'awaiting_outcome')
            .lte('outcome_timeout_at', new Date().toISOString())
            .limit(BATCH_SIZE);

        if (timedOutEnrollments && timedOutEnrollments.length > 0) {
            console.log(`[SCHEDULER] Processing ${timedOutEnrollments.length} timed-out dynamic enrollments`);

            for (const enrollment of timedOutEnrollments) {
                try {
                    await handleDynamicTimeout(enrollment as any);
                } catch (error) {
                    console.error(`[SCHEDULER] Error handling dynamic timeout for ${enrollment.id}:`, error);
                }
            }
        }

        const processed = (dueEnrollments.length) + (timedOutEnrollments?.length || 0);
        if (processed > 0) {
            const duration = Date.now() - startTime;
            console.log(`[SCHEDULER] Tick completed in ${duration}ms, processed ${processed} enrollments`);
        }
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
