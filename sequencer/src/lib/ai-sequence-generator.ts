/**
 * AI Sequence Generator
 * 
 * After a tenant completes onboarding, this generates
 * AI-powered multi-channel follow-up sequences.
 */

import OpenAI from 'openai';
import { supabase } from './db.js';
import type { TenantProfile, Sequence, SequenceStep, UrgencyTier, ChannelType } from './types.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60_000,
    maxRetries: 1,
});

interface GeneratedSequence {
    name: string;
    description: string;
    trigger_conditions: {
        lead_source?: string[];
        job_type_keywords?: string[];
        urgency_tier: UrgencyTier;
    };
    steps: Array<{
        step_order: number;
        channel: ChannelType;
        delay_seconds: number;
        delay_type: 'after_previous' | 'after_enrollment';
        content: any;
        skip_conditions?: { skip_if?: string[] };
        on_success?: { action: string; target_step?: number };
        on_failure?: { action: string; retry_delay?: number };
    }>;
}

const VALID_CHANNELS: ChannelType[] = ['sms', 'email', 'voice'];

/**
 * Validate model-generated steps before persisting (the model output was
 * previously trusted blindly). Rejects and logs steps with an unknown
 * channel, non-positive or duplicate step_order, negative delay, or empty
 * content for the channel.
 */
function validateGeneratedSteps(seq: GeneratedSequence): GeneratedSequence['steps'] {
    const seenOrders = new Set<number>();
    const valid: GeneratedSequence['steps'] = [];

    for (const step of seq.steps || []) {
        const reject = (reason: string) => {
            console.error(`[AI] Rejecting invalid step in "${seq.name}" (order=${step?.step_order}, channel=${step?.channel}): ${reason}`);
        };

        if (!step || typeof step !== 'object') { reject('not an object'); continue; }
        if (!VALID_CHANNELS.includes(step.channel)) { reject(`unknown channel "${step.channel}"`); continue; }
        if (typeof step.step_order !== 'number' || !Number.isInteger(step.step_order) || step.step_order <= 0) {
            reject('step_order must be a positive integer'); continue;
        }
        if (seenOrders.has(step.step_order)) { reject('duplicate step_order'); continue; }
        if (typeof step.delay_seconds !== 'number' || !Number.isFinite(step.delay_seconds) || step.delay_seconds < 0) {
            reject('delay_seconds must be a number >= 0'); continue;
        }

        const content = step.content;
        if (!content || typeof content !== 'object') { reject('missing content'); continue; }
        if (step.channel === 'sms' && !(typeof content.body === 'string' && content.body.trim().length > 0)) {
            reject('SMS content missing body'); continue;
        }
        if (step.channel === 'email' && !(
            typeof content.subject === 'string' && content.subject.trim().length > 0 &&
            ((typeof content.body_html === 'string' && content.body_html.trim().length > 0) ||
             (typeof content.body_text === 'string' && content.body_text.trim().length > 0))
        )) {
            reject('email content missing subject or body'); continue;
        }
        if (step.channel === 'voice' && !(
            (typeof content.first_message === 'string' && content.first_message.trim().length > 0) ||
            (typeof content.system_prompt === 'string' && content.system_prompt.trim().length > 0)
        )) {
            reject('voice content missing first_message/system_prompt'); continue;
        }

        seenOrders.add(step.step_order);
        valid.push(step);
    }

    return valid;
}

/**
 * Get tenant profile
 */
async function getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
    const { data, error } = await supabase
        .from('tenant_profiles')
        .select('*')
        .eq('client_id', tenantId)
        .single();

    if (error || !data) {
        console.error(`[AI] No tenant profile for ${tenantId}`);
        return null;
    }

    return data as TenantProfile;
}

/**
 * Generate sequences from onboarding data
 */
export async function generateSequencesFromOnboarding(tenantId: string): Promise<void> {
    const profile = await getTenantProfile(tenantId);

    if (!profile) {
        throw new Error(`Tenant profile not found: ${tenantId}`);
    }

    console.log(`[AI] Generating sequences for tenant ${tenantId} (${profile.industry})`);

    const prompt = `
You are a marketing automation expert. Based on this business profile, generate 
optimized multi-channel follow-up sequences.

BUSINESS PROFILE:
- Industry: ${profile.industry} (${profile.sub_industry || 'general'})
- Service area: ${JSON.stringify(profile.service_area)}
- Job types: ${JSON.stringify(profile.job_types)}
- Brand voice: ${profile.brand_voice}
- Custom phrases: ${JSON.stringify(profile.custom_phrases)}
- Business hours: ${JSON.stringify(profile.business_hours)}
- Primary goal: ${profile.primary_goal}
- Lead sources: ${JSON.stringify(profile.lead_sources)}

RULES:
1. Generate one sequence per urgency tier (critical, high, medium, low)
2. Critical urgency: 6-8 touches in first 4 hours, aggressive multi-channel
3. High urgency: 5-6 touches in 24 hours
4. Medium urgency: 4-5 touches over 48 hours  
5. Low urgency: 3-4 touches over 2 weeks
6. Always start with a voice call for critical/high urgency
7. SMS within 2 minutes if call not answered
8. Respect TCPA: no calls/texts before 8am or after 9pm local time
9. Include the brand's custom phrases naturally
10. Voice scripts should be conversational, not robotic
11. Use skip_conditions to avoid redundant outreach after success

OUTPUT FORMAT:
Return a JSON object with a "sequences" array. Each sequence must have:
{
  "sequences": [{
    "name": "string - descriptive name",
    "description": "string - what triggers this sequence",
    "trigger_conditions": { 
      "lead_source": ["string array - optional"],
      "job_type_keywords": ["string array - optional"],
      "urgency_tier": "critical|high|medium|low"
    },
    "steps": [{
      "step_order": 1,
      "channel": "sms|email|voice",
      "delay_seconds": 0,
      "delay_type": "after_previous",
      "content": {
        // SMS: { "body": "string" }
        // Email: { "subject": "string", "body_html": "string", "body_text": "string" }
        // Voice: { "first_message": "string", "system_prompt": "string" }
      },
      "skip_conditions": { "skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"] },
      "on_success": { "action": "continue|end_sequence" },
      "on_failure": { "action": "retry_after_seconds|skip", "retry_delay": 300 }
    }]
  }]
}
`;

    try {
        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.7,
        });

        const content = aiResponse.choices[0].message.content;
        if (!content) {
            throw new Error('Empty AI response');
        }

        const generated = JSON.parse(content) as { sequences: GeneratedSequence[] };

        console.log(`[AI] Generated ${generated.sequences.length} sequences`);

        // Persist generated sequences to DB
        for (const seq of generated.sequences) {
            // Validate the model output before persisting anything
            const validSteps = validateGeneratedSteps(seq);
            if (validSteps.length === 0) {
                console.error(`[AI] Sequence "${seq.name}" has no valid steps after validation — skipping`);
                continue;
            }

            // Create sequence
            const { data: sequenceData, error: seqError } = await supabase
                .from('sequences')
                .insert({
                    client_id: tenantId,
                    name: seq.name,
                    description: seq.description,
                    trigger_conditions: seq.trigger_conditions,
                    urgency_tier: seq.trigger_conditions.urgency_tier,
                    generated_by_ai: true,
                    generation_prompt: prompt,
                    is_active: true,
                })
                .select('id')
                .single();

            if (seqError || !sequenceData) {
                console.error(`[AI] Failed to create sequence: ${seqError?.message}`);
                continue;
            }

            const sequenceId = sequenceData.id;
            console.log(`[AI] Created sequence: ${seq.name} (${sequenceId})`);

            // Create steps
            for (const step of validSteps) {
                const mutationInstructions = step.channel === 'sms'
                    ? 'Keep under 160 chars. Reference prior conversation naturally. Match brand voice.'
                    : step.channel === 'email'
                    ? 'Reference prior interactions in the opening. Address known objections. Keep professional tone.'
                    : step.channel === 'voice'
                    ? 'Adjust opening based on prior calls. Reference any objections or topics discussed.'
                    : null;

                const { error: stepError } = await supabase
                    .from('sequence_steps')
                    .insert({
                        sequence_id: sequenceId,
                        step_order: step.step_order,
                        channel: step.channel,
                        delay_minutes: Math.max(0, Math.round((step.delay_seconds || 0) / 60)),
                        delay_type: step.delay_type,
                        content: step.content,
                        skip_conditions: step.skip_conditions,
                        on_success: step.on_success,
                        on_failure: step.on_failure,
                        enable_ai_mutation: true,
                        mutation_instructions: mutationInstructions,
                    });

                if (stepError) {
                    console.error(`[AI] Failed to create step: ${stepError.message}`);
                }
            }
        }

        console.log(`[AI] Sequence generation complete for tenant ${tenantId}`);
    } catch (error: any) {
        console.error(`[AI] Sequence generation failed: ${error.message}`);
        throw error;
    }
}

/**
 * Regenerate sequences for a tenant
 */
export async function regenerateSequences(tenantId: string): Promise<void> {
    // Snapshot the currently-active AI-generated sequences FIRST, then
    // generate the new ones, and only deactivate the old set once the new
    // generation persisted. Deactivating up front meant a generation
    // failure left the tenant with zero active sequences.
    const { data: oldSequences, error: snapshotErr } = await supabase
        .from('sequences')
        .select('id')
        .eq('client_id', tenantId)
        .eq('generated_by_ai', true)
        .eq('is_active', true);

    if (snapshotErr) {
        console.error(`[AI] Failed to snapshot existing sequences for ${tenantId}: ${snapshotErr.message}`);
        throw new Error(`Failed to snapshot existing sequences: ${snapshotErr.message}`);
    }

    // Generate new ones (throws on failure — old sequences stay active)
    await generateSequencesFromOnboarding(tenantId);

    // New sequences are live — retire the old set
    const oldIds = (oldSequences || []).map(s => s.id);
    if (oldIds.length > 0) {
        const { error: deactivateErr } = await supabase
            .from('sequences')
            .update({ is_active: false })
            .in('id', oldIds);

        if (deactivateErr) {
            console.error(`[AI] Failed to deactivate ${oldIds.length} old sequences for ${tenantId}: ${deactivateErr.message}`);
        } else {
            console.log(`[AI] Deactivated ${oldIds.length} old AI-generated sequences for ${tenantId}`);
        }
    }
}
