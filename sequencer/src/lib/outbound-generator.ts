/**
 * Outbound Generator — Intent-Guided Content Generation
 *
 * Instead of sending static templates, generates contextual outbound messages
 * using a step brief (intent, key_points, CTA, constraints) combined with
 * conversation memory, brand voice, and emotional intelligence state.
 *
 * Supports SMS and email channels. Voice uses blueprint-based dispatch instead.
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface GenerationInput {
    channel: 'sms' | 'email';
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

export interface GenerationResult {
    content: SmsContent | EmailContent;
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

    const systemPrompt = buildGenerationPrompt(channel, brandVoice, industry, businessName);
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
    } else {
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
    channel: 'sms' | 'email',
    brandVoice: string,
    industry: string,
    businessName: string
): string {
    const channelRules = channel === 'sms'
        ? `SMS RULES:
- Keep under 160 characters when possible (absolute max 320)
- Conversational and direct — no email-style formatting
- No links unless the CTA specifically requires one
- Use contractions and casual phrasing appropriate for ${brandVoice} tone`
        : `EMAIL RULES:
- Subject line under 60 characters, compelling but not clickbait
- Body: 3-5 sentences for follow-ups, can be longer for initial outreach
- Plain text format — no HTML formatting needed
- Include a greeting and sign-off with "${businessName}"
- Professional email etiquette appropriate for ${brandVoice} tone`;

    return `You are a sales copywriter for "${businessName}", a ${brandVoice} ${industry} business.

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
    : `{ "subject": "email subject line", "body_text": "plain text email body", "reasoning": "1-sentence explanation" }`
}`;
}

function buildGenerationRequest(params: {
    channel: 'sms' | 'email';
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
    if (brief.channel_hints?.[channel]) {
        request += `- Channel Hints: ${JSON.stringify(brief.channel_hints[channel])}\n`;
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

    request += `\nGenerate the ${channel.toUpperCase()} message now. Return valid JSON.`;
    return request;
}
