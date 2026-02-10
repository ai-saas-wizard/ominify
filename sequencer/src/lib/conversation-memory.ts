/**
 * Conversation Memory Library
 *
 * Provides cross-channel conversation context for sequence steps.
 * Every interaction (SMS, email, voice) is recorded and queryable,
 * so each step knows what happened on every other channel.
 *
 * Used by:
 * - scheduler-worker: inject context into template variables + voice prompts
 * - sequence-mutator (Phase 3): adaptive content based on history
 * - emotional-intelligence (Phase 2): trend analysis
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import type {
    ContactInteraction,
    ConversationContext,
    InteractionChannel,
    InteractionDirection,
    InteractionOutcome,
    InteractionSentiment,
    InteractionIntent,
    EmotionalAnalysis,
} from './types.js';
import { formatDistanceToNow } from 'date-fns';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_INTERACTIONS_FOR_CONTEXT = 15;
const MAX_TIMELINE_INTERACTIONS = 10;

// ═══════════════════════════════════════════════════════════════════
// Record Interactions
// ═══════════════════════════════════════════════════════════════════

export interface RecordInteractionParams {
    clientId: string;
    contactId: string;
    enrollmentId?: string;
    stepId?: string;
    channel: InteractionChannel;
    direction: InteractionDirection;
    contentBody?: string;
    contentSubject?: string;
    outcome?: InteractionOutcome;
    sentiment?: InteractionSentiment;
    intent?: InteractionIntent;
    callDurationSeconds?: number;
    callDisposition?: string;
    appointmentBooked?: boolean;
    objectionsRaised?: string[];
    keyTopics?: string[];
    providerId?: string;
}

/**
 * Record a single interaction to the contact_interactions table.
 * Called by all workers after sending/receiving messages.
 */
export async function recordInteraction(params: RecordInteractionParams): Promise<string | null> {
    try {
        const { data, error } = await supabase
            .from('contact_interactions')
            .insert({
                client_id: params.clientId,
                contact_id: params.contactId,
                enrollment_id: params.enrollmentId || null,
                step_id: params.stepId || null,
                channel: params.channel,
                direction: params.direction,
                content_body: params.contentBody || null,
                content_subject: params.contentSubject || null,
                outcome: params.outcome || null,
                sentiment: params.sentiment || null,
                intent: params.intent || null,
                call_duration_seconds: params.callDurationSeconds || null,
                call_disposition: params.callDisposition || null,
                appointment_booked: params.appointmentBooked || false,
                objections_raised: params.objectionsRaised || null,
                key_topics: params.keyTopics || null,
                provider_id: params.providerId || null,
            })
            .select('id')
            .single();

        if (error) {
            console.error('[MEMORY] Error recording interaction:', error.message);
            return null;
        }

        return data?.id || null;
    } catch (err) {
        console.error('[MEMORY] Exception recording interaction:', err);
        return null;
    }
}

/**
 * Update an existing interaction (e.g., when call ends and we get transcript/outcome)
 */
export async function updateInteraction(
    interactionId: string,
    updates: Partial<Pick<
        ContactInteraction,
        'content_body' | 'content_summary' | 'outcome' | 'sentiment' | 'intent' |
        'call_duration_seconds' | 'call_disposition' | 'appointment_booked' |
        'objections_raised' | 'key_topics'
    >>
): Promise<void> {
    try {
        await supabase
            .from('contact_interactions')
            .update(updates)
            .eq('id', interactionId);
    } catch (err) {
        console.error('[MEMORY] Exception updating interaction:', err);
    }
}

/**
 * Find an interaction by provider ID (e.g., VAPI call ID, Twilio SID)
 */
export async function findInteractionByProviderId(providerId: string): Promise<ContactInteraction | null> {
    const { data } = await supabase
        .from('contact_interactions')
        .select('*')
        .eq('provider_id', providerId)
        .limit(1)
        .single();

    return data as ContactInteraction | null;
}

// ═══════════════════════════════════════════════════════════════════
// Build Conversation Context
// ═══════════════════════════════════════════════════════════════════

/**
 * Get full conversation context for a contact.
 * This is the primary function used by the scheduler to inject
 * cross-channel awareness into templates and voice prompts.
 */
export async function getConversationContext(
    contactId: string,
    enrollmentId?: string
): Promise<ConversationContext> {
    // Fetch recent interactions for this contact
    const { data: interactions, error } = await supabase
        .from('contact_interactions')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(MAX_INTERACTIONS_FOR_CONTEXT);

    if (error || !interactions || interactions.length === 0) {
        return buildEmptyContext();
    }

    const typed = interactions as ContactInteraction[];

    // Build context from interactions
    const lastInteraction = typed[0];
    const lastCall = typed.find(i => i.channel === 'voice');
    const lastSmsReply = typed.find(i => i.channel === 'sms' && i.direction === 'inbound');
    const lastEmail = typed.find(i => i.channel === 'email' && i.direction === 'outbound');

    // Aggregate counts
    const counts = {
        total: typed.length,
        calls: typed.filter(i => i.channel === 'voice').length,
        sms: typed.filter(i => i.channel === 'sms').length,
        emails: typed.filter(i => i.channel === 'email').length,
        inbound: typed.filter(i => i.direction === 'inbound').length,
        outbound: typed.filter(i => i.direction === 'outbound').length,
    };

    // Aggregate objections and topics across all interactions
    const allObjections: string[] = [];
    const allTopics: string[] = [];
    let appointmentDiscussed = false;

    for (const interaction of typed) {
        if (interaction.objections_raised) {
            allObjections.push(...interaction.objections_raised);
        }
        if (interaction.key_topics) {
            allTopics.push(...interaction.key_topics);
        }
        if (interaction.appointment_booked) {
            appointmentDiscussed = true;
        }
    }

    // Compute overall sentiment from recent interactions
    const overallSentiment = computeOverallSentiment(typed);

    // Days since first contact
    const oldest = typed[typed.length - 1];
    const daysSinceFirst = Math.floor(
        (Date.now() - new Date(oldest.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Build formatted timeline for voice agent injection
    const formattedTimeline = buildFormattedTimeline(typed.slice(0, MAX_TIMELINE_INTERACTIONS));

    // Extract last emotional analysis from the most recent interaction that has one
    const lastEA = typed.find(i => i.emotional_analysis);
    const lastEmotionalAnalysis = lastEA?.emotional_analysis as EmotionalAnalysis | null || null;

    return {
        last_interaction: lastInteraction ? {
            channel: lastInteraction.channel,
            direction: lastInteraction.direction,
            summary: lastInteraction.content_summary || truncate(lastInteraction.content_body || '', 100),
            outcome: lastInteraction.outcome,
            time_ago: formatDistanceToNow(new Date(lastInteraction.created_at), { addSuffix: true }),
            created_at: lastInteraction.created_at,
        } : null,

        last_call: lastCall ? {
            summary: lastCall.content_summary || truncate(lastCall.content_body || '', 200),
            disposition: lastCall.call_disposition,
            duration_seconds: lastCall.call_duration_seconds,
            objections: lastCall.objections_raised || [],
            key_topics: lastCall.key_topics || [],
            transcript_excerpt: truncate(lastCall.content_body || '', 500),
            was_answered: lastCall.call_disposition === 'answered' || lastCall.call_disposition === 'completed',
        } : null,

        last_sms_reply: lastSmsReply ? {
            body: lastSmsReply.content_body || '',
            intent: lastSmsReply.intent,
            sentiment: lastSmsReply.sentiment,
            time_ago: formatDistanceToNow(new Date(lastSmsReply.created_at), { addSuffix: true }),
        } : null,

        last_email: lastEmail ? {
            subject: lastEmail.content_subject,
            status: lastEmail.outcome,
        } : null,

        interaction_count: counts,
        overall_sentiment: overallSentiment,
        objections_history: [...new Set(allObjections)],
        key_topics_history: [...new Set(allTopics)],
        days_since_first_contact: daysSinceFirst,
        last_channel_used: lastInteraction?.channel || null,
        appointment_discussed: appointmentDiscussed,
        formatted_timeline: formattedTimeline,
        last_emotional_analysis: lastEmotionalAnalysis,
    };
}

/**
 * Build template variables from conversation context.
 * These are merged into the scheduler's variable map.
 */
export function buildTemplateVariables(ctx: ConversationContext): Record<string, string> {
    return {
        last_call_summary: ctx.last_call?.summary || '',
        last_call_disposition: ctx.last_call?.disposition || '',
        last_call_objections: ctx.last_call?.objections.join(', ') || '',
        last_call_topics: ctx.last_call?.key_topics.join(', ') || '',
        last_sms_reply: ctx.last_sms_reply?.body || '',
        last_sms_reply_intent: ctx.last_sms_reply?.intent || '',
        last_sms_reply_sentiment: ctx.last_sms_reply?.sentiment || '',
        last_email_subject: ctx.last_email?.subject || '',
        last_email_status: ctx.last_email?.status || '',
        overall_sentiment: ctx.overall_sentiment || 'neutral',
        objections_raised: ctx.objections_history.join(', ') || '',
        key_topics: ctx.key_topics_history.join(', ') || '',
        interaction_count: `${ctx.interaction_count.calls} calls, ${ctx.interaction_count.sms} SMS, ${ctx.interaction_count.emails} emails`,
        days_since_first_contact: String(ctx.days_since_first_contact),
        last_channel_used: ctx.last_channel_used || '',
        appointment_discussed: ctx.appointment_discussed ? 'yes' : 'no',
    };
}

/**
 * Build a voice agent context block that gets injected into system_prompt.
 * This gives the AI voice agent full awareness of prior interactions.
 */
export function buildVoiceAgentContext(ctx: ConversationContext): string {
    if (ctx.interaction_count.total === 0) {
        return 'This is the first interaction with this contact. No prior conversation history.';
    }

    let agentContext = 'CONVERSATION HISTORY WITH THIS CONTACT:\n';
    agentContext += ctx.formatted_timeline;
    agentContext += '\n\n';

    if (ctx.objections_history.length > 0) {
        agentContext += `KNOWN OBJECTIONS: ${ctx.objections_history.join(', ')}\n`;
        agentContext += 'Address these proactively if relevant.\n\n';
    }

    if (ctx.last_sms_reply) {
        agentContext += `LATEST SMS FROM CONTACT: "${ctx.last_sms_reply.body}"\n`;
        agentContext += `Their intent appears to be: ${ctx.last_sms_reply.intent || 'unknown'}\n\n`;
    }

    if (ctx.appointment_discussed) {
        agentContext += 'NOTE: An appointment has been discussed previously. Follow up on scheduling.\n\n';
    }

    agentContext += `OVERALL SENTIMENT: ${ctx.overall_sentiment}\n`;
    agentContext += `Total prior interactions: ${ctx.interaction_count.total} (${ctx.interaction_count.calls} calls, ${ctx.interaction_count.sms} SMS, ${ctx.interaction_count.emails} emails)\n`;

    // Add recent emotional analysis data if available
    if (ctx.last_emotional_analysis) {
        const ea = ctx.last_emotional_analysis;
        agentContext += `\nEMOTIONAL STATE: Customer's last detected emotion was "${ea.primary_emotion}" (confidence: ${Math.round(ea.emotion_confidence * 100)}%)\n`;

        if (ea.buying_signals && ea.buying_signals.length > 0) {
            agentContext += `BUYING SIGNALS: ${ea.buying_signals.map(s => s.signal).join('; ')}\n`;
        }
    }

    return agentContext;
}

// ═══════════════════════════════════════════════════════════════════
// Contact Summary Update
// ═══════════════════════════════════════════════════════════════════

/**
 * Regenerate the rolling conversation_summary on the contact record
 * using AI to summarize the latest interactions.
 * Called after significant inbound interactions (SMS reply, call end).
 */
export async function updateContactConversationSummary(contactId: string): Promise<void> {
    try {
        // Fetch the latest interactions
        const { data: interactions } = await supabase
            .from('contact_interactions')
            .select('channel, direction, content_body, content_summary, outcome, sentiment, intent, call_disposition, created_at')
            .eq('contact_id', contactId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (!interactions || interactions.length === 0) return;

        // Build a summary prompt
        const interactionLines = interactions.reverse().map((i: any) => {
            const dir = i.direction === 'inbound' ? '← INBOUND' : '→ OUTBOUND';
            const ch = i.channel.toUpperCase();
            const content = i.content_summary || truncate(i.content_body || '', 150);
            const outcome = i.outcome ? ` [${i.outcome}]` : '';
            return `${ch} ${dir}${outcome}: ${content}`;
        }).join('\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content: `Summarize this contact's conversation history in 2-3 sentences. Focus on: what they need, any objections, their level of interest, and next steps discussed.\n\nINTERACTIONS:\n${interactionLines}`,
            }],
            max_tokens: 200,
            temperature: 0.3,
        });

        const summary = response.choices[0]?.message?.content?.trim();
        if (!summary) return;

        await supabase
            .from('contacts')
            .update({
                conversation_summary: summary,
                updated_at: new Date().toISOString(),
            })
            .eq('id', contactId);

        console.log(`[MEMORY] Updated conversation summary for contact ${contactId}`);
    } catch (err) {
        console.error('[MEMORY] Error updating contact summary:', err);
    }
}

/**
 * Generate a quick 1-sentence summary for a single interaction.
 * Used when recording interactions to populate content_summary.
 */
export async function summarizeInteraction(
    channel: InteractionChannel,
    direction: InteractionDirection,
    content: string,
    outcome?: string
): Promise<string> {
    if (!content || content.length < 20) {
        return content || '';
    }

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content: `Summarize this ${direction} ${channel} interaction in one sentence (max 100 chars):\n${truncate(content, 500)}${outcome ? `\nOutcome: ${outcome}` : ''}`,
            }],
            max_tokens: 60,
            temperature: 0.2,
        });

        return response.choices[0]?.message?.content?.trim() || truncate(content, 100);
    } catch {
        return truncate(content, 100);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function buildEmptyContext(): ConversationContext {
    return {
        last_interaction: null,
        last_call: null,
        last_sms_reply: null,
        last_email: null,
        interaction_count: { total: 0, calls: 0, sms: 0, emails: 0, inbound: 0, outbound: 0 },
        overall_sentiment: 'neutral',
        objections_history: [],
        key_topics_history: [],
        days_since_first_contact: 0,
        last_channel_used: null,
        appointment_discussed: false,
        formatted_timeline: '',
        last_emotional_analysis: null,
    };
}

function computeOverallSentiment(interactions: ContactInteraction[]): InteractionSentiment {
    const sentiments = interactions
        .filter(i => i.sentiment)
        .map(i => i.sentiment!);

    if (sentiments.length === 0) return 'neutral';

    // Weight recent interactions more heavily
    const weights: Record<InteractionSentiment, number> = {
        positive: 2,
        interested: 2,
        neutral: 0,
        confused: -1,
        objection: -1,
        negative: -2,
    };

    let score = 0;
    for (let i = 0; i < sentiments.length; i++) {
        // More recent = higher multiplier (first item is most recent)
        const recencyMultiplier = 1 + (sentiments.length - i) / sentiments.length;
        score += (weights[sentiments[i]] || 0) * recencyMultiplier;
    }

    const avg = score / sentiments.length;

    if (avg > 1) return 'positive';
    if (avg > 0.3) return 'interested';
    if (avg > -0.3) return 'neutral';
    if (avg > -1) return 'objection';
    return 'negative';
}

function buildFormattedTimeline(interactions: ContactInteraction[]): string {
    // Reverse so oldest is first (chronological order)
    const chronological = [...interactions].reverse();

    return chronological.map(i => {
        const date = new Date(i.created_at);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const dir = i.direction === 'inbound' ? '← RECEIVED' : '→ SENT';
        const ch = i.channel.toUpperCase();
        const content = i.content_summary || truncate(i.content_body || '', 120);
        const outcome = i.outcome ? ` [${i.outcome}]` : '';

        return `- [${dateStr}, ${timeStr}] ${ch} ${dir}${outcome}: ${content}`;
    }).join('\n');
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}
