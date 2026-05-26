/**
 * Dynamic (JIT) Step Generator
 *
 * Generates the next sequence step reactively based on the outcome of the
 * previous step. Uses GPT-4o to decide channel, timing, and content based
 * on the full conversation history and emotional state.
 *
 * Called from:
 * - event-processor.ts (on call/SMS/email outcomes)
 * - scheduler-worker.ts (on outcome timeout)
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import type {
    SequenceEnrollment,
    Sequence,
    SequenceStep,
    Contact,
    TenantProfile,
    ConversationContext,
    OutcomeContext,
    GeneratedStepResult,
    ChannelType,
    SmsContent,
    EmailContent,
    VoiceContent,
} from './types.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Get timeout duration (in hours) to wait for an outcome on a given channel.
 */
export function getOutcomeTimeout(channel: ChannelType): number {
    switch (channel) {
        case 'voice': return 1;   // Call is over quickly — 1h grace for webhook lag
        case 'sms':   return 24;  // Wait 24h for SMS reply
        case 'email': return 48;  // Wait 48h for email reply
        default:      return 24;
    }
}

/**
 * Fetch all executed steps for a sequence enrollment with their outcomes.
 */
export async function getExecutedSteps(
    sequenceId: string,
    enrollmentId: string
): Promise<Array<{
    step_order: number;
    channel: ChannelType;
    content_summary: string;
    outcome: string | null;
    generated_dynamically: boolean;
}>> {
    // Get all steps for this sequence
    const { data: steps } = await supabase
        .from('sequence_steps')
        .select('id, step_order, channel, content, generated_dynamically')
        .eq('sequence_id', sequenceId)
        .order('step_order', { ascending: true });

    if (!steps || steps.length === 0) return [];

    // Get execution log for this enrollment
    const { data: logs } = await supabase
        .from('sequence_execution_log')
        .select('step_id, call_status, sms_status, email_status')
        .eq('enrollment_id', enrollmentId);

    const logMap = new Map((logs || []).map(l => [l.step_id, l]));

    return steps.map(step => {
        const log = logMap.get(step.id);
        let outcome: string | null = null;
        if (log) {
            outcome = step.channel === 'voice'
                ? log.call_status
                : step.channel === 'sms'
                ? log.sms_status
                : log.email_status;
        }

        // Build a brief content summary
        const content = step.content as any;
        let contentSummary = '';
        if (step.channel === 'sms') {
            contentSummary = (content?.body || '').substring(0, 80);
        } else if (step.channel === 'email') {
            contentSummary = `Subject: ${content?.subject || 'N/A'}`;
        } else if (step.channel === 'voice') {
            contentSummary = (content?.first_message || '').substring(0, 80);
        }

        return {
            step_order: step.step_order,
            channel: step.channel as ChannelType,
            content_summary: contentSummary,
            outcome,
            generated_dynamically: step.generated_dynamically || false,
        };
    });
}

// ═══════════════════════════════════════════════════════════════════
// Concurrency Guard
// ═══════════════════════════════════════════════════════════════════

/**
 * Atomically claim an enrollment for step generation.
 * Returns true if this process won the claim, false if another did.
 */
export async function claimEnrollmentForGeneration(enrollmentId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'generating_next_step', updated_at: new Date().toISOString() })
        .eq('id', enrollmentId)
        .eq('status', 'awaiting_outcome')
        .select('id');

    if (error) {
        console.error('[JIT] Claim error:', error);
        return false;
    }

    return (data?.length ?? 0) > 0;
}

// ═══════════════════════════════════════════════════════════════════
// Core: generateNextStep
// ═══════════════════════════════════════════════════════════════════

export async function generateNextStep(params: {
    enrollment: SequenceEnrollment;
    sequence: Sequence;
    contact: Contact;
    tenantProfile: TenantProfile;
    conversationContext: ConversationContext | null;
    lastOutcome: OutcomeContext;
    previousSteps: Awaited<ReturnType<typeof getExecutedSteps>>;
}): Promise<GeneratedStepResult> {
    const {
        enrollment,
        sequence,
        contact,
        tenantProfile,
        conversationContext,
        lastOutcome,
        previousSteps,
    } = params;

    const strategy = sequence.sequence_strategy;
    if (!strategy) {
        return {
            should_continue: false,
            end_reason: 'no_strategy',
            reasoning: 'Sequence has no strategy configured — cannot generate dynamic steps.',
        };
    }

    const currentStepCount = previousSteps.length;
    const stepsRemaining = strategy.max_steps - currentStepCount;

    // Hard guard: max steps reached
    if (stepsRemaining <= 0) {
        return {
            should_continue: false,
            end_reason: 'max_steps_reached',
            reasoning: `Reached maximum of ${strategy.max_steps} touchpoints.`,
        };
    }

    // Build contact validity info
    const hasPhone = !!contact.phone;
    const hasEmail = !!contact.email;
    const availableChannels = strategy.available_channels.filter(ch => {
        if (ch === 'sms' || ch === 'voice') return hasPhone;
        if (ch === 'email') return hasEmail;
        return true;
    });

    if (availableChannels.length === 0) {
        return {
            should_continue: false,
            end_reason: 'no_valid_channels',
            reasoning: 'No valid contact channels available for this lead.',
        };
    }

    // Build the previous steps summary for the prompt
    const stepHistory = previousSteps.map(s =>
        `Step ${s.step_order} [${s.channel.toUpperCase()}]: "${s.content_summary}" → outcome: ${s.outcome || 'pending'}`
    ).join('\n');

    const systemPrompt = `You are an expert outbound sales sequencer AI. Your job is to decide the NEXT step in a multi-channel outreach sequence based on what just happened.

SEQUENCE STRATEGY:
- Goal: ${strategy.goal}
- Max touchpoints: ${strategy.max_steps}
- Available channels: ${availableChannels.join(', ')}
- Agent context: ${strategy.agent_context}
${strategy.escalation_rules ? `- Escalation rules: ${strategy.escalation_rules}` : ''}

BUSINESS PROFILE:
- Business: ${(tenantProfile as any).business_name || sequence.name}
- Industry: ${tenantProfile.industry}
- Brand voice: ${tenantProfile.brand_voice}
- Timezone: ${tenantProfile.timezone}
${tenantProfile.business_hours ? `- Business hours: ${JSON.stringify(tenantProfile.business_hours)}` : ''}
${sequence.respect_business_hours ? '- MUST respect business hours' : ''}

CONTACT:
- Name: ${contact.name || contact.first_name || 'Unknown'}
- Phone: ${hasPhone ? 'Available' : 'NOT AVAILABLE'}
- Email: ${hasEmail ? 'Available' : 'NOT AVAILABLE'}

CONVERSATION TIMELINE:
${conversationContext?.formatted_timeline || 'No prior interactions.'}

PREVIOUS STEPS IN THIS SEQUENCE (${currentStepCount} of ${strategy.max_steps} used):
${stepHistory || 'None yet.'}

WHAT JUST HAPPENED:
- Outcome type: ${lastOutcome.type}
- Channel: ${lastOutcome.channel}
- Details: ${lastOutcome.details}
${lastOutcome.eiAnalysis ? `- Emotional state: ${lastOutcome.eiAnalysis.primary_emotion}, intent: ${lastOutcome.eiAnalysis.intent}, hot_lead: ${lastOutcome.eiAnalysis.is_hot_lead}, at_risk: ${lastOutcome.eiAnalysis.is_at_risk}` : ''}

STEPS REMAINING: ${stepsRemaining}

DECISION RULES (follow strictly):
1. If call went to voicemail or no-answer → next step should be an SMS IMMEDIATELY (delay_seconds: 60-120) referencing the missed call
2. If lead REPLIED on any channel → continue on THAT channel (channel stickiness)
3. If no response after SMS → wait, then try email or another call (alternate channels)
4. If lead said "stop", "not interested", "remove me" → set should_continue: false, end_reason: "opted_out"
5. If appointment/goal achieved → set should_continue: false, end_reason: "goal_achieved"
6. Never exceed max_steps (${strategy.max_steps})
7. TCPA: no calls/texts between 9pm-8am in contact's timezone
8. ${sequence.respect_business_hours ? 'Respect business hours for voice/SMS steps' : 'Can send outside business hours'}
9. If emotional analysis shows at_risk or frustrated → be gentler, increase delay, consider email over call
10. If hot_lead → act fast, shorten delays, match their preferred channel

CONTENT RULES:
- SMS: Under 160 chars, natural, reference the specific outcome. Use {{first_name}} and {{business_name}} placeholders.
- Email: Include subject, body_html, body_text. Reference prior interactions naturally.
- Voice: Provide first_message (greeting) and system_prompt (agent instructions). The system will inject the vapi_assistant_id automatically.
- NEVER be generic. Always reference what just happened.

OUTPUT FORMAT (JSON only):
{
  "should_continue": true/false,
  "end_reason": "goal_achieved" | "lead_lost" | "max_steps_reached" | "opted_out" | null,
  "step": {
    "channel": "sms" | "email" | "voice",
    "delay_seconds": <number>,
    "content": { ... channel-specific content ... },
    "skip_conditions": {"skip_if": ["appointment_booked"]} or null,
    "on_success": {"action": "continue"},
    "on_failure": {"action": "skip"}
  },
  "reasoning": "1-2 sentence explanation of your decision"
}

If should_continue is false, omit the "step" field.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Decide the next step. Output ONLY the JSON object.' },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
        return {
            should_continue: false,
            end_reason: 'generation_failed',
            reasoning: 'GPT returned empty response.',
        };
    }

    let result: GeneratedStepResult;
    try {
        result = JSON.parse(raw) as GeneratedStepResult;
    } catch {
        console.error('[JIT] Failed to parse GPT response:', raw.substring(0, 200));
        return {
            should_continue: false,
            end_reason: 'generation_failed',
            reasoning: 'GPT returned invalid JSON.',
        };
    }

    // Hard guard: enforce max_steps even if AI says continue
    if (result.should_continue && stepsRemaining <= 0) {
        result.should_continue = false;
        result.end_reason = 'max_steps_reached';
        result.reasoning += ' (overridden: max steps reached)';
    }

    // Validate channel availability
    if (result.should_continue && result.step) {
        if (!availableChannels.includes(result.step.channel)) {
            // Fallback to first available channel
            result.step.channel = availableChannels[0];
            result.reasoning += ` (channel switched to ${availableChannels[0]} — original unavailable)`;
        }
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════════
// Insert Generated Step
// ═══════════════════════════════════════════════════════════════════

/**
 * Insert a JIT-generated step into sequence_steps and update the enrollment.
 */
export async function insertGeneratedStep(params: {
    sequenceId: string;
    enrollmentId: string;
    stepOrder: number;
    result: GeneratedStepResult;
    vapiAssistantId?: string | null;
}): Promise<string | null> {
    const { sequenceId, enrollmentId, stepOrder, result, vapiAssistantId } = params;

    if (!result.should_continue || !result.step) return null;

    let content = result.step.content;

    // For voice steps, inject vapi_assistant_id
    if (result.step.channel === 'voice' && vapiAssistantId) {
        content = {
            ...content,
            vapi_assistant_id: vapiAssistantId,
        } as VoiceContent;
    }

    const { data: step, error } = await supabase
        .from('sequence_steps')
        .insert({
            sequence_id: sequenceId,
            step_order: stepOrder,
            channel: result.step.channel,
            delay_minutes: Math.max(0, Math.round((result.step.delay_seconds || 0) / 60)),
            delay_type: 'after_previous',
            content,
            skip_conditions: result.step.skip_conditions || null,
            on_success: result.step.on_success || { action: 'continue' },
            on_failure: result.step.on_failure || { action: 'skip' },
            enable_ai_mutation: false,
            mutation_instructions: null,
            generated_dynamically: true,
        })
        .select('id')
        .single();

    if (error) {
        console.error('[JIT] Error inserting step:', error);
        return null;
    }

    console.log(`[JIT] Generated step ${stepOrder} (${result.step.channel}) for enrollment ${enrollmentId}: ${result.reasoning}`);
    return step?.id || null;
}

/**
 * Look up the VAPI assistant ID linked to a sequence's agent.
 */
export async function getSequenceVapiAssistantId(sequenceId: string): Promise<string | null> {
    const { data } = await supabase
        .from('sequences')
        .select('agent_id')
        .eq('id', sequenceId)
        .single();

    if (!data?.agent_id) return null;

    const { data: agent } = await supabase
        .from('agents')
        .select('vapi_id')
        .eq('id', data.agent_id)
        .single();

    return agent?.vapi_id || null;
}

/**
 * Complete the enrollment after JIT decides no more steps.
 */
export async function endDynamicSequence(
    enrollmentId: string,
    endReason: string,
    reasoning: string
): Promise<void> {
    await supabase
        .from('sequence_enrollments')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            outcome_timeout_at: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);

    console.log(`[JIT] Enrollment ${enrollmentId} ended: ${endReason} — ${reasoning}`);
}

/**
 * Set enrollment to active with next_step_at after step generation.
 * The scheduler picks up the next step via step_order = current_step_order + 1,
 * so currentStepOrder stays as-is here; the newly-generated step lives at +1.
 */
export async function activateEnrollmentForNextStep(
    enrollmentId: string,
    delaySeconds: number,
    currentStepOrder: number
): Promise<void> {
    const nextStepAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    const { data: prior } = await supabase
        .from('sequence_enrollments')
        .select('total_attempts')
        .eq('id', enrollmentId)
        .single();

    await supabase
        .from('sequence_enrollments')
        .update({
            status: 'active',
            current_step_order: currentStepOrder,
            next_step_at: nextStepAt,
            outcome_timeout_at: null,
            total_attempts: (prior?.total_attempts ?? 0) + 1,
            updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);

    console.log(`[JIT] Enrollment ${enrollmentId} activated — next step ${currentStepOrder + 1} at ${nextStepAt}`);
}
