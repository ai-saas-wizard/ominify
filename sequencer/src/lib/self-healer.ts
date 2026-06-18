/**
 * Self-Healing Sequences (Phase 4)
 *
 * When a step fails (SMS undelivered, email bounced, call no-answer),
 * the system intelligently adapts: switches channels, finds alternative
 * contact methods, re-orders remaining steps, and recovers gracefully.
 *
 * Decision tree for each failure type:
 *
 * SMS_UNDELIVERED / SMS_FAILED:
 *   1st failure → retry once after 5 min
 *   2+ SMS failures → check if phone is landline → switch to email
 *   No email → mark enrollment, notify tenant
 *
 * EMAIL_BOUNCED:
 *   Hard bounce → mark email invalid, switch to SMS
 *   Soft bounce → retry after 1 hour
 *
 * CALL_NO_ANSWER:
 *   1st → inject immediate SMS ("just tried calling...")
 *   2+ → extend delay, try different time of day
 *   3+ → switch remaining voice steps to SMS/email
 *
 * CALL_BUSY:
 *   Re-queue with 15 min delay
 *
 * CALL_FAILED / CAPACITY_EXHAUSTED:
 *   Send SMS immediately as fallback, re-queue call with longer delay
 *
 * INVALID_NUMBER:
 *   Skip all phone-based steps, switch entirely to email
 *
 * LANDLINE_DETECTED:
 *   Switch all SMS steps to voice/email for this enrollment
 */

import { supabase } from './db.js';
import { smsQueue, emailQueue, vapiQueue } from './redis.js';
import { isTCPACompliant, getNextBusinessHoursStart } from './compliance.js';
import { isContactOptedOut } from './opt-out.js';
import { claimOnce } from './idempotency.js';
import { createNotification } from './emotional-intelligence.js';
import type {
    FailureType,
    HealingAction,
    HealingActionType,
    FailureContext,
    FailureRecord,
    ChannelType,
    SmsContent,
    VoiceContent,
    Contact,
    SequenceEnrollment,
} from './types.js';

// Global cap on healing actions per enrollment — past this we escalate to a
// human instead of looping through automated recovery forever.
const MAX_HEALING_ACTIONS = 5;

// Cap on call_busy → extend_delay retries per enrollment+step — past this we
// mark the step failed and let the sequence advance (previously retried every
// 15 minutes forever).
const MAX_BUSY_EXTENDS = 3;

/**
 * Returned by handleFailure when the enrollment hit the global healing cap.
 * The scheduler must treat this as no-dispatch (nothing was sent).
 */
export interface MaxHealingReachedAction {
    type: 'max_healing_reached';
    details: { reason: string };
}

// ═══════════════════════════════════════════════════════════════════
// Failure Diagnosis — the decision tree
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze the failure and decide the best healing action.
 */
export function diagnoseFailure(ctx: FailureContext): HealingAction {
    const { failureType, failureHistory, contact, enrollment, step } = ctx;
    const channelOverrides = (enrollment as any).channel_overrides || {};

    // Count failures by type, scoped to THIS step. Failure history used to be
    // counted enrollment-globally (step_order was hardcoded 0), so unrelated
    // failures on earlier steps escalated later steps prematurely.
    const stepFailures = failureHistory.filter(f => f.step_order === step.step_order);
    const smsFailures = stepFailures.filter(f =>
        f.failure_type === 'sms_undelivered' || f.failure_type === 'sms_failed'
    ).length;
    const callNoAnswers = stepFailures.filter(f =>
        f.failure_type === 'call_no_answer'
    ).length;
    const emailBounces = stepFailures.filter(f =>
        f.failure_type === 'email_bounced'
    ).length;

    switch (failureType) {
        // ─── SMS FAILURES ───────────────────────────────────────────
        case 'sms_undelivered':
        case 'sms_failed': {
            if (smsFailures === 0) {
                // First SMS failure → retry after 5 min
                return {
                    type: 'extend_delay',
                    details: {
                        delay_seconds: 300,
                        reason: 'First SMS delivery failure — retrying in 5 minutes',
                    },
                };
            }

            // Check if phone is landline (can't receive SMS)
            if ((contact as any).phone_type === 'landline') {
                if (contact.email) {
                    return {
                        type: 'override_channel',
                        details: {
                            new_channel: 'email',
                            reason: 'Phone is landline — switching all SMS steps to email for this enrollment',
                        },
                    };
                }
                return {
                    type: 'switch_channel',
                    details: {
                        new_channel: 'voice',
                        reason: 'Phone is landline with no email — switching this step to voice call',
                    },
                };
            }

            // Multiple SMS failures + email available → switch to email
            if (smsFailures >= 1 && contact.email) {
                return {
                    type: 'switch_channel',
                    details: {
                        new_channel: 'email',
                        reason: `${smsFailures + 1} SMS delivery failures — switching this step to email`,
                    },
                };
            }

            // Multiple SMS failures + no email → try voice as last resort
            if (smsFailures >= 2) {
                return {
                    type: 'switch_channel',
                    details: {
                        new_channel: 'voice',
                        reason: `${smsFailures + 1} SMS failures, no email — attempting voice call instead`,
                    },
                };
            }

            // Default: retry with delay
            return {
                type: 'extend_delay',
                details: {
                    delay_seconds: 600,
                    reason: 'SMS delivery failed — retrying in 10 minutes',
                },
            };
        }

        // ─── EMAIL FAILURES ─────────────────────────────────────────
        case 'email_bounced': {
            // Check if hard bounce (permanent) or could be retried
            if (emailBounces >= 1) {
                // Mark email invalid and switch to SMS
                return {
                    type: 'mark_invalid',
                    details: {
                        reason: 'Email hard bounced — marking invalid and switching to SMS',
                        new_channel: 'sms',
                    },
                };
            }

            // First bounce — retry after 1 hour
            return {
                type: 'extend_delay',
                details: {
                    delay_seconds: 3600,
                    reason: 'Email bounced — retrying in 1 hour',
                },
            };
        }

        // TODO: Wire up email provider spam report webhooks (SendGrid/Mailgun) to trigger this path
        case 'email_spam': {
            // Spam filter hit — switch to SMS, don't retry email
            return {
                type: 'override_channel',
                details: {
                    new_channel: 'sms',
                    reason: 'Email flagged as spam — switching all email steps to SMS for this enrollment',
                },
            };
        }

        // ─── CALL FAILURES ──────────────────────────────────────────
        case 'call_no_answer': {
            if (callNoAnswers === 0) {
                // First no-answer → send immediate follow-up SMS
                return {
                    type: 'inject_fallback_sms',
                    details: {
                        reason: 'First call no-answer — sending follow-up SMS',
                        new_content: {
                            body: `Hey {{first_name}}, I just tried calling you. I'll try again later — in the meantime, feel free to reply to this text if you'd like to chat!`,
                        } as SmsContent,
                    },
                };
            }

            if (callNoAnswers >= 2) {
                // 3+ no-answers → switch remaining voice steps to SMS/email
                const fallbackChannel: ChannelType = contact.email ? 'email' : 'sms';
                return {
                    type: 'override_channel',
                    details: {
                        new_channel: fallbackChannel,
                        reason: `${callNoAnswers + 1} call no-answers — switching remaining voice steps to ${fallbackChannel}`,
                    },
                };
            }

            // 2nd no-answer → extend delay (try at different time)
            return {
                type: 'extend_delay',
                details: {
                    delay_seconds: 7200, // 2 hours
                    reason: 'Second call no-answer — retrying in 2 hours (different time of day)',
                },
            };
        }

        case 'call_busy': {
            // Cap the busy → extend_delay loop: past MAX_BUSY_EXTENDS for
            // this enrollment+step, mark the step failed and let the
            // sequence advance instead of retrying every 15 min forever.
            const busyExtends = (((enrollment as any).healing_actions_taken as any[]) || []).filter(h =>
                h?.failure_type === 'call_busy' &&
                h?.type === 'extend_delay' &&
                h?.step_order === step.step_order
            ).length;

            if (busyExtends >= MAX_BUSY_EXTENDS) {
                return {
                    type: 'skip_and_advance',
                    details: {
                        reason: `Call busy ${busyExtends + 1} times on step ${step.step_order} — giving up on this step and advancing`,
                    },
                };
            }

            return {
                type: 'extend_delay',
                details: {
                    delay_seconds: 900, // 15 min
                    reason: 'Call busy — retrying in 15 minutes',
                },
            };
        }

        case 'call_failed':
        case 'capacity_exhausted': {
            // Send SMS fallback immediately + re-queue call with delay
            return {
                type: 'inject_fallback_sms',
                details: {
                    delay_seconds: 3600, // Re-queue call for 1 hour later
                    reason: failureType === 'capacity_exhausted'
                        ? 'Call capacity exhausted — sending SMS fallback'
                        : 'Call failed — sending SMS fallback',
                    new_content: {
                        body: `Hi {{first_name}}, I tried to give you a call but couldn't connect. Would you prefer a quick text conversation instead? Just reply here!`,
                    } as SmsContent,
                },
            };
        }

        // ─── CONTACT VALIDITY FAILURES ──────────────────────────────
        case 'invalid_number': {
            if (contact.email) {
                return {
                    type: 'override_channel',
                    details: {
                        new_channel: 'email',
                        reason: 'Invalid phone number — switching all phone steps to email',
                    },
                };
            }
            return {
                type: 'end_sequence',
                details: {
                    reason: 'Invalid phone number and no email — ending sequence (no contact method)',
                },
            };
        }

        case 'landline_detected': {
            // Landlines can receive voice but not SMS
            return {
                type: 'override_channel',
                details: {
                    new_channel: contact.email ? 'email' : 'voice',
                    reason: `Landline detected — switching SMS steps to ${contact.email ? 'email' : 'voice'}`,
                },
            };
        }

        case 'invalid_email': {
            return {
                type: 'mark_invalid',
                details: {
                    reason: 'Invalid email — marking invalid and switching to SMS',
                    new_channel: 'sms',
                },
            };
        }

        case 'no_contact_method': {
            return {
                type: 'end_sequence',
                details: {
                    reason: 'No valid contact method available — ending sequence',
                },
            };
        }

        default:
            return {
                type: 'skip_and_advance',
                details: { reason: `Unknown failure type: ${failureType}` },
            };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Healing Execution — carry out the healing action
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute the healing action and record it in the audit log.
 */
export async function executeHealingAction(
    action: HealingAction,
    ctx: FailureContext,
): Promise<void> {
    const { enrollmentId, stepId, clientId, contactId, contact, enrollment, step } = ctx;

    console.log(`[HEALER] Executing ${action.type}: ${action.details.reason}`);

    switch (action.type) {
        case 'switch_channel': {
            // Dispatch this specific step to a different channel
            const newChannel = action.details.new_channel!;
            await dispatchToAlternateChannel(newChannel, ctx);
            break;
        }

        case 'override_channel': {
            // Set a permanent channel override for this enrollment
            const newChannel = action.details.new_channel!;
            const overrides = (enrollment as any).channel_overrides || {};
            overrides[step.channel] = newChannel;

            await supabase
                .from('sequence_enrollments')
                .update({
                    channel_overrides: overrides,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);

            // Also dispatch current step to the new channel
            await dispatchToAlternateChannel(newChannel, ctx);
            console.log(`[HEALER] Channel override set: ${step.channel} → ${newChannel} for enrollment ${enrollmentId}`);
            break;
        }

        case 'inject_fallback_sms': {
            // Send an immediate SMS as a fallback (gated on opt-out + TCPA)
            const gate = await getHealingDispatchGate(ctx);
            if (!gate.allowed) {
                console.log(`[HEALER] Skipping fallback SMS for enrollment ${enrollmentId}: ${gate.reason}`);
                break;
            }

            const smsContent = action.details.new_content as SmsContent;
            const firstName = contact.first_name || contact.name?.split(' ')[0] || '';
            const body = smsContent.body.replace(/\{\{first_name\}\}/g, firstName);

            await smsQueue.add('sms:send', {
                tenantId: (enrollment as any).tenant_id || clientId,
                contactPhone: contact.phone,
                body,
                enrollmentId,
                stepId,
                dedupKey: healingDedupKey(ctx),
            }, gate.delayMs > 0 ? { delay: gate.delayMs } : {});
            console.log(`[HEALER] Injected fallback SMS for enrollment ${enrollmentId}${gate.delayMs > 0 ? ` (delayed ${Math.round(gate.delayMs / 1000)}s for TCPA window)` : ''}`);

            // Re-queue the original voice call with the requested delay, as
            // the decision-tree header promises. Previously the call was
            // silently dropped and only the SMS went out.
            if (action.details.delay_seconds && step.channel === 'voice') {
                const callDelayMs = Math.max(action.details.delay_seconds * 1000, gate.delayMs);
                await vapiQueue.add('vapi:call', {
                    tenantId: (enrollment as any).tenant_id || clientId,
                    contactPhone: contact.phone,
                    assistantConfig: step.content as VoiceContent,
                    enrollmentId,
                    stepId,
                    urgencyPriority: 5,
                    // Distinct from the SMS dedup key — this is a second,
                    // separate send from the same healing action.
                    dedupKey: `${healingDedupKey(ctx)}:requeue`,
                }, { delay: callDelayMs, priority: 5 });
                console.log(`[HEALER] Re-queued voice call for enrollment ${enrollmentId} in ${Math.round(callDelayMs / 1000)}s`);
            }
            break;
        }

        case 'extend_delay': {
            // Reschedule the current step with an extended delay. Combine the
            // next_step_at bump and the step decrement into a single UPDATE so
            // the scheduler can't observe a half-applied state in between.
            const delaySeconds = action.details.delay_seconds || 300;
            const nextTime = new Date(Date.now() + delaySeconds * 1000);

            // Guarded CAS: only roll back if current_step_order is still the
            // value we read — two concurrent failure events for the same step
            // must not double-decrement the pointer.
            const { data: updated, error } = await supabase
                .from('sequence_enrollments')
                .update({
                    next_step_at: nextTime.toISOString(),
                    current_step_order: enrollment.current_step_order - 1,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId)
                .eq('current_step_order', enrollment.current_step_order)
                .select('id');

            if (error) {
                console.error('[HEALER] extend_delay update failed:', error);
            } else if (!updated || updated.length === 0) {
                console.log(`[HEALER] extend_delay skipped for enrollment ${enrollmentId} — step order changed concurrently`);
            } else {
                console.log(`[HEALER] Rescheduled step for enrollment ${enrollmentId} in ${delaySeconds}s`);
            }
            break;
        }

        case 'mark_invalid': {
            // Mark the contact's email or phone as invalid
            const updates: Record<string, any> = {};
            if (ctx.failureType === 'email_bounced' || ctx.failureType === 'invalid_email' || ctx.failureType === 'email_spam') {
                updates.email_valid = false;
            }
            if (ctx.failureType === 'invalid_number') {
                updates.phone_valid = false;
            }

            if (Object.keys(updates).length > 0) {
                await supabase
                    .from('contacts')
                    .update(updates)
                    .eq('id', contactId);
            }

            // Also switch channel if specified
            if (action.details.new_channel) {
                const overrides = (enrollment as any).channel_overrides || {};
                overrides[step.channel] = action.details.new_channel;

                await supabase
                    .from('sequence_enrollments')
                    .update({
                        channel_overrides: overrides,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', enrollmentId);

                // Dispatch current step to fallback channel
                await dispatchToAlternateChannel(action.details.new_channel, ctx);
            }
            break;
        }

        case 'skip_and_advance': {
            // Skip the current step and advance to the next
            await advanceEnrollment(enrollmentId, enrollment);
            break;
        }

        case 'end_sequence': {
            // End the sequence for this enrollment
            await supabase
                .from('sequence_enrollments')
                .update({
                    status: 'failed',
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);
            console.log(`[HEALER] Ended sequence for enrollment ${enrollmentId}: ${action.details.reason}`);
            break;
        }

        case 'use_alternative_contact': {
            // Use the alternative phone/email on the contact
            if (action.details.new_phone) {
                const gate = await getHealingDispatchGate(ctx);
                if (!gate.allowed) {
                    console.log(`[HEALER] Skipping alternative-contact SMS for enrollment ${enrollmentId}: ${gate.reason}`);
                    break;
                }
                // Re-dispatch with alternative phone
                await smsQueue.add('sms:send', {
                    tenantId: clientId,
                    contactPhone: action.details.new_phone,
                    body: (step.content as SmsContent).body || '',
                    enrollmentId,
                    stepId,
                    dedupKey: healingDedupKey(ctx),
                }, gate.delayMs > 0 ? { delay: gate.delayMs } : {});
            }
            if (action.details.new_email) {
                // Would dispatch email with alternative address
                // For now, handled via channel override
            }
            break;
        }

        case 'retry_alternative': {
            // Retry with a different approach (e.g., different number)
            await dispatchToAlternateChannel(step.channel, ctx);
            break;
        }
    }

    // Record the healing action in the audit log
    await recordHealingAction(ctx, action);

    // Update enrollment's healing_actions_taken
    await appendHealingToEnrollment(enrollmentId, {
        type: action.type,
        failure_type: ctx.failureType,
        reason: action.details.reason,
        step_order: step.step_order,
        timestamp: new Date().toISOString(),
    });

    // Update failed_channels tracking
    await trackFailedChannel(enrollmentId, step.channel, ctx.failureType);
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Dedup key carried in every healing dispatch payload. Send workers use it
 * for idempotency claims when stepId-based dedup doesn't apply.
 */
function healingDedupKey(ctx: FailureContext): string {
    return `heal:${ctx.enrollmentId}:${ctx.stepId}:${ctx.failureType}`;
}

interface HealingDispatchGate {
    allowed: boolean;
    delayMs: number;
    reason?: string;
}

/**
 * Gate healing dispatches the same way the scheduler gates normal sends:
 * never message an opted-out contact, and never fire outside the TCPA
 * window. Outside the window, the job is queued with a BullMQ delay so it
 * fires at the next business-hours start instead of e.g. 11pm. Previously
 * healing pushed directly onto the queues and bypassed every gate.
 */
async function getHealingDispatchGate(ctx: FailureContext): Promise<HealingDispatchGate> {
    if (isContactOptedOut(ctx.contact)) {
        return { allowed: false, delayMs: 0, reason: 'contact opted out' };
    }

    const { data: profile, error } = await supabase
        .from('tenant_profiles')
        .select('timezone, business_hours')
        .eq('client_id', ctx.clientId)
        .maybeSingle();

    if (error) {
        console.error('[HEALER] Error fetching tenant profile for dispatch gate:', error);
    }

    const timezone = profile?.timezone || 'America/New_York';
    if (!isTCPACompliant(timezone)) {
        const resumeAt = getNextBusinessHoursStart(timezone, profile?.business_hours || null, new Date());
        return { allowed: true, delayMs: Math.max(0, resumeAt.getTime() - Date.now()) };
    }

    return { allowed: true, delayMs: 0 };
}

/**
 * Dispatch a step to an alternate channel.
 * Converts content when switching (e.g., SMS body → email body).
 */
async function dispatchToAlternateChannel(
    newChannel: ChannelType,
    ctx: FailureContext,
): Promise<void> {
    const { enrollmentId, stepId, contact, enrollment, step, clientId } = ctx;
    const tenantId = (enrollment as any).tenant_id || clientId;

    const gate = await getHealingDispatchGate(ctx);
    if (!gate.allowed) {
        console.log(`[HEALER] Skipping ${newChannel} dispatch for enrollment ${enrollmentId}: ${gate.reason}`);
        return;
    }
    const jobOpts = gate.delayMs > 0 ? { delay: gate.delayMs } : {};
    const dedupKey = healingDedupKey(ctx);

    switch (newChannel) {
        case 'sms': {
            const body = extractTextContent(step.content, step.channel);
            await smsQueue.add('sms:send', {
                tenantId,
                contactPhone: contact.phone,
                body: body.substring(0, 1600), // SMS limit
                enrollmentId,
                stepId,
                dedupKey,
            }, jobOpts);
            break;
        }

        case 'email': {
            if (!contact.email) {
                console.log(`[HEALER] Cannot switch to email — no email on contact ${contact.id}`);
                return;
            }
            const textContent = extractTextContent(step.content, step.channel);
            await emailQueue.add('email:send', {
                tenantId,
                contactEmail: contact.email,
                subject: 'Following up',
                bodyHtml: `<p>${textContent}</p>`,
                bodyText: textContent,
                enrollmentId,
                stepId,
                dedupKey,
            }, jobOpts);
            break;
        }

        case 'voice': {
            await vapiQueue.add('vapi:call', {
                tenantId,
                contactPhone: contact.phone,
                assistantConfig: {
                    first_message: `Hi ${contact.first_name || contact.name || 'there'}, I've been trying to reach you. Do you have a moment to chat?`,
                    system_prompt: `You are a friendly follow-up agent. The customer hasn't been reachable via ${step.channel}. Keep it brief and try to schedule a callback.`,
                },
                enrollmentId,
                stepId,
                urgencyPriority: 5,
                dedupKey,
            }, {
                priority: 5,
                ...jobOpts,
            });
            break;
        }
    }
}

/**
 * Extract plain text content from any step content type.
 */
function extractTextContent(
    content: any,
    originalChannel: ChannelType,
): string {
    if (!content) return '';

    // SMS
    if (content.body && typeof content.body === 'string') {
        return content.body;
    }

    // Email
    if (content.body_text) return content.body_text;
    if (content.body_html) {
        // Strip HTML tags for plain text
        return content.body_html.replace(/<[^>]*>/g, '').trim();
    }

    // Voice
    if (content.first_message) return content.first_message;

    return JSON.stringify(content);
}

/**
 * Advance enrollment to the next step.
 */
async function advanceEnrollment(
    enrollmentId: string,
    enrollment: SequenceEnrollment,
): Promise<void> {
    const nextStepAt = new Date(Date.now() + 60 * 1000); // 1 minute from now

    await supabase
        .from('sequence_enrollments')
        .update({
            current_step_order: enrollment.current_step_order + 1,
            next_step_at: nextStepAt.toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
}

// ═══════════════════════════════════════════════════════════════════
// Failure History & Tracking
// ═══════════════════════════════════════════════════════════════════

/**
 * Get failure history for an enrollment.
 */
export async function getFailureHistory(enrollmentId: string): Promise<FailureRecord[]> {
    const { data, error } = await supabase
        .from('healing_log')
        .select('failure_type, healing_action, created_at, step_id')
        .eq('enrollment_id', enrollmentId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[HEALER] Error fetching failure history:', error);
        return [];
    }
    if (!data || data.length === 0) return [];

    // Resolve real step_orders from the logged step_ids. step_order was
    // previously hardcoded to 0, which made failure counts enrollment-global
    // across unrelated steps.
    const stepIds = [...new Set(data.map((r: any) => r.step_id).filter(Boolean))];
    const stepOrderMap = new Map<string, number>();
    if (stepIds.length > 0) {
        const { data: steps, error: stepsErr } = await supabase
            .from('sequence_steps')
            .select('id, step_order')
            .in('id', stepIds);
        if (stepsErr) {
            console.error('[HEALER] Error fetching step orders for failure history:', stepsErr);
        }
        for (const s of steps || []) {
            stepOrderMap.set(s.id, s.step_order);
        }
    }

    return data.map((row: any) => ({
        channel: mapFailureToChannel(row.failure_type),
        failure_type: row.failure_type,
        // -1 = unknown step (no step_id on the log row); never matches a
        // real step_order so it won't inflate per-step failure counts.
        step_order: row.step_id ? (stepOrderMap.get(row.step_id) ?? -1) : -1,
        timestamp: row.created_at,
    }));
}

/**
 * Map failure type to the channel it belongs to.
 */
function mapFailureToChannel(failureType: FailureType): ChannelType {
    if (failureType.startsWith('sms') || failureType === 'invalid_number' || failureType === 'landline_detected') {
        return 'sms';
    }
    if (failureType.startsWith('email') || failureType === 'invalid_email') {
        return 'email';
    }
    return 'voice';
}

/**
 * Record a healing action in the healing_log table.
 */
async function recordHealingAction(
    ctx: FailureContext,
    action: HealingAction,
): Promise<void> {
    // supabase-js never throws — check the returned error.
    const { error } = await supabase.from('healing_log').insert({
        enrollment_id: ctx.enrollmentId,
        step_id: ctx.stepId,
        client_id: ctx.clientId,
        failure_type: ctx.failureType,
        failure_details: ctx.errorDetails,
        healing_action: action.type,
        healing_details: action.details,
    });
    if (error) {
        console.error('[HEALER] Error recording healing action:', error);
    }
}

/**
 * Append a healing action to the enrollment's healing_actions_taken array.
 */
async function appendHealingToEnrollment(
    enrollmentId: string,
    healingEntry: any,
): Promise<void> {
    // Atomic JSONB append (see migration 20260526-sequencer-atomic-helpers.sql).
    // The prior SELECT-push-UPDATE lost entries when two healings raced.
    const { error } = await supabase.rpc('append_healing_to_enrollment', {
        p_enrollment_id: enrollmentId,
        p_healing: healingEntry,
    });
    if (error) {
        console.error('[HEALER] append_healing_to_enrollment failed:', error);
    }
}

/**
 * Track a failed channel on the enrollment.
 */
async function trackFailedChannel(
    enrollmentId: string,
    channel: ChannelType,
    failureType: FailureType,
): Promise<void> {
    // Only track persistent failures (not temporary ones like busy/extend_delay)
    const persistentFailures: FailureType[] = [
        'invalid_number', 'landline_detected', 'invalid_email',
        'email_spam', 'no_contact_method',
    ];

    if (!persistentFailures.includes(failureType)) return;

    // Guarded conditional write (same read-modify-write class the 20260526
    // migration closed elsewhere): the UPDATE only applies if failed_channels
    // is still the value we read, so two concurrent healings can't clobber
    // each other's append. supabase-js never throws — check { error }.
    const { data, error: readErr } = await supabase
        .from('sequence_enrollments')
        .select('failed_channels')
        .eq('id', enrollmentId)
        .single();

    if (readErr) {
        console.error('[HEALER] Error reading failed_channels:', readErr);
        return;
    }

    const prior = data?.failed_channels as string[] | null;
    const failedChannels = prior || [];
    if (failedChannels.includes(channel)) return;

    const updateQuery = supabase
        .from('sequence_enrollments')
        .update({
            failed_channels: [...failedChannels, channel],
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);

    // CAS on the previous value (jsonb equality is semantic, so the
    // serialized form is safe to compare against).
    const { data: updated, error: writeErr } = await (prior == null
        ? updateQuery.is('failed_channels', null)
        : updateQuery.eq('failed_channels', JSON.stringify(prior))
    ).select('id');

    if (writeErr) {
        console.error('[HEALER] Error tracking failed channel:', writeErr);
    } else if (!updated || updated.length === 0) {
        console.warn(`[HEALER] failed_channels changed concurrently for enrollment ${enrollmentId} — '${channel}' not appended this pass`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Public Entry Point — called by event processor and workers
// ═══════════════════════════════════════════════════════════════════

/**
 * Full self-healing flow: diagnose → execute → log.
 *
 * Call this from event-processor or workers when a failure is detected.
 */
export async function handleFailure(
    enrollmentId: string,
    stepId: string,
    failureType: FailureType,
    errorDetails?: any,
): Promise<HealingAction | MaxHealingReachedAction | null> {
    try {
        // Fetch enrollment with contact
        const { data: enrollment, error: enrollErr } = await supabase
            .from('sequence_enrollments')
            .select('*, contacts(*)')
            .eq('id', enrollmentId)
            .single();

        if (enrollErr || !enrollment) {
            console.error(`[HEALER] Could not fetch enrollment ${enrollmentId}:`, enrollErr);
            return null;
        }

        // Global healing cap: an enrollment healed this many times is beyond
        // automated recovery — escalate to a human instead of looping.
        const healingActions = (enrollment.healing_actions_taken as any[]) || [];
        if (healingActions.length >= MAX_HEALING_ACTIONS) {
            console.log(`[HEALER] Enrollment ${enrollmentId} hit the healing cap (${healingActions.length} actions) — escalating`);

            const { error: escErr } = await supabase
                .from('sequence_enrollments')
                .update({
                    needs_human_intervention: true,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);
            if (escErr) {
                console.error('[HEALER] Failed to flag enrollment for human intervention:', escErr);
            }

            // Notify at most once per 24h window per enrollment
            if (await claimOnce(`notif:${enrollmentId}:max_healing_reached`)) {
                await createNotification({
                    clientId: enrollment.client_id || enrollment.tenant_id,
                    enrollmentId,
                    contactId: enrollment.contact_id,
                    type: 'escalation',
                    title: 'Sequence needs attention — automated recovery limit reached',
                    body: `Enrollment failed with ${failureType} after ${healingActions.length} healing attempts. Automated healing has been stopped.`,
                    priority: 'high',
                    metadata: { failure_type: failureType, healing_actions: healingActions.length },
                });
            }

            return {
                type: 'max_healing_reached',
                details: { reason: `Healing cap (${MAX_HEALING_ACTIONS}) reached — escalated to human` },
            };
        }

        // Fetch the step
        const { data: step, error: stepErr } = await supabase
            .from('sequence_steps')
            .select('*')
            .eq('id', stepId)
            .single();

        if (stepErr || !step) {
            console.error(`[HEALER] Could not fetch step ${stepId}:`, stepErr);
            return null;
        }

        // Get failure history
        const failureHistory = await getFailureHistory(enrollmentId);

        // Build context
        const ctx: FailureContext = {
            enrollmentId,
            stepId,
            clientId: enrollment.client_id || enrollment.tenant_id,
            contactId: enrollment.contact_id,
            step: step as any,
            enrollment: enrollment as any,
            contact: enrollment.contacts as any,
            failureType,
            errorDetails,
            failureHistory,
        };

        // Diagnose
        const action = diagnoseFailure(ctx);
        console.log(`[HEALER] Diagnosed ${failureType} → ${action.type}: ${action.details.reason}`);

        // Execute
        await executeHealingAction(action, ctx);

        return action;
    } catch (err) {
        console.error('[HEALER] handleFailure error:', err);
        return null;
    }
}

/**
 * Check if a channel has been overridden for an enrollment.
 * Called by scheduler before dispatching.
 */
export function getChannelOverride(
    enrollment: SequenceEnrollment,
    originalChannel: ChannelType,
): ChannelType | null {
    const overrides = (enrollment as any).channel_overrides as Record<string, string> | undefined;
    if (!overrides) return null;

    const override = overrides[originalChannel];
    if (override && override !== originalChannel) {
        return override as ChannelType;
    }

    return null;
}

/**
 * Check contact validity for a channel.
 * Returns { valid: boolean, reason?: string, failureType?: FailureType }
 */
export function checkContactValidity(
    contact: Contact,
    channel: ChannelType,
): { valid: boolean; reason?: string; failureType?: FailureType } {
    // phone_valid / email_valid are tri-state: NULL/undefined = never
    // checked (treat as VALID); only an explicit false marks the channel
    // invalid. NULL was previously misclassified as invalid_number.
    switch (channel) {
        case 'sms': {
            if ((contact as any).phone_valid === false) {
                return { valid: false, reason: 'Phone marked invalid', failureType: 'invalid_number' };
            }
            if ((contact as any).phone_type === 'landline') {
                return { valid: false, reason: 'Phone is landline', failureType: 'landline_detected' };
            }
            if (!contact.phone) {
                return { valid: false, reason: 'No phone number', failureType: 'no_contact_method' };
            }
            return { valid: true };
        }

        case 'email': {
            if ((contact as any).email_valid === false) {
                return { valid: false, reason: 'Email marked invalid', failureType: 'invalid_email' };
            }
            if (!contact.email) {
                return { valid: false, reason: 'No email address', failureType: 'no_contact_method' };
            }
            return { valid: true };
        }

        case 'voice': {
            if ((contact as any).phone_valid === false) {
                return { valid: false, reason: 'Phone marked invalid', failureType: 'invalid_number' };
            }
            if (!contact.phone) {
                return { valid: false, reason: 'No phone number', failureType: 'no_contact_method' };
            }
            return { valid: true };
        }

        default:
            return { valid: true };
    }
}
