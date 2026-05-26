/**
 * Email Responder — AI Chatbot Mode for Email Replies
 *
 * Handles inbound email replies by generating context-aware AI responses.
 * Mirrors sms-responder.ts architecture with email-specific behavior.
 *
 * Decides whether to:
 * - Reply with an AI-generated email
 * - Mark the goal as achieved (booking, conversion)
 * - Escalate to a human agent
 * - Process an opt-out request
 *
 * Configurable per-tenant via email_reply_mode:
 * - 'auto': Full chatbot loop — analyze, generate, send
 * - 'draft': Generate response, save as draft, notify tenant
 * - 'notify_only': Record in memory, notify tenant (default)
 *
 * Used by:
 * - event-processor: called when an email reply is received on an active enrollment
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import { getConversationContext } from './conversation-memory.js';
import type {
    ConversationContext,
    SequenceEnrollment,
    Sequence,
    Contact,
    TenantProfile,
    TriggeringStepContext,
    EmailReplyMode,
} from './types.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_CHATBOT_TURNS = 10;

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface EmailResponderResult {
    action: 'reply' | 'goal_achieved' | 'escalate' | 'opt_out';
    subject?: string;           // Email subject (Re: ...)
    message?: string;           // Plain text email body
    conversion_type?: string;   // for 'goal_achieved'
    escalation_reason?: string; // for 'escalate'
    metadata?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════
// Core: handleInboundEmail
// ═══════════════════════════════════════════════════════════════════

export async function handleInboundEmail(params: {
    enrollmentId: string;
    sequenceId: string;
    contactId: string;
    clientId: string;
    inboundSubject: string;
    inboundBody: string;
    fromEmail: string;
    triggeringStep?: TriggeringStepContext;
}): Promise<EmailResponderResult> {
    const { enrollmentId, sequenceId, contactId, clientId, inboundSubject, inboundBody, fromEmail, triggeringStep } = params;

    console.log(`[EMAIL-RESPONDER] Processing inbound email for enrollment ${enrollmentId}: "${inboundSubject}"`);

    try {
        // 1. Fetch enrollment data
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('*')
            .eq('id', enrollmentId)
            .single();

        if (!enrollment) {
            return { action: 'escalate', escalation_reason: 'Enrollment not found' };
        }

        // 2. Fetch sequence
        const { data: sequence } = await supabase
            .from('sequences')
            .select('*')
            .eq('id', sequenceId)
            .single();

        if (!sequence) {
            return { action: 'escalate', escalation_reason: 'Sequence not found' };
        }

        // 3. Fetch contact
        const { data: contact } = await supabase
            .from('contacts')
            .select('*')
            .eq('id', contactId)
            .single();

        // 4. Fetch tenant profile
        const { data: tenantProfile } = await supabase
            .from('tenant_profiles')
            .select('*')
            .eq('client_id', clientId)
            .single();

        // 5. Conversation context
        let conversationContext: ConversationContext | null = null;
        try {
            conversationContext = await getConversationContext(contactId, enrollmentId);
        } catch (err) {
            console.error('[EMAIL-RESPONDER] Error fetching conversation context:', err);
        }

        // 6. Check chatbot turn count
        const chatbotTurnCount = await getEmailChatbotTurnCount(enrollmentId);
        if (chatbotTurnCount >= MAX_CHATBOT_TURNS) {
            return {
                action: 'escalate',
                escalation_reason: 'Max email chatbot turns reached',
                metadata: { turn_count: chatbotTurnCount },
            };
        }

        // 7. Generate response
        const result = await generateEmailResponse({
            enrollment: enrollment as SequenceEnrollment,
            sequence: sequence as Sequence,
            contact: contact as Contact | null,
            tenantProfile: tenantProfile as TenantProfile | null,
            conversationContext,
            inboundSubject,
            inboundBody,
            chatbotTurnCount,
            triggeringStep,
        });

        console.log(`[EMAIL-RESPONDER] Decision: ${result.action}${result.message ? ` — "${result.message.substring(0, 60)}..."` : ''}`);
        return result;
    } catch (err) {
        console.error('[EMAIL-RESPONDER] Error:', err);
        return {
            action: 'escalate',
            escalation_reason: 'Internal error processing email reply',
            metadata: { error: String(err) },
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Turn Counting
// ═══════════════════════════════════════════════════════════════════

async function getEmailChatbotTurnCount(enrollmentId: string): Promise<number> {
    const { count, error } = await supabase
        .from('contact_interactions')
        .select('id', { count: 'exact', head: true })
        .eq('enrollment_id', enrollmentId)
        .eq('channel', 'email')
        .eq('direction', 'outbound')
        .contains('metadata', { source: 'chatbot' });

    if (error) {
        const { count: fallbackCount } = await supabase
            .from('contact_interactions')
            .select('id', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)
            .eq('channel', 'email')
            .eq('direction', 'outbound');
        return fallbackCount || 0;
    }

    return count || 0;
}

// ═══════════════════════════════════════════════════════════════════
// GPT-4o Response Generation
// ═══════════════════════════════════════════════════════════════════

async function generateEmailResponse(params: {
    enrollment: SequenceEnrollment;
    sequence: Sequence;
    contact: Contact | null;
    tenantProfile: TenantProfile | null;
    conversationContext: ConversationContext | null;
    inboundSubject: string;
    inboundBody: string;
    chatbotTurnCount: number;
    triggeringStep?: TriggeringStepContext;
}): Promise<EmailResponderResult> {
    const {
        enrollment, sequence, contact, tenantProfile,
        conversationContext, inboundSubject, inboundBody,
        chatbotTurnCount, triggeringStep,
    } = params;

    const strategy = sequence.sequence_strategy;
    const businessName = (tenantProfile as any)?.business_name || sequence.name || 'Our team';
    const brandVoice = tenantProfile?.brand_voice || 'professional';
    const industry = tenantProfile?.industry || 'general services';
    const contactName = contact?.name || contact?.first_name || '';

    let triggeringStepSection = '';
    if (triggeringStep) {
        triggeringStepSection = `\nTRIGGERING STEP:
The customer is replying to Step ${triggeringStep.step_order + 1} (sent ${triggeringStep.sent_at} via ${triggeringStep.channel}).
${triggeringStep.step_brief ? `Step intent: "${triggeringStep.step_brief.intent}"` : ''}
What we sent: "${triggeringStep.content_summary}"`;
    }

    const systemPrompt = `You are an AI email assistant for "${businessName}", a ${brandVoice} ${industry} business.

SEQUENCE GOAL: ${strategy?.goal || 'engage the customer and book an appointment'}
AGENT CONTEXT: ${strategy?.agent_context || 'outbound sales/service follow-up'}

BUSINESS PROFILE:
- Name: ${businessName}
- Brand voice: ${brandVoice}
- Industry: ${industry}
- Timezone: ${tenantProfile?.timezone || 'America/New_York'}
${tenantProfile?.custom_phrases?.always_mention ? `- Always mention: ${tenantProfile.custom_phrases.always_mention.join(', ')}` : ''}
${tenantProfile?.custom_phrases?.never_say ? `- Never say: ${tenantProfile.custom_phrases.never_say.join(', ')}` : ''}

CONTACT INFO:
- Name: ${contactName || 'Unknown'}
- Email: ${contact?.email || 'N/A'}
- Company: ${contact?.company || 'N/A'}

CONVERSATION HISTORY:
${conversationContext?.formatted_timeline || 'No prior interactions recorded.'}
${triggeringStepSection}

CHATBOT TURNS SO FAR: ${chatbotTurnCount} of ${MAX_CHATBOT_TURNS} max

YOUR TASK:
Analyze the customer's email reply and decide the best action. Return valid JSON.

DECISION RULES:
1. OPT-OUT: If customer says "unsubscribe", "stop emailing", "remove me" — return "opt_out"
2. GOAL ACHIEVED: If customer confirms booking, says yes, agrees — return "goal_achieved"
3. ESCALATION: If angry, complex question, requests human — return "escalate"
4. REPLY: For all other cases, craft a helpful email response

EMAIL REPLY RULES:
- 3-5 sentences for follow-ups
- Include a greeting and sign-off with "${businessName}"
- Match the ${brandVoice} brand voice
- Reference the original email subject naturally
- Be helpful and professional
- Never reveal you are an AI
- Drive toward the sequence goal

OUTPUT FORMAT (JSON only):
{
  "action": "reply" | "goal_achieved" | "escalate" | "opt_out",
  "subject": "Re: subject line (required for 'reply')",
  "message": "The email body text (required for 'reply')",
  "conversion_type": "booked" | "replied" | "interested" | null,
  "escalation_reason": "reason string" | null,
  "reasoning": "1-sentence internal explanation"
}`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Customer replied to email with subject "${inboundSubject}":\n\n${inboundBody}\n\nDecide the best action. Output ONLY the JSON object.` },
        ],
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
        return { action: 'escalate', escalation_reason: 'AI response generation failed' };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { action: 'escalate', escalation_reason: 'AI returned invalid JSON' };
    }

    const action = parsed.action;
    if (!['reply', 'goal_achieved', 'escalate', 'opt_out'].includes(action)) {
        return { action: 'escalate', escalation_reason: `Unknown action: ${action}` };
    }

    if (action === 'reply' && (!parsed.message || typeof parsed.message !== 'string')) {
        return { action: 'escalate', escalation_reason: 'AI returned reply without message' };
    }

    return {
        action,
        subject: parsed.subject || undefined,
        message: parsed.message || undefined,
        conversion_type: parsed.conversion_type || undefined,
        escalation_reason: parsed.escalation_reason || undefined,
        metadata: {
            reasoning: parsed.reasoning,
            turn: chatbotTurnCount + 1,
            model: 'gpt-4o',
        },
    };
}
