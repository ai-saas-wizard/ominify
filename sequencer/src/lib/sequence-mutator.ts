/**
 * Adaptive Sequence Mutation Engine
 *
 * Instead of executing static, pre-written sequence steps, the AI dynamically
 * rewrites upcoming steps based on what happened in prior interactions.
 *
 * Uses conversation context (Phase 1) + emotional intelligence (Phase 2) to
 * generate personalized, context-aware messaging.
 *
 * Used by:
 * - scheduler-worker: mutate step content before dispatch
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import type {
    SequenceStep,
    SequenceEnrollment,
    Sequence,
    TenantProfile,
    ConversationContext,
    SmsContent,
    EmailContent,
    VoiceContent,
    MutationResult,
    MutationAggressiveness,
    ChannelType,
    EmotionalAnalysis,
} from './types.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Minimum confidence to use a mutation (below this, use original)
const MIN_CONFIDENCE = 0.50;

// ═══════════════════════════════════════════════════════════════════
// Core Mutation Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide whether a step should be mutated.
 * Returns false if: no prior interactions, sequence is on first step,
 * mutation disabled, or no meaningful context to mutate from.
 */
export function shouldMutate(
    step: SequenceStep,
    sequence: Sequence,
    enrollment: SequenceEnrollment,
    conversationContext: ConversationContext | null
): boolean {
    // Master toggle check
    if (!sequence.enable_adaptive_mutation) return false;

    // Step-level override: if explicitly disabled, skip
    // If step has enable_ai_mutation explicitly set to false, respect it
    // Otherwise, sequence-level setting applies
    if (step.enable_ai_mutation === false && !sequence.enable_adaptive_mutation) return false;

    // No context to mutate from — nothing to personalize
    if (!conversationContext || conversationContext.interaction_count.total === 0) return false;

    // First step of the sequence: typically no prior interaction yet
    if (enrollment.current_step_order === 0) return false;

    // Has meaningful signals to mutate from?
    const hasReply = !!conversationContext.last_sms_reply;
    const hasCall = !!conversationContext.last_call;
    const hasObjections = conversationContext.objections_history.length > 0;
    const hasEmotionalData = !!conversationContext.last_emotional_analysis;
    const sentimentShifted = conversationContext.overall_sentiment !== 'neutral';

    // At least one meaningful signal should exist
    return hasReply || hasCall || hasObjections || hasEmotionalData || sentimentShifted;
}

/**
 * Mutate step content using GPT-4o.
 * Takes the original template, conversation context, brand voice, and
 * aggressiveness level to generate a personalized version.
 */
export async function mutateStepContent(
    step: SequenceStep,
    conversationContext: ConversationContext,
    tenantProfile: TenantProfile,
    aggressiveness: MutationAggressiveness
): Promise<MutationResult> {
    const channel = step.channel;
    const originalContent = step.content;

    const systemPrompt = buildMutationPrompt(channel, aggressiveness, tenantProfile);

    const userMessage = buildMutationRequest(
        channel,
        originalContent,
        conversationContext,
        step.mutation_instructions,
        aggressiveness
    );

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.4,
            max_tokens: 800,
            response_format: { type: 'json_object' },
        });

        const result = response.choices[0]?.message?.content;
        if (!result) {
            throw new Error('Empty response from mutation model');
        }

        const parsed = JSON.parse(result);

        // Validate the mutated content matches the channel format
        const mutatedContent = validateMutatedContent(channel, parsed.content, originalContent);

        return {
            content: mutatedContent,
            reason: parsed.reason || 'AI-adapted based on conversation context',
            confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
            model: 'gpt-4o',
        };
    } catch (err) {
        console.error('[MUTATOR] Mutation failed:', err);
        throw err; // Let caller handle fallback to original
    }
}

/**
 * Record a mutation in the step_mutations audit trail.
 */
export async function recordMutation(
    enrollmentId: string,
    stepId: string,
    clientId: string,
    originalContent: SmsContent | EmailContent | VoiceContent,
    mutation: MutationResult,
    aggressiveness: MutationAggressiveness
): Promise<string | null> {
    try {
        const { data, error } = await supabase
            .from('step_mutations')
            .insert({
                enrollment_id: enrollmentId,
                step_id: stepId,
                client_id: clientId,
                original_content: originalContent,
                mutated_content: mutation.content,
                mutation_reason: mutation.reason,
                mutation_model: mutation.model,
                confidence_score: mutation.confidence,
                aggressiveness,
            })
            .select('id')
            .single();

        if (error) {
            console.error('[MUTATOR] Failed to record mutation:', error);
            return null;
        }

        return data?.id || null;
    } catch (err) {
        console.error('[MUTATOR] Error recording mutation:', err);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Prompt Construction
// ═══════════════════════════════════════════════════════════════════

function buildMutationPrompt(
    channel: ChannelType,
    aggressiveness: MutationAggressiveness,
    tenantProfile: TenantProfile
): string {
    const brandVoice = tenantProfile.brand_voice || 'professional';
    const industry = tenantProfile.industry || 'general services';

    let aggressivenessGuide = '';
    switch (aggressiveness) {
        case 'conservative':
            aggressivenessGuide = `CONSERVATIVE MUTATION:
- Keep the original structure and message flow intact
- Only add brief references to prior conversations (1-2 phrases)
- Adjust tone slightly based on emotional state
- Do NOT change the CTA, discount offers, or core value proposition
- Think of this as adding a personal touch, not rewriting`;
            break;
        case 'moderate':
            aggressivenessGuide = `MODERATE MUTATION:
- Rewrite the content to directly address specific concerns or interests from conversations
- Keep the same CTA and general intent of the original
- You may restructure sentences and change the opening
- Address objections naturally within the message
- The original template is your guide for what to communicate, but you personalize HOW`;
            break;
        case 'aggressive':
            aggressivenessGuide = `AGGRESSIVE MUTATION:
- Completely regenerate the content based on conversation history
- The original template is just inspiration for the topic/goal
- Write as if you're a human sales rep who knows this customer personally
- Create entirely new CTAs if the conversation context suggests a better approach
- You have creative freedom — make it compelling and personalized`;
            break;
    }

    return `You are a sales copywriter for a ${brandVoice} brand in the ${industry} industry.
Your job is to adapt outreach messages based on real conversation history with the customer.

${aggressivenessGuide}

ABSOLUTE RULES (never break these):
- NEVER change: phone numbers, links, legal disclaimers, opt-out language
- ALWAYS maintain: brand voice (${brandVoice}), TCPA compliance
${channel === 'sms' ? '- SMS must be under 160 characters when possible (max 320)\n- Keep SMS casual and direct — no email-style formatting' : ''}
${channel === 'email' ? '- Maintain proper email structure with greeting and sign-off\n- Keep HTML formatting clean' : ''}
${channel === 'voice' ? '- System prompts should be natural conversational instructions\n- First message should feel organic, not scripted' : ''}

You must respond with a valid JSON object:
{
    "content": {${getContentSchema(channel)}},
    "reason": "1-sentence explanation of what you changed and why",
    "confidence": 0.00 to 1.00
}

Set confidence based on:
- 0.9+ : Strong signals in conversation history clearly guide the adaptation
- 0.7-0.9 : Good context available, reasonable adaptation
- 0.5-0.7 : Some context but adaptation is speculative
- Below 0.5 : Not enough context, original is probably better`;
}

function buildMutationRequest(
    channel: ChannelType,
    originalContent: SmsContent | EmailContent | VoiceContent,
    ctx: ConversationContext,
    mutationInstructions: string | null,
    aggressiveness: MutationAggressiveness
): string {
    let request = `ORIGINAL TEMPLATE:\n${JSON.stringify(originalContent, null, 2)}\n\n`;

    // Conversation context
    request += `CONVERSATION HISTORY:\n`;

    if (ctx.formatted_timeline) {
        request += `${ctx.formatted_timeline}\n\n`;
    }

    // Key signals
    if (ctx.last_sms_reply) {
        request += `LAST SMS REPLY FROM CUSTOMER: "${ctx.last_sms_reply.body}" (intent: ${ctx.last_sms_reply.intent}, sentiment: ${ctx.last_sms_reply.sentiment}, ${ctx.last_sms_reply.time_ago})\n`;
    }

    if (ctx.last_call) {
        request += `LAST CALL: ${ctx.last_call.summary} (disposition: ${ctx.last_call.disposition}, duration: ${ctx.last_call.duration_seconds}s)\n`;
    }

    if (ctx.objections_history.length > 0) {
        request += `OBJECTIONS RAISED: ${ctx.objections_history.join(', ')}\n`;
    }

    if (ctx.key_topics_history.length > 0) {
        request += `KEY TOPICS DISCUSSED: ${ctx.key_topics_history.join(', ')}\n`;
    }

    request += `OVERALL SENTIMENT: ${ctx.overall_sentiment}\n`;
    request += `INTERACTIONS SO FAR: ${ctx.interaction_count.total} (${ctx.interaction_count.calls} calls, ${ctx.interaction_count.sms} SMS, ${ctx.interaction_count.emails} emails)\n`;

    if (ctx.appointment_discussed) {
        request += `NOTE: Appointment was discussed but not yet booked\n`;
    }

    // Emotional intelligence data
    if (ctx.last_emotional_analysis) {
        const ea = ctx.last_emotional_analysis;
        request += `\nEMOTIONAL STATE: ${ea.primary_emotion} (confidence: ${Math.round(ea.emotion_confidence * 100)}%)\n`;
        request += `RECOMMENDED TONE: ${ea.recommended_tone}\n`;

        if (ea.buying_signals.length > 0) {
            request += `BUYING SIGNALS: ${ea.buying_signals.map(s => s.signal).join('; ')}\n`;
        }

        if (ea.objections.length > 0) {
            request += `SPECIFIC OBJECTIONS: ${ea.objections.map(o => `${o.type} (${o.severity}): ${o.detail}`).join('; ')}\n`;
        }
    }

    // Custom instructions from the user
    if (mutationInstructions) {
        request += `\nCUSTOM MUTATION INSTRUCTIONS FROM USER:\n${mutationInstructions}\n`;
    }

    request += `\nMUTATION AGGRESSIVENESS: ${aggressiveness}\n`;
    request += `\nNow generate the mutated content. Remember to return valid JSON.`;

    return request;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getContentSchema(channel: ChannelType): string {
    switch (channel) {
        case 'sms':
            return '"body": "the SMS message text"';
        case 'email':
            return '"subject": "email subject", "body_html": "HTML body", "body_text": "plain text body"';
        case 'voice':
            return '"first_message": "opening line", "system_prompt": "agent instructions"';
        default:
            return '"body": "message text"';
    }
}

/**
 * Validate that the mutated content matches the expected channel format.
 * Falls back to original content for any missing fields.
 */
function validateMutatedContent(
    channel: ChannelType,
    mutated: any,
    original: SmsContent | EmailContent | VoiceContent
): SmsContent | EmailContent | VoiceContent {
    if (!mutated || typeof mutated !== 'object') return original;

    switch (channel) {
        case 'sms': {
            const orig = original as SmsContent;
            return {
                body: typeof mutated.body === 'string' && mutated.body.length > 0
                    ? mutated.body
                    : orig.body,
            } as SmsContent;
        }
        case 'email': {
            const orig = original as EmailContent;
            return {
                subject: typeof mutated.subject === 'string' ? mutated.subject : orig.subject,
                body_html: typeof mutated.body_html === 'string' ? mutated.body_html : orig.body_html,
                body_text: typeof mutated.body_text === 'string' ? mutated.body_text : orig.body_text,
            } as EmailContent;
        }
        case 'voice': {
            const orig = original as VoiceContent;
            return {
                ...orig, // Preserve vapi_assistant_id, transfer_number, etc.
                first_message: typeof mutated.first_message === 'string' ? mutated.first_message : orig.first_message,
                system_prompt: typeof mutated.system_prompt === 'string' ? mutated.system_prompt : orig.system_prompt,
            } as VoiceContent;
        }
        default:
            return original;
    }
}

// Export the minimum confidence constant for use by scheduler
export { MIN_CONFIDENCE };
