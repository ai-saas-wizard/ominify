/**
 * Emotional Intelligence Layer
 *
 * Replaces the keyword-based classifyReplyIntent with deep LLM-powered analysis.
 * Detects emotion, urgency, objection type, buying signals, and recommended next action.
 * Feeds into Conversation Memory (Phase 1) and will feed into Adaptive Mutation (Phase 3).
 *
 * Used by:
 * - event-processor: analyze inbound SMS replies + call transcripts
 * - scheduler-worker: emotion-aware scheduling decisions
 * - conversation-memory: emotional state template variables
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import type {
    EmotionalAnalysis,
    ContactInteraction,
    SentimentTrend,
    PrimaryEmotion,
    InteractionChannel,
    RecommendedTone,
} from './types.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// Core Analysis Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze an inbound SMS or email message using GPT-4o.
 * Returns a full EmotionalAnalysis object with emotion, intent,
 * objections, buying signals, and recommended action.
 */
export async function analyzeMessage(
    messageBody: string,
    channel: InteractionChannel,
    conversationHistory?: string
): Promise<EmotionalAnalysis> {
    try {
        const systemPrompt = `You are an expert sales communication analyst. Analyze the customer's message and provide a detailed emotional intelligence assessment.

You must respond with a valid JSON object matching this exact structure:
{
    "primary_emotion": one of ["excited", "interested", "neutral", "hesitant", "frustrated", "confused", "angry", "dismissive"],
    "emotion_confidence": number between 0 and 1,
    "intent": one of ["interested", "not_interested", "stop", "reschedule", "question", "unknown", "objection", "ready_to_buy", "needs_info"],
    "objections": [{"type": one of ["price", "timing", "competitor", "authority", "need", "trust", "urgency"], "detail": "brief description", "severity": one of ["mild", "moderate", "strong"]}],
    "buying_signals": [{"signal": "brief description", "strength": one of ["weak", "moderate", "strong"]}],
    "urgency_level": one of ["immediate", "soon", "flexible", "no_rush", "lost"],
    "recommended_action": one of ["escalate_to_human", "continue_sequence", "pause_and_notify", "fast_track", "end_sequence", "switch_channel", "address_objection"],
    "recommended_channel": one of ["sms", "email", "voice", "any"],
    "recommended_tone": one of ["empathetic", "urgent", "casual", "professional", "reassuring"],
    "action_reason": "brief explanation of why this action is recommended",
    "needs_human_intervention": boolean,
    "is_hot_lead": boolean,
    "is_at_risk": boolean
}

Rules:
- Set is_hot_lead=true if there are strong buying signals or intent is "ready_to_buy" or "interested" with urgency
- Set is_at_risk=true if sentiment is negative, emotion is frustrated/angry/dismissive, or they seem about to disengage
- Set needs_human_intervention=true for angry customers, complex objections, ready-to-buy leads, or when the customer explicitly asks to speak with a person
- If intent is "stop", always set recommended_action="end_sequence"
- If emotion is "angry" or "frustrated", set recommended_tone="empathetic"
- Buying signals include: asking about pricing, availability, next steps, how to proceed, specific service details
- Be conservative with emotion_confidence unless the signal is very clear`;

        const userMessage = conversationHistory
            ? `CONVERSATION HISTORY:\n${conversationHistory}\n\nLATEST ${channel.toUpperCase()} MESSAGE FROM CUSTOMER:\n"${messageBody}"`
            : `${channel.toUpperCase()} MESSAGE FROM CUSTOMER:\n"${messageBody}"`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.2,
            max_tokens: 500,
            response_format: { type: 'json_object' },
        });

        const result = response.choices[0]?.message?.content;
        if (!result) {
            return buildFallbackAnalysis(messageBody);
        }

        const analysis = JSON.parse(result) as EmotionalAnalysis;
        return validateAnalysis(analysis);
    } catch (err) {
        console.error('[EI] Error analyzing message:', err);
        return buildFallbackAnalysis(messageBody);
    }
}

/**
 * Analyze a call transcript using GPT-4o.
 * Specialized for voice — detects tone shifts, engagement,
 * objection patterns, and booking intent from full transcripts.
 */
export async function analyzeCallTranscript(
    transcript: string,
    duration: number,
    disposition: string
): Promise<EmotionalAnalysis> {
    try {
        // Don't analyze very short or empty transcripts
        if (!transcript || transcript.length < 30) {
            return buildCallFallbackAnalysis(disposition, duration);
        }

        const systemPrompt = `You are an expert at analyzing sales call transcripts. Analyze the full conversation between the sales agent and the customer. Focus on the CUSTOMER's emotional state, not the agent's.

You must respond with a valid JSON object matching this exact structure:
{
    "primary_emotion": one of ["excited", "interested", "neutral", "hesitant", "frustrated", "confused", "angry", "dismissive"],
    "emotion_confidence": number between 0 and 1,
    "intent": one of ["interested", "not_interested", "stop", "reschedule", "question", "unknown", "objection", "ready_to_buy", "needs_info"],
    "objections": [{"type": one of ["price", "timing", "competitor", "authority", "need", "trust", "urgency"], "detail": "brief description", "severity": one of ["mild", "moderate", "strong"]}],
    "buying_signals": [{"signal": "brief description", "strength": one of ["weak", "moderate", "strong"]}],
    "urgency_level": one of ["immediate", "soon", "flexible", "no_rush", "lost"],
    "recommended_action": one of ["escalate_to_human", "continue_sequence", "pause_and_notify", "fast_track", "end_sequence", "switch_channel", "address_objection"],
    "recommended_channel": one of ["sms", "email", "voice", "any"],
    "recommended_tone": one of ["empathetic", "urgent", "casual", "professional", "reassuring"],
    "action_reason": "brief explanation",
    "needs_human_intervention": boolean,
    "is_hot_lead": boolean,
    "is_at_risk": boolean
}

Additional call-specific rules:
- Long calls (>2 min) with engaged conversation → likely interested
- Customer asking detailed questions about pricing/availability → buying signal
- If appointment was discussed but not booked → set recommended_action="fast_track"
- If customer said they'll think about it → "hesitant", recommend follow-up via SMS
- Voicemail dispositions with no real conversation → "neutral" with low confidence
- If call was very short (<30s) and no real conversation → minimal analysis`;

        const userMessage = `CALL DETAILS:
Duration: ${duration} seconds
Disposition: ${disposition}

TRANSCRIPT:
${truncate(transcript, 3000)}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.2,
            max_tokens: 500,
            response_format: { type: 'json_object' },
        });

        const result = response.choices[0]?.message?.content;
        if (!result) {
            return buildCallFallbackAnalysis(disposition, duration);
        }

        const analysis = JSON.parse(result) as EmotionalAnalysis;
        return validateAnalysis(analysis);
    } catch (err) {
        console.error('[EI] Error analyzing call transcript:', err);
        return buildCallFallbackAnalysis(disposition, duration);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Engagement & Trend Scoring
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute an engagement score (0-100) based on recent interactions.
 * Considers: reply rate, response speed, sentiment trend, channel engagement.
 * Decays over time (recent interactions weighted more).
 */
export function computeEngagementScore(interactions: ContactInteraction[]): number {
    if (interactions.length === 0) return 50; // Default neutral

    let score = 50; // Start at neutral

    // Factor 1: Inbound interaction ratio (replies, answers) — max +20
    const inbound = interactions.filter(i => i.direction === 'inbound');
    const inboundRatio = inbound.length / interactions.length;
    score += Math.round(inboundRatio * 20);

    // Factor 2: Sentiment of recent interactions — max +/- 15
    const recentSentiments = interactions.slice(0, 5);
    for (let i = 0; i < recentSentiments.length; i++) {
        const recencyWeight = 1 - (i * 0.15); // More recent = more weight
        const sentiment = recentSentiments[i].sentiment;

        if (sentiment === 'positive' || sentiment === 'interested') {
            score += Math.round(3 * recencyWeight);
        } else if (sentiment === 'negative') {
            score -= Math.round(4 * recencyWeight);
        } else if (sentiment === 'objection') {
            score -= Math.round(2 * recencyWeight);
        }
    }

    // Factor 3: Call answers vs no-answers — max +/- 10
    const calls = interactions.filter(i => i.channel === 'voice');
    if (calls.length > 0) {
        const answeredCalls = calls.filter(i =>
            i.call_disposition === 'answered' || i.call_disposition === 'completed'
        );
        const answerRate = answeredCalls.length / calls.length;
        score += Math.round((answerRate - 0.3) * 15); // 30% answer rate is baseline
    }

    // Factor 4: Appointment discussed or booked — +10
    if (interactions.some(i => i.appointment_booked)) {
        score += 10;
    }

    // Factor 5: Recent activity decay
    // If no interaction in last 3+ days, reduce score
    const lastInteractionTime = new Date(interactions[0].created_at).getTime();
    const daysSinceLastInteraction = (Date.now() - lastInteractionTime) / (1000 * 60 * 60 * 24);
    if (daysSinceLastInteraction > 3) {
        score -= Math.min(15, Math.round(daysSinceLastInteraction * 2));
    }

    // Factor 6: Emotional analysis flags
    for (const interaction of interactions.slice(0, 3)) {
        const ea = interaction.emotional_analysis as EmotionalAnalysis | null;
        if (ea) {
            if (ea.is_hot_lead) score += 5;
            if (ea.is_at_risk) score -= 5;
            if (ea.buying_signals && ea.buying_signals.length > 0) {
                score += ea.buying_signals.length * 2;
            }
        }
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Detect the sentiment trend across recent interactions.
 * Returns: 'warming', 'stable', 'cooling', 'hot', 'cold'
 */
export function detectSentimentTrend(interactions: ContactInteraction[]): SentimentTrend {
    if (interactions.length < 2) return 'stable';

    const sentimentScores: Record<string, number> = {
        positive: 2,
        interested: 2,
        neutral: 0,
        confused: -0.5,
        objection: -1,
        negative: -2,
    };

    // Split interactions into two halves (recent vs older)
    const midpoint = Math.floor(interactions.length / 2);
    const recent = interactions.slice(0, midpoint);
    const older = interactions.slice(midpoint);

    const avgScore = (items: ContactInteraction[]) => {
        const scored = items.filter(i => i.sentiment);
        if (scored.length === 0) return 0;
        const total = scored.reduce((sum, i) => sum + (sentimentScores[i.sentiment!] || 0), 0);
        return total / scored.length;
    };

    const recentAvg = avgScore(recent);
    const olderAvg = avgScore(older);
    const diff = recentAvg - olderAvg;

    // Also check the absolute recent score
    if (recentAvg >= 1.5) return 'hot';
    if (recentAvg <= -1.5) return 'cold';

    // Check the trend
    if (diff > 0.8) return 'warming';
    if (diff < -0.8) return 'cooling';
    return 'stable';
}

// ═══════════════════════════════════════════════════════════════════
// Notification Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a notification in the tenant_notifications table.
 * Called by event-processor when EI analysis detects actionable signals.
 */
export async function createNotification(params: {
    clientId: string;
    enrollmentId?: string;
    contactId?: string;
    type: 'hot_lead' | 'needs_human' | 'objection_detected' | 'sentiment_drop' | 'appointment_booked' | 'sequence_completed' | 'escalation' | 'at_risk';
    title: string;
    body?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    metadata?: Record<string, any>;
}): Promise<void> {
    try {
        await supabase
            .from('tenant_notifications')
            .insert({
                client_id: params.clientId,
                enrollment_id: params.enrollmentId || null,
                contact_id: params.contactId || null,
                type: params.type,
                title: params.title,
                body: params.body || null,
                priority: params.priority || 'normal',
                metadata: params.metadata || {},
            });

        console.log(`[EI] Created notification: ${params.type} - ${params.title}`);
    } catch (err) {
        console.error('[EI] Error creating notification:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Enrollment State Updates
// ═══════════════════════════════════════════════════════════════════

/**
 * Update enrollment with emotional intelligence data.
 * Called after every EI analysis to keep enrollment state current.
 */
export async function updateEnrollmentEI(
    enrollmentId: string,
    analysis: EmotionalAnalysis,
    interactions: ContactInteraction[]
): Promise<void> {
    try {
        const engagementScore = computeEngagementScore(interactions);
        const sentimentTrend = detectSentimentTrend(interactions);

        // Merge new objections with existing
        const newObjections = analysis.objections.map(o => ({
            type: o.type,
            detail: o.detail,
            severity: o.severity,
        }));

        // Get existing objections
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('objections_detected')
            .eq('id', enrollmentId)
            .single();

        const existingObjections = (enrollment?.objections_detected as any[]) || [];

        // Merge — deduplicate by type+detail
        const allObjections = [...existingObjections];
        for (const obj of newObjections) {
            const exists = allObjections.some(
                (e: any) => e.type === obj.type && e.detail === obj.detail
            );
            if (!exists) {
                allObjections.push(obj);
            }
        }

        await supabase
            .from('sequence_enrollments')
            .update({
                engagement_score: engagementScore,
                sentiment_trend: sentimentTrend,
                needs_human_intervention: analysis.needs_human_intervention,
                last_emotion: analysis.primary_emotion,
                objections_detected: allObjections,
                recommended_tone: analysis.recommended_tone,
                is_hot_lead: analysis.is_hot_lead,
                is_at_risk: analysis.is_at_risk,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        // Also update the contact's global engagement score
        const { data: enroll } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .single();

        if (enroll?.contact_id) {
            await supabase
                .from('contacts')
                .update({
                    engagement_score: engagementScore,
                    sentiment_trend: sentimentTrend,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enroll.contact_id);
        }

        console.log(`[EI] Updated enrollment ${enrollmentId}: emotion=${analysis.primary_emotion}, engagement=${engagementScore}, trend=${sentimentTrend}`);
    } catch (err) {
        console.error('[EI] Error updating enrollment EI:', err);
    }
}

/**
 * Generate notifications based on EI analysis results.
 * Called after every analysis to alert the tenant of actionable signals.
 */
export async function generateEINotifications(
    clientId: string,
    contactId: string,
    enrollmentId: string,
    analysis: EmotionalAnalysis,
    contactName?: string
): Promise<void> {
    const name = contactName || 'A contact';

    // Hot lead notification
    if (analysis.is_hot_lead) {
        await createNotification({
            clientId,
            enrollmentId,
            contactId,
            type: 'hot_lead',
            title: `${name} is showing strong buying signals`,
            body: analysis.buying_signals.map(s => s.signal).join('. ') || analysis.action_reason,
            priority: 'high',
            metadata: { buying_signals: analysis.buying_signals },
        });
    }

    // Needs human intervention
    if (analysis.needs_human_intervention) {
        await createNotification({
            clientId,
            enrollmentId,
            contactId,
            type: 'needs_human',
            title: `${name} needs human attention`,
            body: analysis.action_reason,
            priority: 'urgent',
            metadata: { emotion: analysis.primary_emotion, reason: analysis.action_reason },
        });
    }

    // Objection detected (only for strong objections)
    const strongObjections = analysis.objections.filter(o => o.severity === 'strong');
    if (strongObjections.length > 0) {
        await createNotification({
            clientId,
            enrollmentId,
            contactId,
            type: 'objection_detected',
            title: `Strong objection from ${name}`,
            body: strongObjections.map(o => `${o.type}: ${o.detail}`).join('; '),
            priority: 'high',
            metadata: { objections: strongObjections },
        });
    }

    // At risk — about to disengage
    if (analysis.is_at_risk) {
        await createNotification({
            clientId,
            enrollmentId,
            contactId,
            type: 'at_risk',
            title: `${name} may be disengaging`,
            body: analysis.action_reason,
            priority: 'high',
            metadata: { emotion: analysis.primary_emotion, urgency: analysis.urgency_level },
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// Fallback Analysis (when OpenAI is unavailable)
// ═══════════════════════════════════════════════════════════════════

/**
 * Keyword-based fallback when GPT-4o is unavailable.
 * Preserves backward-compatible behavior with classifyReplyIntent.
 */
function buildFallbackAnalysis(messageBody: string): EmotionalAnalysis {
    const lower = messageBody.toLowerCase();

    // Basic intent detection (same as old classifyReplyIntent)
    let intent: EmotionalAnalysis['intent'] = 'unknown';
    let emotion: PrimaryEmotion = 'neutral';
    let isHotLead = false;
    let isAtRisk = false;
    let needsHuman = false;

    if (['stop', 'unsubscribe', 'remove', 'opt out', 'dont text', "don't text"].some(kw => lower.includes(kw))) {
        intent = 'stop';
        emotion = 'dismissive';
        isAtRisk = true;
    } else if (['not interested', 'no thanks', 'no thank you', 'remove me'].some(kw => lower.includes(kw))) {
        intent = 'not_interested';
        emotion = 'dismissive';
        isAtRisk = true;
    } else if (['yes', 'interested', 'call me', 'tell me more', 'more info', 'how much', 'pricing', 'cost', 'available'].some(kw => lower.includes(kw))) {
        intent = 'interested';
        emotion = 'interested';
        isHotLead = lower.includes('how much') || lower.includes('pricing') || lower.includes('available');
    } else if (['reschedule', 'different time', 'not now', 'later', 'busy'].some(kw => lower.includes(kw))) {
        intent = 'reschedule';
        emotion = 'hesitant';
    } else if (['angry', 'upset', 'terrible', 'horrible', 'worst', 'scam'].some(kw => lower.includes(kw))) {
        emotion = 'angry';
        intent = 'not_interested';
        needsHuman = true;
        isAtRisk = true;
    } else if (lower.includes('?')) {
        intent = 'question';
        emotion = 'interested';
    }

    return {
        primary_emotion: emotion,
        emotion_confidence: 0.5,
        intent,
        objections: [],
        buying_signals: isHotLead ? [{ signal: 'Asked about pricing/availability', strength: 'moderate' }] : [],
        urgency_level: 'flexible',
        recommended_action: intent === 'stop' ? 'end_sequence' : needsHuman ? 'escalate_to_human' : 'continue_sequence',
        recommended_channel: 'any',
        recommended_tone: emotion === 'angry' ? 'empathetic' : 'professional',
        action_reason: 'Fallback keyword analysis (OpenAI unavailable)',
        needs_human_intervention: needsHuman,
        is_hot_lead: isHotLead,
        is_at_risk: isAtRisk,
    };
}

/**
 * Fallback for call analysis when transcript is unavailable or GPT fails.
 */
function buildCallFallbackAnalysis(disposition: string, duration: number): EmotionalAnalysis {
    const wasAnswered = disposition === 'answered' || disposition === 'completed';
    const wasVoicemail = disposition === 'voicemail';

    return {
        primary_emotion: wasAnswered ? (duration > 60 ? 'interested' : 'neutral') : 'neutral',
        emotion_confidence: wasAnswered ? 0.4 : 0.2,
        intent: wasAnswered ? 'interested' : 'unknown',
        objections: [],
        buying_signals: [],
        urgency_level: 'flexible',
        recommended_action: wasAnswered ? 'continue_sequence' : 'continue_sequence',
        recommended_channel: wasVoicemail ? 'sms' : 'any',
        recommended_tone: 'professional',
        action_reason: wasAnswered
            ? `Call answered (${duration}s) — no transcript available for analysis`
            : `Call ${disposition} — no transcript available`,
        needs_human_intervention: false,
        is_hot_lead: false,
        is_at_risk: !wasAnswered && !wasVoicemail,
    };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate and sanitize an EmotionalAnalysis object from GPT response.
 */
function validateAnalysis(analysis: EmotionalAnalysis): EmotionalAnalysis {
    const validEmotions: PrimaryEmotion[] = [
        'excited', 'interested', 'neutral', 'hesitant',
        'frustrated', 'confused', 'angry', 'dismissive',
    ];

    const validTones: RecommendedTone[] = [
        'empathetic', 'urgent', 'casual', 'professional', 'reassuring',
    ];

    return {
        primary_emotion: validEmotions.includes(analysis.primary_emotion) ? analysis.primary_emotion : 'neutral',
        emotion_confidence: Math.max(0, Math.min(1, analysis.emotion_confidence || 0.5)),
        intent: analysis.intent || 'unknown',
        objections: Array.isArray(analysis.objections) ? analysis.objections : [],
        buying_signals: Array.isArray(analysis.buying_signals) ? analysis.buying_signals : [],
        urgency_level: analysis.urgency_level || 'flexible',
        recommended_action: analysis.recommended_action || 'continue_sequence',
        recommended_channel: analysis.recommended_channel || 'any',
        recommended_tone: validTones.includes(analysis.recommended_tone) ? analysis.recommended_tone : 'professional',
        action_reason: analysis.action_reason || '',
        needs_human_intervention: !!analysis.needs_human_intervention,
        is_hot_lead: !!analysis.is_hot_lead,
        is_at_risk: !!analysis.is_at_risk,
    };
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}
