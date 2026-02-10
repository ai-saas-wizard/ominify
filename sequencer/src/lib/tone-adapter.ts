/**
 * Tone Adapter
 *
 * Adjusts outbound message tone based on the emotional state of the contact.
 * Injects tone directives into voice agent system prompts and provides
 * tone context for the Adaptive Mutation Engine (Phase 3).
 *
 * Used by:
 * - scheduler-worker: inject tone directives before dispatching
 * - sequence-mutator (Phase 3): guide content rewriting
 */

import type { RecommendedTone, SentimentTrend, PrimaryEmotion } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Tone Directive Generation
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a tone directive block for voice agent system prompt injection.
 * This tells the AI voice agent how to modulate its tone based on
 * the contact's emotional state.
 */
export function buildVoiceAgentToneDirective(params: {
    recommendedTone: RecommendedTone;
    sentimentTrend: SentimentTrend;
    lastEmotion: PrimaryEmotion | null;
    isHotLead: boolean;
    isAtRisk: boolean;
    needsHuman: boolean;
}): string {
    const { recommendedTone, sentimentTrend, lastEmotion, isHotLead, isAtRisk, needsHuman } = params;

    let directive = 'TONE & APPROACH GUIDANCE:\n';

    // Base tone
    directive += `- Primary tone: ${getToneDescription(recommendedTone)}\n`;

    // Sentiment trend adjustments
    switch (sentimentTrend) {
        case 'hot':
            directive += '- This contact is very engaged and warm. Be direct and move toward closing/booking.\n';
            directive += '- Minimize small talk, focus on next steps and availability.\n';
            break;
        case 'warming':
            directive += '- Sentiment is improving. Build on this momentum with confidence.\n';
            directive += '- Reference positive past interactions to reinforce rapport.\n';
            break;
        case 'cooling':
            directive += '- Sentiment is declining. Be extra attentive and empathetic.\n';
            directive += '- Ask open-ended questions to understand their concerns.\n';
            directive += '- Do NOT be pushy or aggressive.\n';
            break;
        case 'cold':
            directive += '- This contact has gone cold. Take a soft, low-pressure approach.\n';
            directive += '- Acknowledge the time gap if it has been a while.\n';
            directive += '- Focus on providing value rather than making asks.\n';
            break;
        default:
            // stable — no special adjustment
            break;
    }

    // Emotion-specific adjustments
    if (lastEmotion) {
        switch (lastEmotion) {
            case 'frustrated':
                directive += '- IMPORTANT: Customer was frustrated in their last interaction.\n';
                directive += '- Lead with empathy. Acknowledge their frustration before moving to business.\n';
                directive += '- Example: "I understand this process can be frustrating, and I want to make sure we get this right for you."\n';
                break;
            case 'angry':
                directive += '- WARNING: Customer was angry in their last interaction.\n';
                directive += '- Be calm, empathetic, and patient. Do not match their energy.\n';
                directive += '- If they remain upset, offer to connect them with a manager.\n';
                directive += '- Do NOT try to close or sell on this call.\n';
                break;
            case 'confused':
                directive += '- Customer seemed confused previously. Be clear and straightforward.\n';
                directive += '- Break down information into simple steps.\n';
                directive += '- Ask "Does that make sense?" after key points.\n';
                break;
            case 'hesitant':
                directive += '- Customer is hesitant. Be reassuring without being pushy.\n';
                directive += '- Address uncertainties with social proof or guarantees.\n';
                break;
            case 'excited':
                directive += '- Customer is excited! Match their energy positively.\n';
                directive += '- Guide them toward booking/next steps while enthusiasm is high.\n';
                break;
        }
    }

    // Hot lead urgency
    if (isHotLead) {
        directive += '- HIGH PRIORITY: This is a hot lead with buying signals. Focus on closing.\n';
        directive += '- Have pricing, availability, and booking options ready.\n';
    }

    // At-risk handling
    if (isAtRisk) {
        directive += '- CAUTION: This contact is at risk of disengaging.\n';
        directive += '- Be concise and respectful of their time.\n';
        directive += '- Offer a compelling reason to stay engaged (special offer, urgency, new info).\n';
    }

    // Human escalation hint
    if (needsHuman) {
        directive += '- NOTE: This contact has been flagged for human attention.\n';
        directive += '- If they request a human at any point, transfer immediately.\n';
        directive += '- Keep the interaction brief and helpful.\n';
    }

    return directive;
}

/**
 * Get tone-adjusted template variables for SMS/email.
 * These can be used in templates to adjust messaging style.
 */
export function getToneTemplateVariables(params: {
    recommendedTone: RecommendedTone;
    sentimentTrend: SentimentTrend;
    lastEmotion: PrimaryEmotion | null;
    isHotLead: boolean;
    isAtRisk: boolean;
    engagementScore: number;
}): Record<string, string> {
    const { recommendedTone, sentimentTrend, lastEmotion, isHotLead, isAtRisk, engagementScore } = params;

    return {
        // Tone context
        recommended_tone: recommendedTone,
        sentiment_trend: sentimentTrend,
        last_emotion: lastEmotion || 'neutral',

        // Lead status
        lead_temperature: isHotLead ? 'hot' : isAtRisk ? 'cold' : engagementScore > 65 ? 'warm' : 'neutral',
        engagement_score: String(engagementScore),

        // Greeting style based on tone
        tone_greeting: getToneGreeting(recommendedTone, lastEmotion),

        // CTA style based on engagement
        tone_cta: getToCtaStyle(isHotLead, isAtRisk, sentimentTrend),
    };
}

// ═══════════════════════════════════════════════════════════════════
// Scheduling Adjustments
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate delay adjustments based on emotional state.
 * Returns a multiplier for the step's delay_seconds.
 *
 * - Hot/warming → reduce delay (strike while iron is hot)
 * - Cooling → increase delay (give space)
 * - At risk → moderate increase (don't overwhelm)
 */
export function getEmotionBasedDelayMultiplier(params: {
    sentimentTrend: SentimentTrend;
    isHotLead: boolean;
    isAtRisk: boolean;
    lastEmotion: PrimaryEmotion | null;
}): number {
    const { sentimentTrend, isHotLead, isAtRisk, lastEmotion } = params;

    // Hot lead: speed up by 40%
    if (isHotLead && sentimentTrend === 'hot') return 0.6;

    // Warming trend: speed up by 20%
    if (sentimentTrend === 'warming' || sentimentTrend === 'hot') return 0.8;

    // Cooling: slow down by 50%
    if (sentimentTrend === 'cooling') return 1.5;

    // Cold: slow down by 100% (double the delay)
    if (sentimentTrend === 'cold') return 2.0;

    // Angry/frustrated: give space, slow down by 80%
    if (lastEmotion === 'angry' || lastEmotion === 'frustrated') return 1.8;

    // At risk but not cooling: moderate slow-down
    if (isAtRisk) return 1.3;

    return 1.0; // No adjustment
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getToneDescription(tone: RecommendedTone): string {
    switch (tone) {
        case 'empathetic':
            return 'Empathetic and understanding. Show genuine care for their situation.';
        case 'urgent':
            return 'Create gentle urgency. Convey time-sensitive value without being pushy.';
        case 'casual':
            return 'Casual and friendly. Keep it conversational and relatable.';
        case 'professional':
            return 'Professional and polished. Clear, respectful, and business-like.';
        case 'reassuring':
            return 'Reassuring and confidence-building. Address concerns proactively.';
        default:
            return 'Professional and warm.';
    }
}

function getToneGreeting(tone: RecommendedTone, lastEmotion: PrimaryEmotion | null): string {
    if (lastEmotion === 'angry' || lastEmotion === 'frustrated') {
        return "I appreciate you taking the time to connect";
    }

    switch (tone) {
        case 'empathetic':
            return "I hope you're doing well";
        case 'urgent':
            return "I wanted to reach out quickly";
        case 'casual':
            return "Hey! Just checking in";
        case 'professional':
            return "Thank you for your time";
        case 'reassuring':
            return "I wanted to follow up and make sure everything is clear";
        default:
            return "Hi there";
    }
}

function getToCtaStyle(isHotLead: boolean, isAtRisk: boolean, trend: SentimentTrend): string {
    if (isHotLead) {
        return "Let's get this scheduled — when works best for you?";
    }
    if (isAtRisk || trend === 'cold') {
        return "No pressure at all — just let me know if you have any questions.";
    }
    if (trend === 'warming' || trend === 'hot') {
        return "Would you like to schedule a time to discuss further?";
    }
    return "Feel free to reply anytime — happy to help.";
}
