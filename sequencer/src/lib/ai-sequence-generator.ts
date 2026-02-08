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

/**
 * Get tenant profile
 */
async function getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
    const { data, error } = await supabase
        .from('tenant_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
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
            // Create sequence
            const { data: sequenceData, error: seqError } = await supabase
                .from('sequences')
                .insert({
                    tenant_id: tenantId,
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
            for (const step of seq.steps) {
                const { error: stepError } = await supabase
                    .from('sequence_steps')
                    .insert({
                        sequence_id: sequenceId,
                        step_order: step.step_order,
                        channel: step.channel,
                        delay_seconds: step.delay_seconds,
                        delay_type: step.delay_type,
                        content: step.content,
                        skip_conditions: step.skip_conditions,
                        on_success: step.on_success,
                        on_failure: step.on_failure,
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
    // Deactivate existing AI-generated sequences
    await supabase
        .from('sequences')
        .update({ is_active: false })
        .eq('tenant_id', tenantId)
        .eq('generated_by_ai', true);

    // Generate new ones
    await generateSequencesFromOnboarding(tenantId);
}
