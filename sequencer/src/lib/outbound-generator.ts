/**
 * Outbound Generator — Intent-Guided Content Generation
 *
 * Instead of sending static templates, generates contextual outbound messages
 * using a step brief (intent, key_points, CTA, constraints) combined with
 * conversation memory, brand voice, and emotional intelligence state.
 *
 * Supports SMS, email, and voice. For voice it generates the opening line
 * (first_message) the agent speaks when the call connects; the rest of the
 * call is driven by the assistant's own prompt/blueprint.
 *
 * Used by:
 * - scheduler-worker: generate outbound content at dispatch time for brief-based steps
 */

import OpenAI from 'openai';
import type {
    StepBrief,
    ConversationContext,
    TenantProfile,
    Contact,
    SequenceEnrollment,
    Sequence,
    SequenceStep,
    SmsContent,
    EmailContent,
    ChannelType,
    EmotionalAnalysis,
    SentimentTrend,
    PrimaryEmotion,
    RecommendedTone,
} from './types.js';
import { getAgentMessaging } from './agent-messaging.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface GenerationInput {
    channel: 'sms' | 'email' | 'voice';
    brief: StepBrief;
    conversationContext: ConversationContext | null;
    tenantProfile: TenantProfile;
    contact: Contact;
    enrollment: SequenceEnrollment;
    sequence: Sequence;
    step: SequenceStep;
    emotionalState?: {
        sentimentTrend: SentimentTrend;
        lastEmotion: PrimaryEmotion | null;
        recommendedTone: RecommendedTone;
        isHotLead: boolean;
        isAtRisk: boolean;
    };
}

// Voice generation produces ONLY the opening line — deliberately narrower
// than VoiceContent (no system_prompt etc.), so callers merge it into the
// step's existing voice content instead of replacing it.
export interface VoiceGeneratedContent {
    first_message: string;
}

export interface GenerationResult {
    content: SmsContent | EmailContent | VoiceGeneratedContent;
    reasoning: string;
    model: string;
}

// ═══════════════════════════════════════════════════════════════════
// Core Generation
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate outbound content from a step brief + context.
 * Returns the generated message ready for dispatch.
 */
export async function generateOutboundContent(input: GenerationInput): Promise<GenerationResult> {
    const { channel, brief, conversationContext, tenantProfile, contact, enrollment, sequence, step, emotionalState } = input;

    const businessName = (tenantProfile as any)?.business_name || sequence.name || 'Our team';
    const brandVoice = tenantProfile.brand_voice || 'professional';
    const industry = tenantProfile.industry || 'general services';
    const contactName = contact.name || contact.first_name || '';

    const messaging = await getAgentMessaging(sequence.agent_id);
    const systemPrompt = buildGenerationPrompt(
        channel,
        brandVoice,
        industry,
        businessName,
        messaging?.smsPrompt,
        messaging?.sharedContextText
    );
    const userMessage = buildGenerationRequest({
        channel,
        brief,
        conversationContext,
        contactName,
        contact,
        enrollment,
        step,
        emotionalState,
    });

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
        throw new Error('Empty response from generation model');
    }

    const parsed = JSON.parse(raw);

    if (channel === 'sms') {
        if (!parsed.body || typeof parsed.body !== 'string') {
            throw new Error('Generated SMS missing body field');
        }
        return {
            content: { body: parsed.body } as SmsContent,
            reasoning: parsed.reasoning || 'Generated from step brief',
            model: 'gpt-4o-mini',
        };
    } else if (channel === 'email') {
        if (!parsed.subject || !parsed.body_text) {
            throw new Error('Generated email missing subject or body_text');
        }
        return {
            content: {
                subject: parsed.subject,
                // The model produces plain text — escape HTML entities and
                // convert newlines so it renders correctly in HTML clients
                // and stray </&  characters can't break the markup.
                body_html: plainTextToHtml(parsed.body_text),
                body_text: parsed.body_text,
            } as EmailContent,
            reasoning: parsed.reasoning || 'Generated from step brief',
            model: 'gpt-4o-mini',
        };
    } else {
        if (!parsed.first_message || typeof parsed.first_message !== 'string') {
            throw new Error('Generated voice content missing first_message field');
        }
        return {
            content: { first_message: parsed.first_message } as VoiceGeneratedContent,
            reasoning: parsed.reasoning || 'Generated from step brief',
            model: 'gpt-4o-mini',
        };
    }
}

/**
 * Convert plain text to safe HTML: escape entities, then newlines → <br>.
 */
function plainTextToHtml(text: string): string {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    return `<p>${escaped.replace(/\r\n/g, '\n').replace(/\n/g, '<br>')}</p>`;
}

// ═══════════════════════════════════════════════════════════════════
// Prompt Construction
// ═══════════════════════════════════════════════════════════════════

function buildGenerationPrompt(
    channel: 'sms' | 'email' | 'voice',
    brandVoice: string,
    industry: string,
    businessName: string,
    smsPersona?: string | null,
    sharedContextText?: string
): string {
    const channelRules = channel === 'sms'
        ? `SMS RULES:
- Keep under 160 characters when possible (absolute max 320)
- Conversational and direct — no email-style formatting
- No links unless the CTA specifically requires one
- Use contractions and casual phrasing appropriate for ${brandVoice} tone`
        : channel === 'email'
        ? `EMAIL RULES:
- Subject line under 60 characters, compelling but not clickbait
- Body: 3-5 sentences for follow-ups, can be longer for initial outreach
- Plain text format — no HTML formatting needed
- Include a greeting and sign-off with "${businessName}"
- Professional email etiquette appropriate for ${brandVoice} tone`
        : `VOICE RULES:
- You are writing the OPENING LINE the AI agent speaks the moment an outbound call connects
- 1-2 short sentences of natural spoken language — contractions, no formatting
- Identify who is calling ("${businessName}") and why, per the brief
- No links, emojis, markdown, or stage directions — this text is spoken aloud verbatim
- End by inviting a response so the conversation starts naturally
- Match the ${brandVoice} tone`;

    // For SMS, lead with the bound agent's texting persona so copy is
    // consistent with what the voice agent pitches on calls.
    const personaIntro =
        channel === 'sms' && smsPersona
            ? `${smsPersona}\n\nYou write outbound texts in that exact voice.`
            : `You are a sales copywriter for "${businessName}", a ${brandVoice} ${industry} business.`;
    const sharedContextBlock = sharedContextText ? `\n\n${sharedContextText}` : '';

    return `${personaIntro}${sharedContextBlock}

Your job: generate a ${channel.toUpperCase()} message from a strategic brief, personalized using real conversation history.

${channelRules}

ABSOLUTE RULES:
- Match the ${brandVoice} brand voice consistently
- Reference prior interactions naturally — don't force it
- Never reveal you are an AI
- Drive toward the CTA without being pushy
- Respect all constraints from the brief
- TCPA compliant — no misleading claims

OUTPUT FORMAT (JSON only):
${channel === 'sms'
    ? `{ "body": "the SMS message text", "reasoning": "1-sentence explanation" }`
    : channel === 'email'
    ? `{ "subject": "email subject line", "body_text": "plain text email body", "reasoning": "1-sentence explanation" }`
    : `{ "first_message": "the spoken opening line", "reasoning": "1-sentence explanation" }`
}`;
}

function buildGenerationRequest(params: {
    channel: 'sms' | 'email' | 'voice';
    brief: StepBrief;
    conversationContext: ConversationContext | null;
    contactName: string;
    contact: Contact;
    enrollment: SequenceEnrollment;
    step: SequenceStep;
    emotionalState?: {
        sentimentTrend: SentimentTrend;
        lastEmotion: PrimaryEmotion | null;
        recommendedTone: RecommendedTone;
        isHotLead: boolean;
        isAtRisk: boolean;
    };
}): string {
    const { channel, brief, conversationContext, contactName, contact, enrollment, step, emotionalState } = params;

    let request = `STEP BRIEF:\n`;
    request += `- Intent: ${brief.intent}\n`;
    request += `- Key Points: ${brief.key_points.join(', ')}\n`;
    request += `- CTA: ${brief.cta}\n`;
    if (brief.constraints.length > 0) {
        request += `- Constraints: ${brief.constraints.join(', ')}\n`;
    }
    // channel_hints only carries sms/email keys — nothing to surface for voice
    const channelHint = channel !== 'voice' ? brief.channel_hints?.[channel] : undefined;
    if (channelHint) {
        request += `- Channel Hints: ${JSON.stringify(channelHint)}\n`;
    }

    request += `\nCONTACT:\n`;
    request += `- Name: ${contactName || 'Unknown'}\n`;
    request += `- Company: ${contact.company || 'N/A'}\n`;

    // Custom variables
    const customVars = enrollment.custom_variables || {};
    if (Object.keys(customVars).length > 0) {
        request += `\nCUSTOM VARIABLES (use naturally):\n`;
        for (const [k, v] of Object.entries(customVars)) {
            request += `- ${k}: ${v}\n`;
        }
    }

    request += `\nSTEP CONTEXT:\n`;
    request += `- Step number: ${step.step_order + 1}\n`;
    request += `- Channel: ${channel}\n`;

    // Conversation context
    if (conversationContext) {
        request += `\nCONVERSATION HISTORY:\n`;
        if (conversationContext.formatted_timeline) {
            request += `${conversationContext.formatted_timeline}\n`;
        }

        if (conversationContext.last_sms_reply) {
            request += `LAST SMS REPLY: "${conversationContext.last_sms_reply.body}" (${conversationContext.last_sms_reply.sentiment}, ${conversationContext.last_sms_reply.time_ago})\n`;
        }

        if (conversationContext.last_call) {
            request += `LAST CALL: ${conversationContext.last_call.summary} (${conversationContext.last_call.disposition}, ${conversationContext.last_call.duration_seconds}s)\n`;
        }

        if (conversationContext.objections_history.length > 0) {
            request += `OBJECTIONS: ${conversationContext.objections_history.join(', ')}\n`;
        }

        request += `OVERALL SENTIMENT: ${conversationContext.overall_sentiment}\n`;
        request += `INTERACTIONS: ${conversationContext.interaction_count.total} total\n`;
    } else {
        request += `\nNo prior conversation history.\n`;
    }

    // Emotional state
    if (emotionalState) {
        request += `\nEMOTIONAL STATE:\n`;
        request += `- Sentiment trend: ${emotionalState.sentimentTrend}\n`;
        request += `- Recommended tone: ${emotionalState.recommendedTone}\n`;
        if (emotionalState.lastEmotion) request += `- Last emotion: ${emotionalState.lastEmotion}\n`;
        if (emotionalState.isHotLead) request += `- HOT LEAD — be responsive and direct\n`;
        if (emotionalState.isAtRisk) request += `- AT RISK — be gentle and empathetic\n`;
    }

    request += `\nGenerate the ${channel === 'voice' ? 'call opening line' : `${channel.toUpperCase()} message`} now. Return valid JSON.`;
    return request;
}
