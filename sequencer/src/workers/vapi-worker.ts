/**
 * VAPI Worker
 * 
 * Processes outbound voice call jobs from the vapi:calls queue.
 * Critical feature: umbrella-aware concurrency management.
 * 
 * Key behaviors:
 * - Acquires slot from umbrella before making call
 * - Re-queues with backoff if at capacity
 * - Uses priority based on urgency tier
 * - Releases slot when call ends (via webhook)
 */

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { supabase } from '../lib/db.js';
import { redisConnection, redis, vapiQueue } from '../lib/redis.js';
import { umbrellaResolver } from '../lib/umbrella-resolver.js';
import { concurrencyManager } from '../lib/concurrency-manager.js';
import { recordInteraction } from '../lib/conversation-memory.js';
import { canPlaceCall } from '../lib/access.js';
import { getCallTimeVariables } from '../lib/call-variables.js';
import { handleFailure } from '../lib/self-healer.js';
import { claimOnce, releaseClaim } from '../lib/idempotency.js';
import { releaseDailyCall, reserveDailyCall, dailyCallCapKey } from '../lib/daily-call-cap.js';
import { createNotification } from '../lib/emotional-intelligence.js';
import { clampTestDelayMs } from '../lib/test-mode.js';
import {
    isTCPACompliant,
    getNextTCPAWindow,
    parseCallingWindow,
    isWithinCallingWindow,
    getNextCallingWindowStart,
    withJitter,
} from '../lib/compliance.js';
import type { VapiJobPayload, VoiceContent, InlineVapiAgent } from '../lib/types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30000; // 30 seconds
// Capacity-skipped leads come back after a random 15-45min so a whole
// exhausted batch doesn't re-arrive on the same instant.
const CAPACITY_REQUEUE_MIN_MS = 15 * 60 * 1000;
const CAPACITY_REQUEUE_MAX_MS = 45 * 60 * 1000;

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
    callDuration?: number;
    callStatus?: string;
    variantId?: string | null;
}): Promise<void> {
    const { error } = await supabase.from('sequence_execution_log').insert({
        enrollment_id: params.enrollmentId,
        // Ad-hoc dispatches can arrive with an empty stepId — the column is a nullable UUID
        step_id: params.stepId || null,
        variant_id: params.variantId ?? null,
        channel: params.channel,
        action: params.action,
        provider_id: params.providerId,
        provider_response: params.providerResponse,
        call_duration_seconds: params.callDuration,
        call_status: params.callStatus,
        executed_at: new Date().toISOString(),
    });

    if (error) {
        // Non-throwing (see sms-worker). Distinct prefix so recording failures
        // (e.g. the call_status column drift) surface instead of hiding.
        console.error(
            `[RECORDING-FAILURE] sequence_execution_log insert failed for enrollment ${params.enrollmentId} (action=${params.action}): ${error.message}${error.code ? ` [${error.code}]` : ''}`
        );
    }
}

/**
 * Build the per-call overrides object that layers on top of the baked-in
 * assistant. When the scheduler assembled an inlineAgent (blueprint with
 * real per-call customizations), we flatten its fields into assistantOverrides
 * so VAPI keeps the assistant's artifactPlan / analysisPlan / endCallPhrases /
 * messagePlan / etc. while still applying the operator's per-call changes.
 *
 * Why not send a transient `assistant`? Transient REPLACES the baked-in,
 * dropping its artifactPlan.structuredOutputIds → no structured-data
 * extraction. Overrides PRESERVE everything we don't explicitly change.
 */
function buildAssistantOverridesFromInline(
    inlineAgent: InlineVapiAgent
): Record<string, any> {
    const overrides: Record<string, any> = {
        firstMessage: inlineAgent.firstMessage,
        model: {
            provider: inlineAgent.model.provider,
            model: inlineAgent.model.model,
            systemPrompt: inlineAgent.model.systemPrompt,
            temperature: inlineAgent.model.temperature,
            tools: inlineAgent.tools,
        },
        voice: {
            provider: inlineAgent.voice.provider,
            voiceId: inlineAgent.voice.voiceId,
        },
    };
    if (inlineAgent.transcriber) {
        overrides.transcriber = {
            provider: inlineAgent.transcriber.provider,
            model: inlineAgent.transcriber.model,
            language: inlineAgent.transcriber.language,
        };
    }
    if (inlineAgent.maxDurationSeconds) {
        overrides.maxDurationSeconds = inlineAgent.maxDurationSeconds;
    }
    if (inlineAgent.backgroundSound) {
        overrides.backgroundSound = inlineAgent.backgroundSound;
    }
    if (inlineAgent.endCallMessage) {
        overrides.endCallMessage = inlineAgent.endCallMessage;
    }
    if (inlineAgent.voicemailMessage) {
        overrides.voicemailMessage = inlineAgent.voicemailMessage;
    }
    if (inlineAgent.voicemailDetection) {
        overrides.voicemailDetection = inlineAgent.voicemailDetection;
    }
    return overrides;
}

/**
 * Hardcoded transient assistant — last-resort fallback when the tenant's
 * voice agent has never been bootstrapped (no vapi_assistant_id stored).
 * Rare in production; new tenants get a real agent during onboarding.
 */
function buildLegacyTransientAssistant(
    assistantConfig: VoiceContent
): Record<string, any> {
    return {
        firstMessage: assistantConfig.first_message,
        model: {
            provider: 'openai',
            model: 'gpt-4',
            systemPrompt: assistantConfig.system_prompt,
        },
        voice: {
            provider: 'playht',
            voiceId: 'jennifer',
        },
        serverMessages: ["status-update", "end-of-call-report"],
        clientMessages: [],
    };
}

/**
 * Make a VAPI call
 *
 * Default path: reference the baked-in assistant by ID and send per-call
 * variation as assistantOverrides (variableValues, optional firstMessage).
 *
 * Inline path is taken only when:
 *   - the scheduler assembled an inlineAgent (blueprint had real overrides)
 *   - or there's no vapi_assistant_id (hardcoded fallback)
 *   - or assistantConfig.system_prompt_overridden is set
 */
async function makeVapiCall(
    vapiApiKey: string,
    phoneNumber: string,
    assistantConfig: VoiceContent,
    tenantId: string,
    umbrellaId: string,
    enrollmentId: string,
    outboundPhoneNumberId?: string,
    inlineAgent?: InlineVapiAgent
): Promise<{ callId: string }> {
    // Resolve currentDate + tenantTimezone for {{currentDate}} /
    // {{tenantTimezone}} interpolation in the assistant's system prompt.
    let callVars: { currentDate: string; tenantTimezone: string } | null = null;
    try {
        callVars = await getCallTimeVariables(tenantId);
    } catch (err) {
        console.warn('[VAPI] Failed to resolve call-time variables, continuing without:', err);
    }

    // Resolve contact-level variables for this enrollment. The outbound RE
    // agent (and any other tenant-shaped agent) reads {{contact_data}} as a
    // JSON blob of everything we know about this seller, plus
    // {{contact_field_legend}} describing what each key means (pulled from the
    // tenant's contact_fields definitions). We also expose top-level
    // {{contact_name}} / {{contact_phone}} / {{contact_email}}.
    let contactVariables: Record<string, string> = {};
    try {
        const { data: enrollmentRow } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .single();

        if (enrollmentRow?.contact_id) {
            const [{ data: contact }, { data: fieldDefs }] = await Promise.all([
                supabase
                    .from('contacts')
                    .select('name, phone, email, custom_fields')
                    .eq('id', enrollmentRow.contact_id)
                    .single(),
                supabase
                    .from('contact_fields')
                    .select('field_key, name, description, field_type')
                    .eq('client_id', tenantId),
            ]);

            if (contact) {
                const customFields =
                    (contact.custom_fields as Record<string, any>) || {};
                const fieldKeys = Object.keys(customFields);

                const defByKey = new Map<
                    string,
                    { name: string; description: string | null; type: string }
                >();
                for (const def of (fieldDefs as any[]) || []) {
                    defByKey.set(def.field_key, {
                        name: def.name,
                        description: def.description,
                        type: def.field_type,
                    });
                }

                const legendLines = fieldKeys.map((k) => {
                    const def = defByKey.get(k);
                    if (!def) return `- ${k}`;
                    const head = def.name
                        ? `${k} (${def.name}${def.type ? `, ${def.type}` : ''})`
                        : k;
                    return def.description
                        ? `- ${head}: ${def.description}`
                        : `- ${head}`;
                });

                contactVariables = {
                    contact_data: JSON.stringify(customFields),
                    contact_field_legend: legendLines.length
                        ? legendLines.join('\n')
                        : '(no custom fields populated for this contact)',
                    contact_name: (contact.name as string) || '',
                    contact_phone: (contact.phone as string) || '',
                    contact_email: (contact.email as string) || '',
                };
            }
        }
    } catch (err) {
        console.warn('[VAPI] Failed to resolve contact variables, continuing without:', err);
    }

    // Single source of truth for assistantOverrides.variableValues, merged
    // from every layer we have. Later spreads win on key collision.
    const baseVariableValues: Record<string, any> = {
        ...(callVars
            ? { currentDate: callVars.currentDate, tenantTimezone: callVars.tenantTimezone }
            : {}),
        ...contactVariables,
        ...(assistantConfig.task_context
            ? { task_context: assistantConfig.task_context }
            : {}),
        ...(assistantConfig.conversation_history
            ? { conversation_history: assistantConfig.conversation_history }
            : {}),
        ...(assistantConfig.tone_directive
            ? { tone_directive: assistantConfig.tone_directive }
            : {}),
        ...(assistantConfig.override_variables ?? {}),
        ...(inlineAgent?.variableValues ?? {}),
    };

    // NOTE: VAPI's /call/phone endpoint doesn't accept serverUrl /
    // serverUrlSecret at the top level — those belong on the assistant's
    // own config (`assistant.server.url`), set at agent-creation time.
    // Also: VAPI requires `phoneNumberId` OR top-level `phoneNumber`. Sending
    // `phoneNumberId: null` is rejected as missing — only attach the field
    // when we actually have a value.
    const requestBody: any = {
        customer: {
            number: phoneNumber,
        },
        metadata: {
            tenantId,
            umbrellaId,
            enrollmentId,
        },
        ...(outboundPhoneNumberId ? { phoneNumberId: outboundPhoneNumberId } : {}),
    };

    const assistantOverrides: Record<string, any> = {};
    if (Object.keys(baseVariableValues).length > 0) {
        assistantOverrides.variableValues = baseVariableValues;
    }

    // Dispatch decision:
    //   - vapi_assistant_id present (the common case): reference baked-in
    //     assistant by ID and layer per-call customizations via
    //     assistantOverrides. This preserves artifactPlan.structuredOutputIds,
    //     analysisPlan, endCallPhrases, messagePlan, etc.
    //   - inlineAgent present: blueprint produced per-call overrides
    //     (firstMessage, systemPrompt, voice, tools, etc.) — flatten into
    //     assistantOverrides instead of replacing the assistant.
    //   - vapi_assistant_id missing: rare unbootstrapped tenant — fall back
    //     to a hardcoded transient assistant (the legacy last-resort path).
    if (assistantConfig.vapi_assistant_id) {
        requestBody.assistantId = assistantConfig.vapi_assistant_id;
        if (inlineAgent) {
            Object.assign(
                assistantOverrides,
                buildAssistantOverridesFromInline(inlineAgent)
            );
        } else if (
            assistantConfig.first_message &&
            !assistantConfig.first_message.includes('[AI-generated at dispatch]') &&
            // Self-healer requeues pass raw step.content that never went
            // through renderTemplate — an unrendered "Hi {{first_name}}"
            // must fall back to the baked-in opener, not be spoken verbatim.
            !assistantConfig.first_message.includes('{{')
        ) {
            // The step (or the scheduler's brief-based generation) authored
            // an explicit opening line — it must win over the assistant's
            // baked-in firstMessage on the assistantId path too. Without
            // this, brief-generated openers for agent-bound sequences are
            // silently discarded. The unrendered wizard placeholder is the
            // one first_message that must never be spoken; dropping it here
            // falls back to the baked-in opener.
            assistantOverrides.firstMessage = assistantConfig.first_message;
        }
    } else {
        requestBody.assistant = buildLegacyTransientAssistant(assistantConfig);
    }

    if (Object.keys(assistantOverrides).length > 0) {
        requestBody.assistantOverrides = assistantOverrides;
    }

    // Greppable dispatch summary. Override keys (excluding variableValues)
    // tell us at-a-glance which fields were customized for this call.
    const overrideKeys = Object.keys(assistantOverrides).filter(
        (k) => k !== 'variableValues'
    );
    const dispatchTarget = requestBody.assistantId
        ? `assistantId=${requestBody.assistantId}`
        : 'transient';
    console.log(
        `[VAPI] Dispatch: ${dispatchTarget}, vars=${
            Object.keys(assistantOverrides.variableValues || {}).length
        }, overrides=[${overrideKeys.join(',')}]`
    );

    const response = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`VAPI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { id: string };
    return { callId: data.id };
}

// After this many re-arm cycles for the same step, stop retrying and flag the
// enrollment for a human — restores the bound the old self-healer path
// (MAX_HEALING_ACTIONS) provided before capacity skips were routed here.
const MAX_STEP_REARMS = 5;

/**
 * Re-arm an enrollment so the scheduler re-dispatches the step this job was
 * dialing. Never infers the step from enrollment state: payload.stepOrder is
 * the authority. Jobs without it (self-healer re-queues, pre-upgrade jobs)
 * get no rollback — guessing re-sends already-delivered touches.
 *
 * Enrollment lifecycle at requeue time (scheduler dispatches, THEN advances):
 *   - advance succeeded, more steps:  status transit, current = stepOrder + 1
 *   - advance succeeded, last step:   status 'completed', current = stepOrder
 *   - advance failed (DB blip):       status transit, current = stepOrder
 *   - JIT generating:                 left alone — rolling back mid-generation
 *     races activateEnrollmentForNextStep's non-CAS write and loses.
 */
async function rearmEnrollmentForRetry(params: {
    enrollmentId: string;
    stepOrder: number | null | undefined;
    retryAt: Date;
    reason: string;
}): Promise<void> {
    const { enrollmentId, stepOrder, reason } = params;

    if (stepOrder == null) {
        console.log(`[VAPI] Not re-arming ${enrollmentId} after ${reason} — job carries no stepOrder (healer/legacy origin)`);
        return;
    }

    const { data: enrollment, error } = await supabase
        .from('sequence_enrollments')
        .select('status, current_step_order, is_test, tenant_id, contact_id')
        .eq('id', enrollmentId)
        .single();

    if (error || !enrollment) {
        console.error(`[VAPI] Cannot re-arm enrollment ${enrollmentId} after ${reason}:`, error);
        return;
    }

    // Bound the retry loop per step. Redis, not the job payload: each re-arm
    // goes back through the scheduler, which stamps a fresh payload.
    try {
        const attemptKey = `seq:rearm:${enrollmentId}:${stepOrder}`;
        const attempts = await redis.incr(attemptKey);
        if (attempts === 1) await redis.expire(attemptKey, 24 * 60 * 60);
        if (attempts > MAX_STEP_REARMS) {
            console.error(`[VAPI] Step ${stepOrder} of enrollment ${enrollmentId} re-armed ${MAX_STEP_REARMS}+ times (${reason}) — escalating to human`);
            await supabase
                .from('sequence_enrollments')
                .update({ needs_human_intervention: true, updated_at: new Date().toISOString() })
                .eq('id', enrollmentId);
            await createNotification({
                clientId: enrollment.tenant_id,
                enrollmentId,
                contactId: enrollment.contact_id,
                type: 'escalation',
                title: 'Repeated call dispatch failures',
                body: `A sequence call could not be placed after ${MAX_STEP_REARMS} attempts (${reason}). The enrollment is paused for review.`,
                priority: 'high',
                metadata: { step_order: stepOrder, reason },
            });
            return;
        }
    } catch (err) {
        console.error(`[VAPI] Re-arm bound check failed for ${enrollmentId} (continuing):`, err);
    }

    const retryAt = enrollment.is_test
        ? new Date(Date.now() + clampTestDelayMs(params.retryAt.getTime() - Date.now(), true))
        : params.retryAt;
    const now = new Date().toISOString();
    const current = enrollment.current_step_order;

    if (['active', 'awaiting_outcome'].includes(enrollment.status) && current === stepOrder + 1) {
        // Normal case: advance already moved past the undialed step — roll back.
        const { data: updated, error: updateErr } = await supabase
            .from('sequence_enrollments')
            .update({
                status: 'active',
                current_step_order: stepOrder,
                next_step_at: retryAt.toISOString(),
                outcome_timeout_at: null,
                updated_at: now,
            })
            .eq('id', enrollmentId)
            .eq('current_step_order', stepOrder + 1)
            .eq('status', enrollment.status)
            .select('id');
        if (updateErr || !updated?.length) {
            console.log(`[VAPI] Re-arm rollback for ${enrollmentId} step ${stepOrder} skipped (moved concurrently)`, updateErr ?? '');
        } else {
            console.log(`[VAPI] Enrollment ${enrollmentId} re-armed for step ${stepOrder} at ${retryAt.toISOString()} (${reason})`);
        }
    } else if (enrollment.status === 'completed' && current === stepOrder) {
        // Last static step: advance closed the enrollment before the dial
        // happened. Reopen it so the final call isn't silently dropped.
        const { data: updated, error: updateErr } = await supabase
            .from('sequence_enrollments')
            .update({
                status: 'active',
                completed_at: null,
                next_step_at: retryAt.toISOString(),
                updated_at: now,
            })
            .eq('id', enrollmentId)
            .eq('status', 'completed')
            .eq('current_step_order', stepOrder)
            .select('id');
        if (!updateErr && updated?.length) {
            console.log(`[VAPI] Reopened completed enrollment ${enrollmentId} to retry final step ${stepOrder} (${reason})`);
        }
    } else if (['active', 'awaiting_outcome'].includes(enrollment.status) && current === stepOrder) {
        // Advance never landed — the pointer is still on our step. Only push
        // the schedule; decrementing here would re-arm the PREVIOUS step.
        const { error: updateErr } = await supabase
            .from('sequence_enrollments')
            .update({ status: 'active', next_step_at: retryAt.toISOString(), outcome_timeout_at: null, updated_at: now })
            .eq('id', enrollmentId)
            .eq('current_step_order', stepOrder);
        if (!updateErr) {
            console.log(`[VAPI] Enrollment ${enrollmentId} rescheduled for step ${stepOrder} at ${retryAt.toISOString()} (${reason}, advance had not landed)`);
        }
    } else {
        // Terminal / operator-owned / mid-generation states are left alone —
        // a call we never placed must not resurrect or corrupt them.
        console.log(`[VAPI] Not re-arming ${enrollmentId} after ${reason} — status=${enrollment.status}, current=${current}, stepOrder=${stepOrder}`);
    }
}

function capacityRetryAt(): Date {
    return new Date(
        Date.now() +
        CAPACITY_REQUEUE_MIN_MS +
        Math.floor(Math.random() * (CAPACITY_REQUEUE_MAX_MS - CAPACITY_REQUEUE_MIN_MS))
    );
}

/**
 * Dial-time compliance gate. The scheduler cleared this job at ENQUEUE time,
 * but limiter backpressure and capacity retries can hold it long past that —
 * even across a tenant-local midnight. Re-check TCPA plus the sequence's
 * calling window / daily cap right before dialing. Also the ONLY gate for
 * voice jobs that never passed the scheduler's (self-healer dispatches,
 * sms→voice channel overrides) — they carry no dailyCapKey, so the cap is
 * reserved here. Fails open on lookup errors: the dial proceeds rather than
 * the fleet stalling on a DB blip.
 *
 * On ok, returns the cap key now backing this dial (it changes when the local
 * day rolled over since enqueue). On defer, all cap bookkeeping is already
 * settled — the caller only re-arms the enrollment and logs.
 */
async function checkDialTimeGate(
    data: VapiJobPayload
): Promise<{ ok: true; capKey: string | null } | { ok: false; deferTo: Date; reason: string }> {
    const payloadCapKey = data.dailyCapKey ?? null;
    try {
        const { tenantTimezone: tz } = await getCallTimeVariables(data.tenantId);

        if (!isTCPACompliant(tz)) {
            await releaseDailyCall(payloadCapKey);
            return { ok: false, deferTo: withJitter(getNextTCPAWindow(tz)), reason: 'outside_tcpa_at_dial' };
        }

        if (!data.sequenceId) return { ok: true, capKey: payloadCapKey };

        const { data: sequence } = await supabase
            .from('sequences')
            .select('daily_call_cap, calling_window_start, calling_window_end')
            .eq('id', data.sequenceId)
            .maybeSingle();
        if (!sequence) return { ok: true, capKey: payloadCapKey };

        const window = parseCallingWindow(sequence.calling_window_start, sequence.calling_window_end);
        if (window && !isWithinCallingWindow(tz, window)) {
            await releaseDailyCall(payloadCapKey);
            return {
                ok: false,
                deferTo: withJitter(getNextCallingWindowStart(tz, window), window.durationMinutes),
                reason: 'outside_window_at_dial',
            };
        }

        const cap = sequence.daily_call_cap;
        if (cap && cap > 0) {
            const todayKey = dailyCallCapKey(data.sequenceId, tz);
            if (payloadCapKey !== todayKey) {
                // Either the local day rolled over since the reservation, or this
                // job never went through the scheduler gate. Re-reserve for today.
                await releaseDailyCall(payloadCapKey);
                if (!(await reserveDailyCall(todayKey, cap))) {
                    const deferTo = window
                        ? withJitter(getNextCallingWindowStart(tz, window), window.durationMinutes)
                        : withJitter(getNextTCPAWindow(tz));
                    return { ok: false, deferTo, reason: 'daily_cap_at_dial' };
                }
                return { ok: true, capKey: todayKey };
            }
        }
        return { ok: true, capKey: payloadCapKey };
    } catch (err) {
        console.error(`[VAPI] Dial-time gate error for enrollment ${data.enrollmentId} (failing open):`, err);
        return { ok: true, capKey: payloadCapKey };
    }
}

/**
 * VAPI Worker processor
 */
async function processVapiJob(job: Job<VapiJobPayload>): Promise<{ callId: string; status: string }> {
    const { tenantId, contactPhone, assistantConfig, enrollmentId, stepId, urgencyPriority, retryCount = 0, phoneNumberId, inlineAgent } = job.data;
    // variantId/dedupKey/dailyCapKey are stamped by the scheduler (see lib/types.ts payload contract)
    const { variantId, dedupKey } = job.data;

    console.log(`[VAPI] Processing job ${job.id} for tenant ${tenantId}, phone ${contactPhone}, priority ${urgencyPriority}`);

    // 0a. Dial-time compliance gate (skipped for operator test dials, which
    //     must stay instant). See checkDialTimeGate for why enqueue-time
    //     clearance isn't enough.
    let dailyCapKey = job.data.dailyCapKey ?? null;
    if (!job.data.isTest) {
        const gate = await checkDialTimeGate(job.data);
        // `=== false` (not `!gate.ok`): with strict:false the falsy check
        // doesn't narrow the discriminated union.
        if (gate.ok === false) {
            console.log(`[VAPI] Dial-time gate deferred enrollment ${enrollmentId} (${gate.reason}) to ${gate.deferTo.toISOString()}`);
            await logExecution({
                enrollmentId,
                stepId,
                channel: 'voice',
                action: 'skipped_out_of_window',
                providerId: '',
                providerResponse: { reason: gate.reason, defer_to: gate.deferTo.toISOString() },
                callStatus: 'skipped',
                variantId: variantId ?? null,
            });
            await rearmEnrollmentForRetry({
                enrollmentId,
                stepOrder: job.data.stepOrder,
                retryAt: gate.deferTo,
                reason: gate.reason,
            });
            return { callId: '', status: 'deferred_out_of_window' };
        }
        dailyCapKey = gate.capKey;
    }

    // 0b. Paywall + balance gate. Reject (do not re-queue) if the tenant lacks
    //    access or has zero minutes — the job is a no-op until they resubscribe
    //    or buy a top-up pack.
    const access = await canPlaceCall(tenantId);
    if (access.allowed === false) {
        console.log(`[VAPI] Access denied for tenant ${tenantId}: ${access.reason}`);
        // No dial will happen — give the daily-cap slot back to the sequence.
        await releaseDailyCall(dailyCapKey);
        await logExecution({
            enrollmentId,
            stepId,
            channel: 'voice',
            action: 'skipped_no_access',
            providerId: '',
            providerResponse: { reason: access.reason },
            callStatus: 'access_denied',
            variantId: variantId ?? null,
        });
        return { callId: '', status: 'skipped_no_access' };
    }

    // 1. Resolve umbrella for this tenant
    const umbrella = await umbrellaResolver.getUmbrellaForTenant(tenantId);

    // 2. Try to acquire a concurrency slot (token = enrollmentId, so a lost
    //    call-outcome webhook can be reconciled instead of leaking the slot)
    const { acquired, reason } = await concurrencyManager.tryAcquire(
        umbrella.umbrellaId,
        tenantId,
        umbrella.concurrencyLimit,
        umbrella.tenantCap,
        enrollmentId
    );

    if (!acquired) {
        console.log(`[VAPI] Cannot acquire slot: ${reason}`);

        // Re-queue with backoff
        if (retryCount < MAX_RETRIES) {
            await vapiQueue.add('vapi:call', {
                ...job.data,
                retryCount: retryCount + 1,
            }, {
                delay: RETRY_DELAY_MS * (retryCount + 1),
                priority: urgencyPriority,
            });
            console.log(`[VAPI] Re-queued for retry ${retryCount + 1}`);
        } else {
            // Max retries reached. Capacity is a fleet-wide condition, not a
            // problem with this lead: routing it to the self-healer fired a
            // "I tried to give you a call…" fallback SMS at every skipped
            // lead, which turns a 2,000-lead voice campaign into a 2,000-lead
            // SMS blast. Log it, hand the daily-cap slot back (no dial
            // happened), and re-arm the enrollment for a later attempt — the
            // scheduler's window/cap gates will push it into the next window
            // if that is where it now belongs.
            await logExecution({
                enrollmentId,
                stepId,
                channel: 'voice',
                action: 'skipped_capacity',
                providerId: '',
                providerResponse: { reason, retryCount },
                callStatus: 'capacity_exhausted',
                variantId: variantId ?? null,
            });

            await releaseDailyCall(dailyCapKey);
            await rearmEnrollmentForRetry({
                enrollmentId,
                stepOrder: job.data.stepOrder,
                retryAt: capacityRetryAt(),
                reason: 'capacity_exhausted',
            });
        }

        return { callId: '', status: 'requeued' };
    }

    // Send idempotency (review C5): claim before the VAPI create-call request
    // so a duplicate dispatch cannot double-call the lead. dedupKey wins when
    // present — healing re-queues reuse the original stepId, and keying them
    // by stepId would collide with the already-claimed original send.
    const claimKey = dedupKey || (stepId ? `send:${enrollmentId}:${stepId}` : null);
    if (claimKey && !(await claimOnce(claimKey))) {
        console.log(`[VAPI] duplicate dispatch, skipping (${claimKey})`);
        // Give back the slot we just acquired — no call will be placed
        await concurrencyManager.release(umbrella.umbrellaId, tenantId, enrollmentId);
        // Same for the daily-cap slot this duplicate reserved.
        await releaseDailyCall(dailyCapKey);
        return { callId: '', status: 'duplicate_skipped' };
    }

    // 3. Make the call. The try only wraps the VAPI API request so the slot
    //    is released exactly once: here on API failure (no call exists, so no
    //    webhook will ever release it), or by the call-outcome webhook after
    //    a successful create.
    let result: { callId: string };
    try {
        result = await makeVapiCall(
            umbrella.vapiApiKey,
            contactPhone,
            assistantConfig,
            tenantId,
            umbrella.umbrellaId,
            enrollmentId,
            phoneNumberId,
            inlineAgent
        );
    } catch (error) {
        // Release slot on API error (exactly once — see comment above)
        await concurrencyManager.release(umbrella.umbrellaId, tenantId, enrollmentId);

        // The daily-cap reservation is deliberately NOT released here: this
        // job still has BullMQ attempts left, and the self-healer's
        // 'call_failed' path re-queues the same dial an hour out. The
        // reservation represents an intended dial for today either way, so
        // holding it keeps the cap conservative instead of over-dialing.

        // Release the send claim so a legitimate BullMQ retry can re-place the call
        if (claimKey) {
            await releaseClaim(claimKey);
        }

        if (stepId) {
            const healingAction = await handleFailure(enrollmentId, stepId, 'call_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            console.log(`[VAPI] Healing action for call_failed on ${enrollmentId}: ${healingAction?.type || 'none'}`);
        }

        throw error;
    }

    console.log(`[VAPI] Call initiated: ${result.callId}`);

    // Log execution (initial state)
    await logExecution({
        enrollmentId,
        stepId,
        channel: 'voice',
        action: 'call_initiated',
        providerId: result.callId,
        providerResponse: result,
        callStatus: 'initiated',
        variantId: variantId ?? null,
    });

    // Record interaction for conversation memory (initial - updated on call end by event processor)
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
            channel: 'voice',
            direction: 'outbound',
            outcome: 'delivered',
            providerId: result.callId,
        });

        // Persist the reason for this outbound call onto the contact so
        // that if they call back, the inbound agent can reference it.
        // Priority: step.voice_context > agent.config.outbound_scenario.
        // If both are empty, leave existing values untouched.
        try {
            const { data: stepRow } = await supabase
                .from('sequence_steps')
                .select('voice_context, voice_agent_id')
                .eq('id', stepId)
                .single();

            let reason = (stepRow?.voice_context as string | null)?.trim() || '';
            if (!reason && stepRow?.voice_agent_id) {
                const { data: agentRow } = await supabase
                    .from('agents')
                    .select('config')
                    .eq('id', stepRow.voice_agent_id)
                    .single();
                const scenario = (agentRow?.config as any)?.outbound_scenario;
                if (typeof scenario === 'string') reason = scenario.trim();
            }

            if (reason) {
                await supabase
                    .from('contacts')
                    .update({
                        last_outbound_reason: reason,
                        last_outbound_at: new Date().toISOString(),
                        last_outbound_call_id: result.callId,
                    })
                    .eq('id', enrollment.contact_id);
            }
        } catch (err) {
            console.warn('[VAPI] Failed to persist last_outbound_reason on contact:', err);
        }
    }

    // Note: Concurrency slot will be released by the webhook when call ends
    // DO NOT release here - call is still in progress

    return { callId: result.callId, status: 'initiated' };
}

// Create the worker with priority support
const vapiWorker = new Worker<VapiJobPayload>('vapi-calls', processVapiJob, {
    connection: redisConnection,
    concurrency: 5, // Process multiple jobs, but concurrency is really managed by the manager
    lockDuration: 60000, // 1 minute lock (calls can take time to initiate)
    limiter: {
        // Ceiling on how fast we START calls. concurrency-manager caps how many
        // are LIVE; without this, a bulk enrollment still handed VAPI the whole
        // batch at once and everything past the concurrency limit burned its
        // three capacity retries. (SMS/email workers have had limiters all along.)
        // Guarded parse: `Number('')` is 0 and a typo is NaN — either would
        // silently rate-limit the fleet to zero dials.
        max: (() => {
            const parsed = Number(process.env.VAPI_DISPATCH_PER_MIN);
            return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10;
        })(),
        duration: 60_000,
    },
});

// Event listeners
vapiWorker.on('completed', (job, result) => {
    console.log(`[VAPI] Job ${job.id} completed:`, result);
});

vapiWorker.on('failed', (job, error) => {
    console.error(`[VAPI] Job ${job?.id} failed:`, error.message);
});

vapiWorker.on('error', (error) => {
    console.error('[VAPI] Worker error:', error);
});

// Periodically reclaim concurrency slots whose call-outcome webhook was lost
// (review workers I5) — otherwise a single dropped webhook leaks a slot forever.
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const STALE_SLOT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours — far beyond any real call

let reconcileInFlight = false;
const reconcileTimer = setInterval(async () => {
    if (reconcileInFlight) {
        return; // previous sweep still running
    }
    reconcileInFlight = true;
    try {
        const reclaimed = await concurrencyManager.reconcileStaleSlots(STALE_SLOT_MAX_AGE_MS);
        if (reclaimed > 0) {
            console.log(`[VAPI] Slot reconciliation reclaimed ${reclaimed} stale slot(s)`);
        }
    } catch (err) {
        console.error('[VAPI] Slot reconciliation error:', err);
    } finally {
        reconcileInFlight = false;
    }
}, RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

console.log('[VAPI] VAPI worker started');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[VAPI] Received SIGTERM, closing worker...');
    await vapiWorker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[VAPI] Received SIGINT, closing worker...');
    await vapiWorker.close();
    process.exit(0);
});

export { vapiWorker };
