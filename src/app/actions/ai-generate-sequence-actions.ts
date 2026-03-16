"use server";

import { supabase } from "@/lib/supabase";
import OpenAI from "openai";
import { revalidatePath } from "next/cache";

const DEFAULT_PROFILE = {
    industry: "general",
    sub_industry: "general",
    brand_voice: "professional",
    primary_goal: "book_appointment",
    timezone: "America/New_York",
    business_name: "Business",
    business_hours: null,
    service_area: null,
    custom_phrases: null,
};

export async function generateAISequence(
    clientId: string,
    userPrompt: string,
    options?: { triggerType?: string; urgencyTier?: string }
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
    try {
        // 1. Fetch tenant profile
        const { data: profile, error: profileError } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (profileError && profileError.code !== "PGRST116") {
            console.error("Error fetching tenant profile:", profileError);
        }

        const p = profile || DEFAULT_PROFILE;

        // 2. Build GPT prompt
        let systemPrompt = `You are a marketing automation expert creating a multi-channel follow-up sequence.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${p.industry || "general"} (${p.sub_industry || "general"})
- Brand voice: ${p.brand_voice || "professional"}
- Primary goal: ${p.primary_goal || "book_appointment"}
- Timezone: ${p.timezone || "America/New_York"}
- Business hours: ${JSON.stringify(p.business_hours)}
- Service area: ${JSON.stringify(p.service_area)}
- Custom phrases: ${JSON.stringify(p.custom_phrases)}

USER REQUEST:
${userPrompt}

RULES:
1. Generate 3-8 steps
2. Mix channels (sms, email, voice) based on urgency
3. TCPA compliance: no calls/texts before 8am or after 9pm
4. Match the brand voice
5. Include skip_conditions to avoid redundant outreach
6. Use template variables: {{customer_name}}, {{phone}}, {{email}}, {{business_name}}, {{property_address}}

OUTPUT FORMAT (JSON):
{
  "name": "string - sequence name",
  "description": "string - what this sequence does",
  "trigger_type": "string - one of: new_lead, missed_call, form_submission, manual, tag_added, status_change, schedule",
  "urgency_tier": "string - one of: critical, high, medium, low",
  "steps": [
    {
      "step_order": 1,
      "channel": "sms|email|voice",
      "delay_seconds": 0,
      "delay_type": "after_previous|after_enrollment",
      "content": {
        // SMS: { "body": "string" }
        // Email: { "subject": "string", "body_html": "string", "body_text": "string" }
        // Voice: { "first_message": "string", "system_prompt": "string" }
      },
      "skip_conditions": { "skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"] },
      "on_success": { "action": "continue|jump_to_step|end_sequence", "target_step": null },
      "on_failure": { "action": "skip|end_sequence|retry_after_seconds", "retry_delay": null }
    }
  ]
}`;

        if (options?.triggerType) {
            systemPrompt += `\n\nTrigger type should be: ${options.triggerType}`;
        }
        if (options?.urgencyTier) {
            systemPrompt += `\n\nUrgency tier should be: ${options.urgencyTier}`;
        }

        // 3. Call GPT-4o
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 30000,
        });

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content:
                        "Generate the sequence now. Respond with valid JSON only.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI model" };
        }

        const generated = JSON.parse(raw);

        // 4. Validate GPT output
        if (!generated.name || typeof generated.name !== "string") {
            return {
                success: false,
                error: "AI output missing valid sequence name",
            };
        }
        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return {
                success: false,
                error: "AI output missing valid steps array",
            };
        }
        for (const step of generated.steps) {
            if (!step.step_order || !step.channel || !step.content) {
                return {
                    success: false,
                    error: `Step ${step.step_order || "?"} missing required fields (step_order, channel, content)`,
                };
            }
            if (!["sms", "email", "voice"].includes(step.channel)) {
                return {
                    success: false,
                    error: `Step ${step.step_order} has invalid channel: ${step.channel}`,
                };
            }
        }

        // 5. Insert sequence
        const { data: sequence, error: seqError } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name: generated.name,
                description: generated.description || null,
                trigger_type:
                    options?.triggerType || generated.trigger_type || "manual",
                urgency_tier:
                    options?.urgencyTier || generated.urgency_tier || "medium",
                ai_generated: true,
                is_active: false,
            })
            .select("id")
            .single();

        if (seqError || !sequence) {
            return {
                success: false,
                error: `Failed to create sequence: ${seqError?.message || "Unknown error"}`,
            };
        }

        // 6. Insert steps
        for (const step of generated.steps) {
            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequence.id,
                    step_order: step.step_order,
                    channel: step.channel,
                    delay_seconds: step.delay_seconds,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    is_active: true,
                });

            if (stepError) {
                console.error(
                    `Error inserting step ${step.step_order}:`,
                    stepError
                );
            }
        }

        // 7. Revalidate and return
        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("generateAISequence error:", err);
        return {
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : "An unexpected error occurred",
        };
    }
}

export async function generateAIStepsForSequence(
    clientId: string,
    sequenceId: string,
    userPrompt: string
): Promise<{ success: boolean; stepCount?: number; error?: string }> {
    try {
        // 1. Fetch existing sequence and its steps
        const { data: existingSequence, error: seqFetchError } = await supabase
            .from("sequences")
            .select("*")
            .eq("id", sequenceId)
            .eq("client_id", clientId)
            .single();

        if (seqFetchError || !existingSequence) {
            return {
                success: false,
                error: `Sequence not found: ${seqFetchError?.message || "Unknown error"}`,
            };
        }

        const { data: existingStepsAll } = await supabase
            .from("sequence_steps")
            .select("*")
            .eq("sequence_id", sequenceId)
            .order("step_order", { ascending: true });

        // 2. Determine starting step_order
        const { data: existingSteps } = await supabase
            .from("sequence_steps")
            .select("step_order")
            .eq("sequence_id", sequenceId)
            .order("step_order", { ascending: false })
            .limit(1);

        const startOrder =
            existingSteps && existingSteps.length > 0
                ? existingSteps[0].step_order + 1
                : 1;

        // 3. Fetch tenant profile
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const p = profile || DEFAULT_PROFILE;

        // 4. Build GPT prompt with existing sequence context
        const systemPrompt = `You are a marketing automation expert adding steps to an existing multi-channel follow-up sequence.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${p.industry || "general"} (${p.sub_industry || "general"})
- Brand voice: ${p.brand_voice || "professional"}
- Primary goal: ${p.primary_goal || "book_appointment"}
- Timezone: ${p.timezone || "America/New_York"}
- Business hours: ${JSON.stringify(p.business_hours)}
- Service area: ${JSON.stringify(p.service_area)}
- Custom phrases: ${JSON.stringify(p.custom_phrases)}

EXISTING SEQUENCE CONTEXT:
- Name: ${existingSequence.name}
- Trigger: ${existingSequence.trigger_type}
- Urgency: ${existingSequence.urgency_tier}
- Existing steps: ${JSON.stringify(existingStepsAll || [], null, 2)}

USER REQUEST:
${userPrompt}

RULES:
1. Generate new steps that complement the existing ones — do NOT duplicate what already exists
2. Step ordering starts at ${startOrder}
3. Mix channels (sms, email, voice) based on urgency and what channels are already used
4. TCPA compliance: no calls/texts before 8am or after 9pm
5. Match the brand voice
6. Include skip_conditions to avoid redundant outreach
7. Use template variables: {{customer_name}}, {{phone}}, {{email}}, {{business_name}}, {{property_address}}

OUTPUT FORMAT (JSON):
{
  "steps": [
    {
      "step_order": ${startOrder},
      "channel": "sms|email|voice",
      "delay_seconds": 0,
      "delay_type": "after_previous|after_enrollment",
      "content": {
        // SMS: { "body": "string" }
        // Email: { "subject": "string", "body_html": "string", "body_text": "string" }
        // Voice: { "first_message": "string", "system_prompt": "string" }
      },
      "skip_conditions": { "skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"] },
      "on_success": { "action": "continue|jump_to_step|end_sequence", "target_step": null },
      "on_failure": { "action": "skip|end_sequence|retry_after_seconds", "retry_delay": null }
    }
  ]
}`;

        // 5. Call GPT-4o
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 30000,
        });

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content:
                        "Generate the additional steps now. Respond with valid JSON only.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI model" };
        }

        const generated = JSON.parse(raw);

        // 6. Validate
        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return {
                success: false,
                error: "AI output missing valid steps array",
            };
        }
        for (const step of generated.steps) {
            if (!step.step_order || !step.channel || !step.content) {
                return {
                    success: false,
                    error: `Step ${step.step_order || "?"} missing required fields (step_order, channel, content)`,
                };
            }
            if (!["sms", "email", "voice"].includes(step.channel)) {
                return {
                    success: false,
                    error: `Step ${step.step_order} has invalid channel: ${step.channel}`,
                };
            }
        }

        // 7. Insert steps
        let insertedCount = 0;
        for (const step of generated.steps) {
            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequenceId,
                    step_order: step.step_order,
                    channel: step.channel,
                    delay_seconds: step.delay_seconds,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    is_active: true,
                });

            if (stepError) {
                console.error(
                    `Error inserting step ${step.step_order}:`,
                    stepError
                );
            } else {
                insertedCount++;
            }
        }

        // 8. Revalidate and return
        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, stepCount: insertedCount };
    } catch (err) {
        console.error("generateAIStepsForSequence error:", err);
        return {
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : "An unexpected error occurred",
        };
    }
}
