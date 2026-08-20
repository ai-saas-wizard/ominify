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
import { smsQueue, emailQueue, vapiQueue, closeConnections } from '../lib/redis.js';
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
    type VoiceGeneratedContent,
} from '../lib/outbound-generator.js';
import { getAgentMessaging } from '../lib/agent-messaging.js';
import { isEmailDispatchable } from '../lib/channel-capabilities.js';
import { TEST_MODE_DELAY_SECONDS, clampTestDelayMs } from '../lib/test-mode.js';
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
import { addSeconds } from 'date-fns';
import {
    isTCPACompliant,
    isWithinBusinessHours,
    getNextBusinessHoursStart,
    getNextTCPAWindow,
    parseCallingWindow,
    isWithinCallingWindow,
    getNextCallingWindowStart,
    parseCallingDays,
    isCallingDayAllowed,
    withJitter,
} from '../lib/compliance.js';
import {
    dailyCallCapKey,
    reserveDailyCall,
    releaseDailyCall,
} from '../lib/daily-call-cap.js';

const POLL_INTERVAL_MS = 5000; // 5 seconds
const BATCH_SIZE = 100;
// TEST_MODE_DELAY_SECONDS now lives in lib/test-mode.ts — the JIT path in
// dynamic-step-generator.ts needs the same policy.
// Lease window pushed onto next_step_at when claiming a row. Concurrent ticks
// (or a second scheduler process) will skip rows whose next_step_at is now
// in the future, preventing duplicate dispatch. If processStep crashes, the
// lease expires and the row becomes eligible again.
const CLAIM_LEASE_MS = 5 * 60 * 1000; // 5 minutes

interface ContactFieldDef {
    field_key: string;
    name: string | null;
    description: string | null;
    field_type: string | null;
}

interface EnrollmentWithContext {
    enrollment: SequenceEnrollment;
    step: SequenceStep;
    sequence: Sequence;
    contact: Contact;
    tenantProfile: TenantProfile;
    contactFieldDefs: ContactFieldDef[];
}

/**
 * Cap reservations currently held by an in-flight processStep, keyed by
 * enrollment id. processStep clears its entry when it releases the slot or
 * hands ownership to the queued VAPI job; the tick loop releases anything
 * left behind by a throw, so an LLM/DB error can never permanently burn a
 * slot in the day's cap.
 */
const pendingCapReservations = new Map<string, string>();

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
    // Tolerate undefined/null/non-string template fields. Dynamically-
    // generated steps occasionally come back missing one of the channel's
    // text fields; previously this crashed with "Cannot read properties of
    // undefined (reading 'replace')" and put the scheduler in a hot loop.
    const render = (text: unknown): string => {
        if (typeof text !== 'string') return '';
        return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
            // Missing variables render as '' — never leak a literal
            // {{placeholder}} into lead-visible text.
            return String(variables[key] ?? '');
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
    // Atomic claim via FOR UPDATE SKIP LOCKED batch RPC: bumps next_step_at
    // to the lease and returns only the rows we actually claimed, so
    // overlapping ticks (or a second scheduler) won't both claim the same
    // enrollment — duplicate-dispatch is prevented at the DB layer.
    const leaseUntilIso = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();

    const { data: claimedRows, error: claimErr } = await supabase.rpc('claim_due_enrollments', {
        p_lease_until: leaseUntilIso,
        p_limit: BATCH_SIZE,
    });

    if (claimErr) {
        console.error('[SCHEDULER] Error claiming due enrollments:', claimErr);
        return [];
    }
    if (!claimedRows || claimedRows.length === 0) {
        return [];
    }

    // RPC returns SETOF uuid — rows may arrive as bare strings or { id } objects
    // depending on PostgREST scalar serialization.
    const claimedIds = (claimedRows as any[]).map((r: any) =>
        typeof r === 'string' ? r : r.id ?? r.claim_due_enrollments
    ).filter(Boolean);

    // Re-fetch with full context now that we hold the lease.
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
            *,
            sequences (*),
            contacts (*)
        `)
        .in('id', claimedIds);

    if (error) {
        console.error('[SCHEDULER] Error fetching claimed enrollments:', error);
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

    // Batch-load custom contact_fields per client. The descriptions feed
    // {{contact_field_legend}} so AI step generation + SMS/email templates
    // know what each custom_variable means.
    const fieldDefsByClientId = new Map<string, ContactFieldDef[]>();
    if (clientIds.length > 0) {
        const { data: fieldDefs, error: fieldErr } = await supabase
            .from('contact_fields')
            .select('client_id, field_key, name, description, field_type')
            .in('client_id', clientIds);
        if (fieldErr) {
            console.error('[SCHEDULER] Error fetching contact_fields:', fieldErr);
        } else if (fieldDefs) {
            for (const f of fieldDefs as any[]) {
                if (!f.client_id) continue;
                const arr = fieldDefsByClientId.get(f.client_id) || [];
                arr.push({
                    field_key: f.field_key,
                    name: f.name || null,
                    description: f.description || null,
                    field_type: f.field_type || null,
                });
                fieldDefsByClientId.set(f.client_id, arr);
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

        // Get the next step. JIT-generated steps are enrollment-scoped
        // (enrollment_id set); static template steps have enrollment_id NULL.
        // Order non-null first so this enrollment's personalized step wins
        // over a shared template step at the same step_order.
        const { data: stepRows, error: stepError } = await supabase
            .from('sequence_steps')
            .select('*')
            .eq('sequence_id', enrollment.sequence_id)
            .eq('step_order', enrollment.current_step_order + 1)
            .or(`enrollment_id.eq.${enrollment.id},enrollment_id.is.null`)
            .order('enrollment_id', { ascending: false, nullsFirst: false })
            .limit(1);

        if (stepError) {
            // Real query error — do NOT mark completed. Leave the lease in
            // place; the enrollment becomes eligible again when it expires.
            console.error(
                `[SCHEDULER] Error fetching step ${enrollment.current_step_order + 1} for enrollment ${enrollment.id} — leaving for retry:`,
                stepError
            );
            continue;
        }

        const stepData = stepRows?.[0];
        if (!stepData) {
            // No more steps - sequence complete
            const { error: completeErr } = await supabase
                .from('sequence_enrollments')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('id', enrollment.id);
            if (completeErr) {
                console.error(`[SCHEDULER] Failed to mark enrollment ${enrollment.id} completed:`, completeErr);
            }
            continue;
        }

        results.push({
            enrollment: enrollment,
            step: stepData as SequenceStep,
            sequence: enrollment.sequences,
            contact: enrollment.contacts,
            tenantProfile,
            contactFieldDefs: fieldDefsByClientId.get(enrollment.tenant_id as string) || [],
        });
    }

    return results;
}

/**
 * Process a single enrollment step
 */
async function processStep(ctx: EnrollmentWithContext): Promise<void> {
    const { enrollment, step, sequence, contact, tenantProfile, contactFieldDefs } = ctx;
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
        // Park for 24h instead of letting the 5-minute claim lease churn —
        // the claim would otherwise re-surface this row on every expiry.
        const parkedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        console.log(`[SCHEDULER] Enrollment ${enrollment.id} needs human intervention — parking until ${parkedUntil}`);
        const { error: parkErr } = await supabase
            .from('sequence_enrollments')
            .update({ next_step_at: parkedUntil, updated_at: new Date().toISOString() })
            .eq('id', enrollment.id);
        if (parkErr) {
            console.error(`[SCHEDULER] Failed to park enrollment ${enrollment.id}:`, parkErr);
        }
        return; // Don't advance — wait for human to take over
    }

    // 0b. DNC / opt-out gate — applies to ALL outbound channels (sms, voice,
    // email). Set at the CONTACT level so it covers every sequence the
    // contact is in.
    if (contact.opted_out_at) {
        console.log(
            `[SCHEDULER] Contact ${contact.id} opted out on ${contact.opted_out_channel || 'unknown'} at ${contact.opted_out_at} — marking enrollment ${enrollment.id} as manual_stop`
        );
        const { error: stopErr } = await supabase
            .from('sequence_enrollments')
            .update({
                status: 'manual_stop',
                completed_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);
        if (stopErr) {
            console.error(`[SCHEDULER] Failed to manual_stop opted-out enrollment ${enrollment.id}:`, stopErr);
        }
        const { error: logErr } = await supabase.from('sequence_execution_log').insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            channel: step.channel,
            action: 'skipped_opt_out',
            provider_id: null,
            provider_response: { opted_out_channel: contact.opted_out_channel, opted_out_at: contact.opted_out_at },
            call_status: 'skipped',
            executed_at: new Date().toISOString(),
        });
        if (logErr) {
            console.error(`[SCHEDULER] Failed to log opt-out skip for enrollment ${enrollment.id}:`, logErr);
        }
        return;
    }

    // 1. Check skip conditions
    if (shouldSkipStep(enrollment, step.skip_conditions)) {
        console.log(`[SCHEDULER] Skipping step ${step.step_order} - conditions met`);
        await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step, true);
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
        const nextWindow = withJitter(
            getNextBusinessHoursStart(timezone, tenantProfile.business_hours),
            null
        );
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
        const nextWindow = withJitter(getNextTCPAWindow(timezone), null);
        console.log(`[SCHEDULER] Outside TCPA window, rescheduling to ${nextWindow.toISOString()}`);
        await rescheduleStep(enrollment.id, nextWindow);
        return;
    }

    // 3b. Per-sequence calling window + calling days (voice only).
    // Tenant-timezone bounds that INTERSECT the business-hours + TCPA gates
    // above rather than replacing them. Evaluated here — before
    // conversation-context loading and brief generation — so a deferred lead
    // costs one UPDATE, not an LLM call.
    const callingWindow = parseCallingWindow(
        sequence.calling_window_start,
        sequence.calling_window_end
    );
    const callingDays = parseCallingDays(sequence.calling_days);

    // Reservation held against this sequence's daily cap for THIS dispatch.
    // Every early return past the gate below has to hand it back, or a lead
    // that was never dialed still burns a slot in today's cap.
    let capReservationKey: string | null = null;

    if (!isTestEnrollment && step.channel === 'voice') {
        if (callingDays && !isCallingDayAllowed(timezone, callingDays)) {
            const nextOpen = withJitter(
                getNextCallingWindowStart(timezone, callingWindow, callingDays),
                callingWindow?.durationMinutes ?? null
            );
            console.log(
                `[SCHEDULER] Enrollment ${enrollment.id} outside calling days (${sequence.calling_days?.join(',')}) in ${timezone}, rescheduling to ${nextOpen.toISOString()}`
            );
            await rescheduleStep(enrollment.id, nextOpen);
            return;
        }

        if (callingWindow && !isWithinCallingWindow(timezone, callingWindow)) {
            const nextOpen = withJitter(
                getNextCallingWindowStart(timezone, callingWindow, callingDays),
                callingWindow.durationMinutes
            );
            console.log(
                `[SCHEDULER] Enrollment ${enrollment.id} outside calling window ${callingWindow.start}-${callingWindow.end} (${timezone}), rescheduling to ${nextOpen.toISOString()}`
            );
            await rescheduleStep(enrollment.id, nextOpen);
            return;
        }

        // 3c. Daily call cap. Reserved atomically so overlapping ticks (or a
        // second scheduler process) can't both spend the last slot.
        const dailyCap = sequence.daily_call_cap;
        if (dailyCap && dailyCap > 0) {
            const key = dailyCallCapKey(sequence.id, timezone);
            if (!(await reserveDailyCall(key, dailyCap))) {
                // Today's cap is spent. The gates above already proved we're
                // inside today's window on an allowed day, so the next opening
                // is the NEXT allowed day's (business-hours opening when
                // neither a window nor days are configured).
                const nextDay = withJitter(
                    callingWindow || callingDays
                        ? getNextCallingWindowStart(timezone, callingWindow, callingDays)
                        : getNextBusinessHoursStart(timezone, tenantProfile.business_hours),
                    callingWindow?.durationMinutes ?? null
                );
                console.log(
                    `[SCHEDULER] Daily call cap (${dailyCap}) reached for sequence ${sequence.id} — deferring enrollment ${enrollment.id} to ${nextDay.toISOString()}`
                );
                await rescheduleStep(enrollment.id, nextDay);
                return;
            }
            capReservationKey = key;
            pendingCapReservations.set(enrollment.id, key);
        }
    }

    if (isTestEnrollment) {
        console.log(`[SCHEDULER] Test enrollment ${enrollment.id} — bypassing business-hours, TCPA, calling-window & daily-cap gates.`);
    }

    // 4. Load conversation context for cross-channel awareness
    let conversationCtx: ConversationContext | null = null;
    try {
        conversationCtx = await getConversationContext(contact.id, enrollment.id);
    } catch (err) {
        console.log(`[SCHEDULER] Could not load conversation context, proceeding without it`);
    }

    // 4b. Resolve the bound agent's messaging assets (SMS persona, shared offer
    // context, voice assistant id) so this dispatch can adapt per channel.
    const agentMessaging = await getAgentMessaging(sequence.agent_id);

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

    // Build a glossary of custom field descriptions for any custom_variable
    // referenced by this enrollment. Surfaced to AI step-generation prompts and
    // any SMS/email template that interpolates {{contact_field_legend}}.
    const customFieldKeys = new Set<string>([
        ...Object.keys(contact.custom_fields || {}),
        ...Object.keys(enrollment.custom_variables || {}),
    ]);
    const defByKey = new Map(contactFieldDefs.map((d) => [d.field_key, d]));
    const legendLines: string[] = [];
    for (const key of customFieldKeys) {
        const def = defByKey.get(key);
        if (!def) continue;
        const head = def.name && def.name !== key ? `${key} (${def.name})` : key;
        legendLines.push(def.description ? `- ${head}: ${def.description}` : `- ${head}`);
    }
    const contactFieldLegend = legendLines.length > 0
        ? legendLines.join('\n')
        : '(no documented custom fields)';

    const contactDataMerged: Record<string, any> = {
        ...(contact.custom_fields || {}),
        ...(enrollment.custom_variables || {}),
    };

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
        // Tenant scheduling URL (dynamic steps are told to emit {{booking_link}})
        booking_link: (tenantProfile.booking_link || '').trim(),
        // Persistent contact custom fields (from manual entry / settings)
        ...(contact.custom_fields || {}),
        // Per-enrollment custom variables (from CSV / webhook — overrides contact fields)
        ...enrollment.custom_variables,
        // Conversation memory variables (cross-channel context)
        ...conversationVars,
        // Emotional intelligence / tone variables
        ...toneVars,
        // Custom field semantic glossary (description text from contact_fields).
        contact_field_legend: contactFieldLegend,
        contact_data: JSON.stringify(contactDataMerged),
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
    // Brief-based steps skip this entirely: intent-guided generation (7b)
    // overwrites the content anyway, so mutating first would burn an OpenAI
    // call and write recordMutation audit rows for output that's discarded.
    let wasMutated = false;
    if (!step.step_brief && shouldMutate(step, sequence, enrollment, conversationCtx)) {
        try {
            const mutation = await mutateStepContent(
                step,
                conversationCtx!,
                tenantProfile,
                sequence.mutation_aggressiveness || 'moderate',
                {
                    smsPrompt: agentMessaging?.smsPrompt,
                    sharedContextText: agentMessaging?.sharedContextText,
                }
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

    // Self-healing steered this touch away from voice — no dial will happen.
    if (capReservationKey && dispatchChannel !== 'voice') {
        await releaseDailyCall(capReservationKey);
        pendingCapReservations.delete(enrollment.id);
        capReservationKey = null;
    }
    // The reverse steer (e.g. landline: sms → voice) skipped the window/cap
    // gates above because they key on step.channel. The dial-time gate in the
    // VAPI worker re-checks TCPA/window/cap for jobs without a dailyCapKey,
    // so the dial is still bounded — see processVapiJob.

    // Check contact validity for the dispatch channel
    const validity = checkContactValidity(contact, dispatchChannel);
    if (!validity.valid) {
        console.log(`[SCHEDULER] Contact invalid for ${dispatchChannel}: ${validity.reason}`);
        await releaseDailyCall(capReservationKey);
        pendingCapReservations.delete(enrollment.id);
        capReservationKey = null;
        // Trigger self-healing which will find an alternative
        if (validity.failureType) {
            const healingAction = await handleFailure(enrollment.id, step.id, validity.failureType, {
                reason: validity.reason,
            });
            // If the healer dispatched an alternate send for THIS step
            // (channel switch/override or fallback SMS), the step is done —
            // advance normally. Returning early here would let the lease
            // expire and re-process the step → duplicate message.
            const dispatchedAlternate =
                healingAction &&
                (['override_channel', 'switch_channel', 'inject_fallback_sms'].includes(healingAction.type) ||
                    (healingAction.type === 'mark_invalid' && !!healingAction.details.new_channel));
            if (dispatchedAlternate) {
                console.log(`[SCHEDULER] Healing dispatched alternate send (${healingAction!.type}) for enrollment ${enrollment.id} — advancing`);
                await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step);
            }
            // Other actions (extend_delay, skip_and_advance, end_sequence)
            // already adjusted enrollment state inside the healer.
        } else {
            await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step, true);
        }
        return;
    }

    // 7b. Intent-guided generation — if step has a brief, generate content from it
    // This bypasses the template+mutation path for brief-based steps.
    // Voice generates only the opening line (first_message) and MERGES it
    // into the rendered content so vapi_assistant_id / system_prompt /
    // override_variables from the step survive.
    if (step.step_brief) {
        try {
            console.log(`[SCHEDULER] Brief-based generation for step ${step.step_order} (${dispatchChannel}): "${step.step_brief.intent}"`);
            const generated = await generateOutboundContent({
                channel: dispatchChannel,
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
            renderedContent = dispatchChannel === 'voice'
                ? { ...(renderedContent as VoiceContent), ...(generated.content as VoiceGeneratedContent) }
                : (generated.content as SmsContent | EmailContent);
            console.log(`[SCHEDULER] Brief generation succeeded: ${generated.reasoning}`);
        } catch (err) {
            console.log(`[SCHEDULER] Brief generation failed, using template fallback:`, err);
        }
    }

    // 7c. Placeholder guard — wizard-created steps store literal
    // "[AI-generated at dispatch]" template content that must NEVER reach a
    // lead. If it's still present here (brief generation threw, or an old
    // row was created before step_brief was persisted), withhold the send.
    // Nothing has been dispatched yet, so parking and returning is
    // duplicate-free: the claim lease bumped next_step_at, and this update
    // re-surfaces the row for a fresh attempt. 30min (not the bare 5min
    // lease) keeps persistent generation failures from churning a batch
    // slot every tick. Known edge: a placeholder email step for a contact
    // with no email parks here instead of skip-advancing at dispatch.
    //
    // Only the fields the dispatch channel actually sends are checked — a
    // channel override leaves the original channel's keys on the object
    // (e.g. an SMS step's placeholder body riding along on a voice
    // dispatch after 7b generated a real opener), and stale foreign-channel
    // keys must not block a successful send.
    const placeholderCheckFields: Array<string | undefined> =
        dispatchChannel === 'sms'
            ? [(renderedContent as SmsContent).body]
            : dispatchChannel === 'email'
            ? [
                  (renderedContent as EmailContent).subject,
                  (renderedContent as EmailContent).body_text,
                  (renderedContent as EmailContent).body_html,
              ]
            : [
                  (renderedContent as VoiceContent).first_message,
                  (renderedContent as VoiceContent).system_prompt,
              ];
    if (placeholderCheckFields.some((f) => typeof f === 'string' && f.includes('[AI-generated at dispatch]'))) {
        await releaseDailyCall(capReservationKey);
        pendingCapReservations.delete(enrollment.id);
        capReservationKey = null;
        const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        console.error(
            `[SCHEDULER] Step ${step.id} (enrollment ${enrollment.id}) still contains dispatch placeholder ` +
            `(${step.step_brief ? 'brief generation failed' : 'step_brief missing — needs backfill'}) — withholding send, retrying at ${retryAt}`
        );
        const { error: parkErr } = await supabase
            .from('sequence_enrollments')
            .update({ next_step_at: retryAt, updated_at: new Date().toISOString() })
            .eq('id', enrollment.id);
        if (parkErr) {
            console.error(`[SCHEDULER] Failed to park placeholder-blocked enrollment ${enrollment.id}:`, parkErr);
        }
        const { error: logErr } = await supabase.from('sequence_execution_log').insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            channel: dispatchChannel,
            action: 'blocked_placeholder',
            provider_id: null,
            provider_response: { has_step_brief: !!step.step_brief, retry_at: retryAt },
            call_status: 'skipped',
            executed_at: new Date().toISOString(),
        });
        if (logErr) {
            console.error(`[SCHEDULER] Failed to log placeholder block for enrollment ${enrollment.id}:`, logErr);
        }
        return;
    }

    // 7d. Empty-SMS-body guard. A JIT step whose generated content had no
    // usable text normalizes to { body: '' } (see normalizeGeneratedStepContent).
    // Never ship an empty body to Twilio — it rejects with error 21602 and the
    // worker fails silently. Log a visible failure and skip-advance; for dynamic
    // enrollments skip-advance sets an immediate outcome timeout, so the JIT
    // generator produces a fresh step (which, post-normalization, has a real body).
    if (dispatchChannel === 'sms' && !(renderedContent as SmsContent).body?.trim()) {
        console.error(
            `[SCHEDULER] Step ${step.id} (enrollment ${enrollment.id}) has an empty SMS body — withholding send and skip-advancing`
        );
        const { error: emptyLogErr } = await supabase.from('sequence_execution_log').insert({
            enrollment_id: enrollment.id,
            step_id: step.id,
            channel: 'sms',
            action: 'blocked_empty_body',
            provider_id: null,
            provider_response: { reason: 'empty_sms_body', generated_dynamically: !!step.generated_dynamically },
            call_status: 'skipped',
            executed_at: new Date().toISOString(),
        });
        if (emptyLogErr) {
            console.error(`[SCHEDULER] Failed to log empty-body block for enrollment ${enrollment.id}:`, emptyLogErr);
        }
        await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step, true);
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
                ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
            });
            console.log(`[SCHEDULER] Dispatched SMS for enrollment ${enrollment.id}`);
            break;

        case 'email':
            if (!contact.email) {
                console.log(`[SCHEDULER] No email for contact, skipping step`);
                await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step, true);
                return;
            }
            // Tenant sendability guard: legacy static sequences (and older
            // wizard step rows) can carry email steps for tenants with no way
            // to send at all — skip-advance instead of hard-failing in the
            // email worker. Uses the email-worker's own send truth (any active
            // account OR env SMTP fallback), NOT the stricter is_verified
            // offering check, so nothing that sent yesterday is suppressed.
            if (!(await isEmailDispatchable(enrollment.tenant_id))) {
                console.log(`[SCHEDULER] Email not configured for tenant ${enrollment.tenant_id}, skipping step`);
                const { error: skipLogErr } = await supabase.from('sequence_execution_log').insert({
                    enrollment_id: enrollment.id,
                    step_id: step.id,
                    channel: 'email',
                    action: 'skipped',
                    status: 'skipped',
                    email_status: 'skipped',
                    provider_id: null,
                    provider_response: { reason: 'Email not configured for tenant' },
                    executed_at: new Date().toISOString(),
                });
                if (skipLogErr) {
                    console.error(`[SCHEDULER] Failed to log email capability skip for enrollment ${enrollment.id}:`, skipLogErr);
                }
                await advanceToNextStep(enrollment, sequence.id, undefined, sequence, step, true);
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
                ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
            });
            console.log(`[SCHEDULER] Dispatched email for enrollment ${enrollment.id}`);
            break;

        case 'voice': {
            const voiceContent = renderedContent as VoiceContent;

            // If this step didn't bake in a specific assistant, dial the agent
            // the sequence is bound to (sequences.agent_id → agents.vapi_id)
            // instead of falling through to the worker's hardcoded generic
            // transient. This makes "which agent the calls go from" explicit.
            if (!voiceContent.vapi_assistant_id && agentMessaging?.vapiId) {
                voiceContent.vapi_assistant_id = agentMessaging.vapiId;
                console.log(`[SCHEDULER] Voice step missing assistant id — using bound agent ${agentMessaging.agentId} (vapi ${agentMessaging.vapiId}) for enrollment ${enrollment.id}`);
            }

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

            // Resolve outbound caller ID. Priority order:
            //   1. tenant_profiles.default_outbound_phone_id (operator's
            //      explicit choice from /settings/outbound-caller-id)
            //   2. Phone assigned to this specific agent (legacy per-agent
            //      assignment, mostly used for inbound routing)
            //   3. Any active phone for this tenant registered with VAPI
            //      (last-resort fallback so test_now works before configuration)
            // VAPI rejects /call/phone without phoneNumberId, so we MUST land
            // on something here.
            let phoneNumberId: string | null = null;
            const stepWithAgent = step as SequenceStep & { voice_agent_id?: string };

            const { data: tenantDefault } = await supabase
                .from('tenant_profiles')
                .select('default_outbound_phone_id')
                .eq('client_id', enrollment.tenant_id)
                .single();

            if (tenantDefault?.default_outbound_phone_id) {
                const { data: defaultPhone } = await supabase
                    .from('tenant_phone_numbers')
                    .select('vapi_phone_number_id, status')
                    .eq('id', tenantDefault.default_outbound_phone_id)
                    .single();
                if (
                    defaultPhone?.status === 'active' &&
                    defaultPhone.vapi_phone_number_id
                ) {
                    phoneNumberId = defaultPhone.vapi_phone_number_id;
                }
            }

            if (!phoneNumberId && stepWithAgent.voice_agent_id) {
                const { data: phoneRow } = await supabase
                    .from('tenant_phone_numbers')
                    .select('vapi_phone_number_id')
                    .eq('agent_id', stepWithAgent.voice_agent_id)
                    .eq('status', 'active')
                    .single();
                phoneNumberId = phoneRow?.vapi_phone_number_id || null;
            }

            if (!phoneNumberId) {
                const { data: fallbackPhone } = await supabase
                    .from('tenant_phone_numbers')
                    .select('vapi_phone_number_id')
                    .eq('client_id', enrollment.tenant_id)
                    .eq('status', 'active')
                    .not('vapi_phone_number_id', 'is', null)
                    .limit(1)
                    .maybeSingle();
                if (fallbackPhone?.vapi_phone_number_id) {
                    phoneNumberId = fallbackPhone.vapi_phone_number_id;
                    console.log(`[SCHEDULER] No tenant-default or agent-level phone for ${stepWithAgent.voice_agent_id || '<no agent>'}, falling back to tenant phone ${phoneNumberId}`);
                }
            }

            // ── Blueprint-based dispatch: load blueprint and assemble inline
            // agent ONLY when the call genuinely diverges from the baked-in
            // assistant. When there's a blueprint but nothing to override,
            // we fall through to the assistantId path in the worker, which
            // is cheaper and uses the assistant exactly as it was created.
            let inlineAgent: InlineVapiAgent | undefined;

            if (stepWithAgent.voice_agent_id) {
                const { data: agentRow } = await supabase
                    .from('agents')
                    .select('agent_blueprint')
                    .eq('id', stepWithAgent.voice_agent_id)
                    .single();

                const blueprint = agentRow?.agent_blueprint as AgentBlueprint | null;

                if (blueprint && isValidBlueprint(blueprint)) {
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

                    const hasToolOverrides = !!(
                        voiceContent.tool_overrides &&
                        ((voiceContent.tool_overrides.add?.length || 0) > 0 ||
                            (voiceContent.tool_overrides.remove?.length || 0) > 0)
                    );

                    const hasFirstMessageOverride = !!(
                        voiceContent.first_message &&
                        voiceContent.first_message !== blueprint.first_message
                    );

                    // What counts as a "real override" — anything that
                    // changes the assistant's structure beyond per-call vars:
                    //   - sectionOverrides: explicit prompt-section changes
                    //     OR sequence.task_context that needs to be sewn into
                    //     business_context.
                    //   - hasToolOverrides: tool list mutations.
                    //   - hasFirstMessageOverride: a different opening line
                    //     that the operator has explicitly set on this step
                    //     (note: assistantOverrides.firstMessage handles this
                    //     on the assistantId path too — see below).
                    //
                    // INTENTIONALLY excluded:
                    //   - promptInjections (conversation_history, tone_directive):
                    //     these are computed on every call from EI state and
                    //     are non-empty by construction. Counting them would
                    //     force inline always. They flow as variableValues on
                    //     the assistantId path; if the baked-in prompt has
                    //     {{conversation_history}} / {{tone_directive}}
                    //     placeholders they get substituted, otherwise they're
                    //     harmlessly unused.
                    //   - override_variables: pure variableValues, supported
                    //     by both paths.
                    const hasRealOverrides =
                        Object.keys(sectionOverrides).length > 0 ||
                        hasToolOverrides ||
                        hasFirstMessageOverride;

                    if (hasRealOverrides) {
                        inlineAgent = assembleInlineAgent({
                            blueprint,
                            promptSectionOverrides: sectionOverrides,
                            promptInjections,
                            toolOverrides: voiceContent.tool_overrides,
                            firstMessageOverride: hasFirstMessageOverride
                                ? voiceContent.first_message
                                : undefined,
                            variableValues: voiceContent.override_variables,
                        });

                        console.log(`[SCHEDULER] Blueprint assembled for enrollment ${enrollment.id} (model: ${blueprint.model.model}, voice: ${blueprint.voice.voiceId})`);
                    } else {
                        // No meaningful overrides — let the worker take the
                        // assistantId path with no override layering.
                        console.log(`[SCHEDULER] Blueprint exists for enrollment ${enrollment.id} but no overrides — using assistantId path`);
                    }
                } else {
                    console.log(`[SCHEDULER] No valid blueprint for agent ${stepWithAgent.voice_agent_id}, falling back to legacy dispatch`);
                }
            }

            // When NOT using an inline agent, surface task_context /
            // conversation_history / tone_directive as VoiceContent fields so
            // the worker attaches them as assistantOverrides.variableValues.
            // The baked-in prompt can pick them up via {{task_context}} etc;
            // if it doesn't, they're harmlessly unused.
            if (!inlineAgent) {
                if (sequence.task_context) voiceContent.task_context = sequence.task_context;
                if (conversationHistoryInjection) voiceContent.conversation_history = conversationHistoryInjection;
                if (toneDirective) voiceContent.tone_directive = toneDirective;
            }

            await vapiQueue.add('vapi:call', {
                tenantId: enrollment.tenant_id,
                contactPhone: contact.phone,
                assistantConfig: voiceContent,
                enrollmentId: enrollment.id,
                stepId: step.id,
                // The worker's dial-time gate and capacity requeue need these:
                // sequenceId to re-check window/cap, stepOrder to know exactly
                // which step this dial was for (never inferred from enrollment
                // state, which advances right after this add), isTest to keep
                // operator test dials instant.
                sequenceId: sequence.id,
                stepOrder: step.step_order,
                ...(isTestEnrollment ? { isTest: true } : {}),
                urgencyPriority: getCallPriority(sequence.urgency_tier),
                ...(phoneNumberId ? { phoneNumberId } : {}),
                ...(inlineAgent ? { inlineAgent } : {}),
                ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
                // Travels with the job (and its capacity retries) so the worker
                // can hand the cap slot back if the call is never placed.
                ...(capReservationKey ? { dailyCapKey: capReservationKey } : {}),
            }, {
                priority: getCallPriority(sequence.urgency_tier),
            });
            // Slot ownership now rides with the job — the worker releases it
            // if the call is never placed.
            pendingCapReservations.delete(enrollment.id);
            console.log(`[SCHEDULER] Dispatched VAPI call for enrollment ${enrollment.id}${phoneNumberId ? ` (caller ID: ${phoneNumberId})` : ''}${inlineAgent ? ' (blueprint inline)' : ' (legacy)'}`);
            break;
        }
    }

    // 9. variant_id travels in the job payload — the send worker writes it
    // into the execution log when it inserts the row. (The old post-add
    // stamping UPDATE here raced the worker and matched zero rows.)

    // 10. Advance enrollment state (with emotion-aware delay adjustment)
    await advanceToNextStep(enrollment, sequence.id, {
        sentimentTrend: enrollmentEI.sentiment_trend || 'stable',
        isHotLead: enrollmentEI.is_hot_lead || false,
        isAtRisk: enrollmentEI.is_at_risk || false,
        lastEmotion: enrollmentEI.last_emotion || null,
    }, sequence, step);
}

/**
 * Apply an enrollment update, retrying once on failure. Returns true on
 * success. On persistent failure the caller must NOT continue silently —
 * leaving the claim lease in place means the row re-surfaces when it
 * expires, and worker-side send dedup makes the re-claim safe.
 */
async function updateEnrollmentWithRetry(
    enrollmentId: string,
    updates: Record<string, any>,
    label: string
): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        const { error } = await supabase
            .from('sequence_enrollments')
            .update(updates)
            .eq('id', enrollmentId);
        if (!error) return true;
        console.error(`[SCHEDULER] ${label} failed for enrollment ${enrollmentId} (attempt ${attempt}/2):`, error);
    }
    console.error(`[SCHEDULER] ${label} FAILED twice for enrollment ${enrollmentId} — leaving claim lease in place for safe re-claim (worker-side send dedup prevents double-send).`);
    return false;
}

/**
 * Advance enrollment to next step
 * Now supports emotion-based delay adjustment from EI layer
 * and dynamic (JIT) sequence generation.
 *
 * skippedNoSend: the current step was skipped with NOTHING dispatched
 * (skip conditions / invalid contact / missing email). Dynamic sequences
 * must then generate the next step immediately instead of sitting in
 * awaiting_outcome for an outcome that can never arrive.
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
    step?: SequenceStep,
    skippedNoSend: boolean = false
): Promise<void> {
    // ── Dynamic mode: enter awaiting_outcome instead of advancing
    if (sequence?.generation_mode === 'dynamic') {
        const lastChannel = step?.channel || 'sms';
        const isTestEnrollment = enrollment.is_test === true;
        // Test mode: use 30-second timeout instead of hours-long outcome window.
        // Skipped steps sent nothing — time out immediately so the JIT poll
        // generates the next step now instead of idling 24-48h.
        const timeoutMs = skippedNoSend
            ? 0
            : isTestEnrollment
                ? TEST_MODE_DELAY_SECONDS * 1000
                : getOutcomeTimeout(lastChannel as ChannelType) * 60 * 60 * 1000;
        const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

        const ok = await updateEnrollmentWithRetry(enrollment.id, {
            status: 'awaiting_outcome',
            current_step_order: enrollment.current_step_order + 1,
            total_attempts: enrollment.total_attempts + 1,
            outcome_timeout_at: timeoutAt,
            next_step_at: null,
            updated_at: new Date().toISOString(),
        }, 'Dynamic advance (awaiting_outcome)');
        if (!ok) return;

        const timeoutLabel = skippedNoSend
            ? 'immediate (step skipped, nothing sent)'
            : isTestEnrollment ? `${TEST_MODE_DELAY_SECONDS}s (test mode)` : `${getOutcomeTimeout(lastChannel as ChannelType)}h`;
        console.log(`[SCHEDULER] Dynamic enrollment ${enrollment.id} now awaiting outcome (timeout: ${timeoutLabel})`);
        return;
    }

    // ── Static mode: existing behavior
    // Get next step
    const { data: nextStep, error: nextStepErr } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .eq('step_order', enrollment.current_step_order + 2)
        .maybeSingle();

    if (nextStepErr) {
        // Real query error — don't mark completed, don't advance. Leave the
        // claim lease in place; the row re-surfaces when it expires.
        console.error(`[SCHEDULER] Error fetching next step for enrollment ${enrollment.id} — leaving for retry:`, nextStepErr);
        return;
    }

    if (!nextStep) {
        // Sequence complete
        const ok = await updateEnrollmentWithRetry(enrollment.id, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }, 'Completion');
        if (ok) console.log(`[SCHEDULER] Enrollment ${enrollment.id} completed`);
        return;
    }

    // Calculate next step time with emotion-based delay adjustment
    // DB column is delay_minutes (per type-b-schema.sql); convert to seconds for scheduling math.
    const baseDelaySeconds = (nextStep.delay_minutes ?? 0) * 60;
    let adjustedDelaySeconds = baseDelaySeconds;

    // Test mode: compress all delays to 30 seconds
    const isTestEnrollment = enrollment.is_test === true;
    if (isTestEnrollment) {
        adjustedDelaySeconds = TEST_MODE_DELAY_SECONDS;
        console.log(`[SCHEDULER] Test mode: delay compressed ${baseDelaySeconds}s → ${adjustedDelaySeconds}s for enrollment ${enrollment.id}`);
    } else if (emotionalState) {
        const multiplier = getEmotionBasedDelayMultiplier({
            sentimentTrend: emotionalState.sentimentTrend,
            isHotLead: emotionalState.isHotLead,
            isAtRisk: emotionalState.isAtRisk,
            lastEmotion: emotionalState.lastEmotion,
        });

        if (multiplier !== 1.0) {
            adjustedDelaySeconds = Math.round(baseDelaySeconds * multiplier);
            console.log(`[SCHEDULER] EI delay adjustment: ${baseDelaySeconds}s → ${adjustedDelaySeconds}s (x${multiplier}, trend=${emotionalState.sentimentTrend})`);
        }
    }

    const nextStepAt = addSeconds(new Date(), adjustedDelaySeconds);

    const advanced = await updateEnrollmentWithRetry(enrollment.id, {
        current_step_order: enrollment.current_step_order + 1,
        next_step_at: nextStepAt.toISOString(),
        total_attempts: enrollment.total_attempts + 1,
        updated_at: new Date().toISOString(),
    }, 'Advance');
    if (!advanced) return;

    console.log(`[SCHEDULER] Enrollment ${enrollment.id} advanced to step ${enrollment.current_step_order + 2}, next at ${nextStepAt.toISOString()}`);
}

/**
 * Reschedule step to a later time
 */
async function rescheduleStep(enrollmentId: string, nextTime: Date): Promise<void> {
    const { error } = await supabase
        .from('sequence_enrollments')
        .update({
            next_step_at: nextTime.toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
    if (error) {
        console.error(`[SCHEDULER] Failed to reschedule enrollment ${enrollmentId} to ${nextTime.toISOString()}:`, error);
    }
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

    // Escalated leads belong to a human — don't auto-generate. Push the
    // timeout forward 24h so the awaiting_outcome poll doesn't hot-loop on
    // this row, and leave the status untouched for the human to resolve.
    if ((enrollment as any).needs_human_intervention) {
        const deferredUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        console.log(`[SCHEDULER] Dynamic timeout for ${enrollment.id} skipped — needs human intervention; deferring to ${deferredUntil}`);
        const { error: deferErr } = await supabase
            .from('sequence_enrollments')
            .update({ outcome_timeout_at: deferredUntil, updated_at: new Date().toISOString() })
            .eq('id', enrollment.id);
        if (deferErr) {
            console.error(`[SCHEDULER] Failed to defer outcome_timeout_at for ${enrollment.id}:`, deferErr);
        }
        return;
    }

    // Atomic claim
    const claimed = await claimEnrollmentForGeneration(enrollment.id);
    if (!claimed) {
        console.log(`[SCHEDULER] Dynamic timeout for ${enrollment.id} already claimed — skipping`);
        return;
    }

    try {
        // Load tenant profile if not joined. tenant_profiles is keyed by
        // client_id; sequence_enrollments.tenant_id stores the same value.
        let tenantProfile = enrollment.tenant_profiles || null;
        if (!tenantProfile) {
            const { data: tp } = await supabase
                .from('tenant_profiles')
                .select('*')
                .eq('client_id', enrollment.tenant_id)
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

            const insertedStep = await insertGeneratedStep({
                sequenceId: sequence.id,
                enrollmentId: enrollment.id,
                stepOrder: newStepOrder,
                result,
                vapiAssistantId: vapiId,
            });

            if (!insertedStep) {
                // Hard failure inserting the generated step — do NOT activate,
                // or the scheduler would dispatch whatever row sits at that
                // step_order (possibly another lead's content). Revert so the
                // timeout path can retry.
                console.error(`[SCHEDULER] insertGeneratedStep returned null for enrollment ${enrollment.id} (step ${newStepOrder}) — reverting to awaiting_outcome`);
                // Push the timeout forward — leaving it in the past would
                // re-claim this enrollment (and re-pay the LLM call) every
                // 5s tick while the failure persists.
                const { error: revertErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        status: 'awaiting_outcome',
                        // Clamped for test enrollments — a 15min park on a
                        // transient LLM failure makes a test look dead.
                        outcome_timeout_at: new Date(
                            Date.now() + clampTestDelayMs(15 * 60 * 1000, enrollment.is_test === true)
                        ).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollment.id);
                if (revertErr) {
                    console.error(`[SCHEDULER] Failed to revert enrollment ${enrollment.id} to awaiting_outcome:`, revertErr);
                }
                return;
            }

            await activateEnrollmentForNextStep(
                enrollment.id,
                result.step.delay_seconds || 0,
                enrollment.current_step_order, // current_step_order stays — scheduler will pick up newStepOrder
                enrollment.is_test === true
            );
        } else {
            if (result.end_reason === 'generation_failed') {
                // Transient LLM failure (empty/invalid response) — retry via
                // the timeout poll instead of permanently ending the sequence.
                console.error(`[SCHEDULER] Generation failed for enrollment ${enrollment.id} — retrying in 15min`);
                const { error: retryErr } = await supabase
                    .from('sequence_enrollments')
                    .update({
                        status: 'awaiting_outcome',
                        // Clamped for test enrollments — a 15min park on a
                        // transient LLM failure makes a test look dead.
                        outcome_timeout_at: new Date(
                            Date.now() + clampTestDelayMs(15 * 60 * 1000, enrollment.is_test === true)
                        ).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollment.id);
                if (retryErr) {
                    console.error(`[SCHEDULER] Failed to schedule generation retry for ${enrollment.id}:`, retryErr);
                }
                return;
            }
            await endDynamicSequence(enrollment.id, result.end_reason || 'ai_decided', result.reasoning);
        }
    } catch (error) {
        console.error(`[SCHEDULER] Dynamic timeout handling failed for ${enrollment.id}:`, error);
        // Revert to awaiting_outcome so it can retry — with the timeout
        // pushed forward, or the 5s poll re-claims it (and re-pays the
        // LLM call) immediately for as long as the failure persists.
        const { error: revertErr } = await supabase
            .from('sequence_enrollments')
            .update({
                status: 'awaiting_outcome',
                outcome_timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);
        if (revertErr) {
            console.error(`[SCHEDULER] Failed to revert enrollment ${enrollment.id} to awaiting_outcome:`, revertErr);
        }
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
                } finally {
                    // A throw between reserving a cap slot and dispatching
                    // must hand the slot back, or failed enrollments silently
                    // burn the day's cap on every retry.
                    const leakedKey = pendingCapReservations.get(ctx.enrollment.id);
                    if (leakedKey) {
                        await releaseDailyCall(leakedKey);
                        pendingCapReservations.delete(ctx.enrollment.id);
                    }
                }
            }
        }

        // ── Dynamic sequence timeout polling
        // Same FK-hint pitfall as fetchDueEnrollments — sequence_enrollments
        // has no FK to tenant_profiles. handleDynamicTimeout loads the
        // profile itself via client_id (see line 900 area) so we just
        // skip it from the embed.
        const { data: timedOutEnrollments } = await supabase
            .from('sequence_enrollments')
            .select('*, sequences(*), contacts(*)')
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
let shuttingDown = false;
let inFlightTick: Promise<void> | null = null;

async function start(): Promise<void> {
    console.log('[SCHEDULER] Starting scheduler worker...');
    console.log(`[SCHEDULER] Poll interval: ${POLL_INTERVAL_MS}ms, Batch size: ${BATCH_SIZE}`);

    // Recursive setTimeout (not setInterval) so a slow tick can never
    // overlap itself — the next tick is only scheduled after this one ends.
    const loop = async () => {
        if (shuttingDown) return;
        inFlightTick = tick();
        try {
            await inFlightTick;
        } catch (err) {
            console.error('[SCHEDULER] Unhandled tick error:', err);
        } finally {
            inFlightTick = null;
            if (!shuttingDown) setTimeout(loop, POLL_INTERVAL_MS);
        }
    };
    void loop();

    console.log('[SCHEDULER] Scheduler running');
}

// Handle graceful shutdown: stop scheduling new ticks, drain the in-flight
// tick (so a half-dispatched batch finishes its advances), close
// connections, then exit. Exiting mid-tick on every deploy left enrollments
// dispatched-but-not-advanced (review C5).
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SCHEDULER] Received ${signal}, draining in-flight tick before exit...`);

    if (inFlightTick) {
        try {
            await inFlightTick;
        } catch (err) {
            console.error('[SCHEDULER] In-flight tick errored during shutdown:', err);
        }
    }

    try {
        await closeConnections();
    } catch (err) {
        console.error('[SCHEDULER] Error closing connections during shutdown:', err);
    }

    console.log('[SCHEDULER] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

process.on('SIGINT', () => { void shutdown('SIGINT'); });

// Start the scheduler
start().catch((error) => {
    console.error('[SCHEDULER] Fatal error:', error);
    process.exit(1);
});
