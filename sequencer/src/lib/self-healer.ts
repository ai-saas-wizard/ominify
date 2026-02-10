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
import type {
    FailureType,
    HealingAction,
    HealingActionType,
    FailureContext,
    FailureRecord,
    ChannelType,
    SmsContent,
    Contact,
    SequenceEnrollment,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Failure Diagnosis — the decision tree
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze the failure and decide the best healing action.
 */
export function diagnoseFailure(ctx: FailureContext): HealingAction {
    const { failureType, failureHistory, contact, enrollment } = ctx;
    const channelOverrides = (enrollment as any).channel_overrides || {};

    // Count failures by type / channel
    const smsFailures = failureHistory.filter(f =>
        f.failure_type === 'sms_undelivered' || f.failure_type === 'sms_failed'
    ).length;
    const callNoAnswers = failureHistory.filter(f =>
        f.failure_type === 'call_no_answer'
    ).length;
    const emailBounces = failureHistory.filter(f =>
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
            // Send an immediate SMS as a fallback
            const smsContent = action.details.new_content as SmsContent;
            const firstName = contact.first_name || contact.name?.split(' ')[0] || '';
            const body = smsContent.body.replace(/\{\{first_name\}\}/g, firstName);

            await smsQueue.add('sms:send', {
                tenantId: (enrollment as any).tenant_id || clientId,
                contactPhone: contact.phone,
                body,
                enrollmentId,
                stepId,
            });
            console.log(`[HEALER] Injected fallback SMS for enrollment ${enrollmentId}`);
            break;
        }

        case 'extend_delay': {
            // Reschedule the current step with an extended delay
            const delaySeconds = action.details.delay_seconds || 300;
            const nextTime = new Date(Date.now() + delaySeconds * 1000);

            await supabase
                .from('sequence_enrollments')
                .update({
                    next_step_at: nextTime.toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);

            // Decrement step so it re-tries the current step
            await supabase
                .from('sequence_enrollments')
                .update({
                    current_step_order: enrollment.current_step_order - 1,
                })
                .eq('id', enrollmentId);

            console.log(`[HEALER] Rescheduled step for enrollment ${enrollmentId} in ${delaySeconds}s`);
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
                // Re-dispatch with alternative phone
                await smsQueue.add('sms:send', {
                    tenantId: clientId,
                    contactPhone: action.details.new_phone,
                    body: (step.content as SmsContent).body || '',
                    enrollmentId,
                    stepId,
                });
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
 * Dispatch a step to an alternate channel.
 * Converts content when switching (e.g., SMS body → email body).
 */
async function dispatchToAlternateChannel(
    newChannel: ChannelType,
    ctx: FailureContext,
): Promise<void> {
    const { enrollmentId, stepId, contact, enrollment, step, clientId } = ctx;
    const tenantId = (enrollment as any).tenant_id || clientId;

    switch (newChannel) {
        case 'sms': {
            const body = extractTextContent(step.content, step.channel);
            await smsQueue.add('sms:send', {
                tenantId,
                contactPhone: contact.phone,
                body: body.substring(0, 1600), // SMS limit
                enrollmentId,
                stepId,
            });
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
            });
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
            }, {
                priority: 5,
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
    const { data } = await supabase
        .from('healing_log')
        .select('failure_type, healing_action, created_at, step_id')
        .eq('enrollment_id', enrollmentId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (!data) return [];

    // Also pull step info for step_order
    return data.map((row: any) => ({
        channel: mapFailureToChannel(row.failure_type),
        failure_type: row.failure_type,
        step_order: 0, // Will be populated if needed
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
    try {
        await supabase.from('healing_log').insert({
            enrollment_id: ctx.enrollmentId,
            step_id: ctx.stepId,
            client_id: ctx.clientId,
            failure_type: ctx.failureType,
            failure_details: ctx.errorDetails,
            healing_action: action.type,
            healing_details: action.details,
        });
    } catch (err) {
        console.error('[HEALER] Error recording healing action:', err);
    }
}

/**
 * Append a healing action to the enrollment's healing_actions_taken array.
 */
async function appendHealingToEnrollment(
    enrollmentId: string,
    healingEntry: any,
): Promise<void> {
    try {
        const { data } = await supabase
            .from('sequence_enrollments')
            .select('healing_actions_taken')
            .eq('id', enrollmentId)
            .single();

        const existing = (data?.healing_actions_taken as any[]) || [];
        existing.push(healingEntry);

        await supabase
            .from('sequence_enrollments')
            .update({
                healing_actions_taken: existing,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);
    } catch (err) {
        console.error('[HEALER] Error appending healing to enrollment:', err);
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

    try {
        const { data } = await supabase
            .from('sequence_enrollments')
            .select('failed_channels')
            .eq('id', enrollmentId)
            .single();

        const failedChannels = (data?.failed_channels as string[]) || [];
        if (!failedChannels.includes(channel)) {
            failedChannels.push(channel);
            await supabase
                .from('sequence_enrollments')
                .update({
                    failed_channels: failedChannels,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollmentId);
        }
    } catch (err) {
        console.error('[HEALER] Error tracking failed channel:', err);
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
): Promise<HealingAction | null> {
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
    switch (channel) {
        case 'sms': {
            if (!(contact as any).phone_valid && (contact as any).phone_valid !== undefined) {
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
            if (!(contact as any).email_valid && (contact as any).email_valid !== undefined) {
                return { valid: false, reason: 'Email marked invalid', failureType: 'invalid_email' };
            }
            if (!contact.email) {
                return { valid: false, reason: 'No email address', failureType: 'no_contact_method' };
            }
            return { valid: true };
        }

        case 'voice': {
            if (!(contact as any).phone_valid && (contact as any).phone_valid !== undefined) {
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
