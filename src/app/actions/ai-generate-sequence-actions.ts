"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { getOpenRouterClient, SEQUENCE_MODEL } from "@/lib/openrouter";
import {
    buildIndustryContext,
    buildServicesText,
    buildBusinessHoursText,
    buildBrandVoiceDirective,
    buildCustomPhrasesRules,
    buildServiceAreaText,
} from "@/lib/prompt-templates";

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
    job_types: null,
};

// ═══════════════════════════════════════════════════════════
// Conversational AI Sequence Generation
// ═══════════════════════════════════════════════════════════

export interface ConversationMessage {
    role: "assistant" | "user";
    content: string;
}

export interface ConversationPlan {
    trigger_type: string;
    urgency_tier: string;
    channels: string[];
    step_count: number;
    goal: string;
    summary: string;
    timing_strategy: string;
}

// ─── Action 1: Start AI Conversation ─────────────────────────────────────────

export async function startAIConversation(clientId: string): Promise<{
    success: boolean;
    messages?: ConversationMessage[];
    systemPrompt?: string;
    profileSummary?: string;
    error?: string;
}> {
    try {
        const { data: profile, error: profileError } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (profileError && profileError.code !== "PGRST116") {
            console.error("Error fetching tenant profile:", profileError);
        }

        const p = profile || DEFAULT_PROFILE;

        const industryContext = buildIndustryContext(p.industry, p.sub_industry);
        const servicesText = buildServicesText(p.job_types);
        const hoursText = buildBusinessHoursText(p.business_hours, p.timezone);
        const brandDirective = buildBrandVoiceDirective(p.brand_voice);
        const phrasesRules = buildCustomPhrasesRules(p.custom_phrases);
        const serviceAreaText = buildServiceAreaText(p.service_area);

        const systemPrompt = `You are an expert marketing automation strategist helping a business owner create an automated follow-up sequence. You work for Omnify, an AI-powered CRM.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${industryContext}
- Services: ${servicesText}
- Service Area: ${serviceAreaText}
- Brand Voice: ${p.brand_voice || "professional"}
- Primary Goal: ${p.primary_goal || "book_appointment"}
- Timezone: ${p.timezone || "America/New_York"}
- Business Hours: ${hoursText}
${phrasesRules ? `- Messaging Rules:\n${phrasesRules}` : ""}

BRAND VOICE GUIDELINES:
${brandDirective}

YOUR ROLE:
You are having a conversation to understand what kind of automated outreach sequence the user needs. Ask clarifying questions to understand:
1. What TRIGGERS this sequence? (new lead, missed call, form submission, manual enrollment, etc.)
2. How URGENT is the follow-up? (critical = minutes, high = hours, medium = same day, low = days)
3. Which CHANNELS should be used? (SMS, email, voice/phone calls, or a mix)
4. What TIMING makes sense? (immediate, spread over hours, days, or weeks?)
5. What's the GOAL? (book appointment, qualify lead, collect info, re-engage, etc.)
6. Any COMPLIANCE concerns? (industry regulations, time-of-day restrictions, etc.)

CONVERSATION RULES:
- Ask 2-3 questions at a time, not all at once
- Be conversational and helpful, not robotic
- Use the business profile to make smart suggestions
- If the user gives vague answers, suggest concrete options
- After 2-4 exchanges (when you have enough info), respond with EXACTLY this format:

READY_TO_GENERATE
\`\`\`json
{
  "trigger_type": "new_lead|missed_call|form_submission|manual|tag_added|status_change|schedule",
  "urgency_tier": "critical|high|medium|low",
  "channels": ["sms", "email", "voice"],
  "step_count": 5,
  "goal": "brief description of the goal",
  "summary": "1-2 sentence human-readable summary of the sequence",
  "timing_strategy": "brief description of timing approach"
}
\`\`\`

IMPORTANT: Only output READY_TO_GENERATE when you genuinely have enough information. Do NOT rush to generate — ask follow-ups if the user's answers are vague.`;

        const businessDesc = p.business_name && p.business_name !== "Business"
            ? `I see you're running **${p.business_name}**, a ${industryContext} business.`
            : `I see you're in the **${industryContext}** industry.`;

        const greeting: ConversationMessage = {
            role: "assistant",
            content: `${businessDesc} I'll help you build the perfect automated follow-up sequence.\n\nTo get started, I have a couple of questions:\n\n1. **What triggers this sequence?** For example: a new lead comes in, someone misses a call, a form gets submitted, etc.\n2. **How quickly do you need to follow up?** Is this time-sensitive (like a missed call) or more of a nurture campaign?`,
        };

        const profileSummary = `${p.business_name || "Business"} | ${industryContext} | ${p.brand_voice} voice | Goal: ${p.primary_goal}`;

        return {
            success: true,
            messages: [greeting],
            systemPrompt,
            profileSummary,
        };
    } catch (err) {
        console.error("startAIConversation error:", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "Failed to start conversation",
        };
    }
}

// ─── Action 2: Send Conversation Message ─────────────────────────────────────

export async function sendConversationMessage(
    systemPrompt: string,
    messages: ConversationMessage[],
    userMessage: string
): Promise<{
    success: boolean;
    phase?: "conversing" | "ready";
    messages?: ConversationMessage[];
    plan?: ConversationPlan;
    error?: string;
}> {
    try {
        const updatedMessages: ConversationMessage[] = [
            ...messages,
            { role: "user", content: userMessage },
        ];

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: SEQUENCE_MODEL,
            temperature: 0.7,
            max_tokens: 1000,
            messages: [
                { role: "system", content: systemPrompt },
                ...updatedMessages.map((m) => ({
                    role: m.role as "assistant" | "user",
                    content: m.content,
                })),
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI" };
        }

        // Check if AI is ready to generate
        if (raw.includes("READY_TO_GENERATE")) {
            const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                try {
                    const plan = JSON.parse(jsonMatch[1]) as ConversationPlan;
                    // Extract the text before READY_TO_GENERATE as the final message
                    const textBefore = raw.split("READY_TO_GENERATE")[0].trim();
                    const finalMessages: ConversationMessage[] = [
                        ...updatedMessages,
                        {
                            role: "assistant",
                            content: textBefore || "I have everything I need to build your sequence.",
                        },
                    ];
                    return {
                        success: true,
                        phase: "ready",
                        messages: finalMessages,
                        plan,
                    };
                } catch {
                    // JSON parse failed, treat as still conversing
                }
            }
        }

        const finalMessages: ConversationMessage[] = [
            ...updatedMessages,
            { role: "assistant", content: raw },
        ];

        return {
            success: true,
            phase: "conversing",
            messages: finalMessages,
        };
    } catch (err) {
        console.error("sendConversationMessage error:", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "Failed to send message",
        };
    }
}

// ─── Action 3: Confirm and Generate Sequence ─────────────────────────────────

export async function confirmAndGenerate(
    clientId: string,
    plan: ConversationPlan,
    messages: ConversationMessage[],
    systemPromptContext: string
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
    try {
        // Fetch tenant profile for generation
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const p = profile || DEFAULT_PROFILE;

        const generationPrompt = `You are an expert marketing automation engineer. Generate a complete multi-channel follow-up sequence based on the conversation and plan below.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${buildIndustryContext(p.industry, p.sub_industry)}
- Brand Voice: ${p.brand_voice || "professional"}
- Timezone: ${p.timezone || "America/New_York"}
- Business Hours: ${buildBusinessHoursText(p.business_hours, p.timezone)}
${buildCustomPhrasesRules(p.custom_phrases) ? `- Messaging Rules:\n${buildCustomPhrasesRules(p.custom_phrases)}` : ""}

AGREED PLAN:
- Trigger: ${plan.trigger_type}
- Urgency: ${plan.urgency_tier}
- Channels: ${plan.channels.join(", ")}
- Approximate steps: ${plan.step_count}
- Goal: ${plan.goal}
- Strategy: ${plan.timing_strategy}

CONVERSATION CONTEXT (what the user described):
${messages.filter((m) => m.role === "user").map((m) => `- ${m.content}`).join("\n")}

GENERATION RULES:
1. Generate ${plan.step_count} steps (can be ±1 if it makes the sequence better)
2. Use ONLY these channels: ${plan.channels.join(", ")}
3. TCPA compliance: no calls/texts before 8am or after 9pm in the business timezone
4. Match the ${p.brand_voice || "professional"} brand voice
5. Use template variables: {{customer_name}}, {{phone}}, {{email}}, {{business_name}}, {{property_address}}
6. Channel timing guidelines:
   - SMS: Can be immediate or short delays (0-30min for urgent, hours for medium)
   - Voice: Add 1-4 hour delay minimum (allow SMS to land first)
   - Email: Can be immediate or longer delays (4-24h gaps)
7. Smart skip_conditions: skip steps if the contact already replied/answered/booked
8. Use jump_to_step in on_success where it makes sense (e.g., after a successful call, skip remaining SMS reminders)
9. Use retry logic in on_failure for voice (retry_after_seconds: 3600-7200)
10. Each step needs channel-appropriate mutation_instructions for AI self-improvement
11. End with an "end_sequence" success action on the final step

MUTATION INSTRUCTIONS PER CHANNEL:
- SMS: "Optimize message length, tone, and urgency. Test emoji usage. Vary CTA phrasing."
- Email: "Test subject lines, preview text, body length, CTA placement. Vary formality level."
- Voice: "Adjust opening energy, pacing, objection handling approach. Vary first message length."

OUTPUT FORMAT (JSON only, no markdown):
{
  "name": "string - descriptive sequence name",
  "description": "string - what this sequence does",
  "steps": [
    {
      "step_order": 1,
      "channel": "sms|email|voice",
      "delay_seconds": 0,
      "delay_type": "after_previous|after_enrollment",
      "content": {
        // SMS: { "body": "message text" }
        // Email: { "subject": "subject line", "body_html": "<p>HTML content</p>", "body_text": "plain text" }
        // Voice: { "first_message": "opening line", "system_prompt": "full voice AI instructions" }
      },
      "skip_conditions": { "skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"] },
      "on_success": { "action": "continue|jump_to_step|end_sequence", "target_step": null },
      "on_failure": { "action": "skip|end_sequence|retry_after_seconds", "retry_delay": null },
      "mutation_instructions": "string - channel-specific AI optimization instructions"
    }
  ]
}`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: SEQUENCE_MODEL,
            temperature: 0.7,
            max_tokens: 4000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: generationPrompt },
                {
                    role: "user",
                    content: "Generate the complete sequence now. Respond with valid JSON only.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI model" };
        }

        const generated = JSON.parse(raw);

        // Validate output
        if (!generated.name || typeof generated.name !== "string") {
            return { success: false, error: "AI output missing valid sequence name" };
        }
        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return { success: false, error: "AI output missing valid steps array" };
        }
        for (const step of generated.steps) {
            if (!step.step_order || !step.channel || !step.content) {
                return {
                    success: false,
                    error: `Step ${step.step_order || "?"} missing required fields`,
                };
            }
            if (!["sms", "email", "voice"].includes(step.channel)) {
                return {
                    success: false,
                    error: `Step ${step.step_order} has invalid channel: ${step.channel}`,
                };
            }
        }

        // Insert sequence WITH mutation flags
        const { data: sequence, error: seqError } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name: generated.name,
                description: generated.description || null,
                trigger_type: plan.trigger_type || "manual",
                urgency_tier: plan.urgency_tier || "medium",
                ai_generated: true,
                is_active: false,
                enable_adaptive_mutation: true,
                mutation_aggressiveness: "moderate",
            })
            .select("id")
            .single();

        if (seqError || !sequence) {
            return {
                success: false,
                error: `Failed to create sequence: ${seqError?.message || "Unknown error"}`,
            };
        }

        // Insert steps with mutation settings
        for (const step of generated.steps) {
            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequence.id,
                    step_order: step.step_order,
                    channel: step.channel,
                    delay_seconds: step.delay_seconds || 0,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    mutation_instructions: step.mutation_instructions || null,
                    is_active: true,
                });

            if (stepError) {
                console.error(`Error inserting step ${step.step_order}:`, stepError);
            }
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("confirmAndGenerate error:", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "An unexpected error occurred",
        };
    }
}

// ═══════════════════════════════════════════════════════════
// Legacy Functions (updated to use OpenRouter + mutation flags)
// ═══════════════════════════════════════════════════════════

export async function generateAISequence(
    clientId: string,
    userPrompt: string,
    options?: { triggerType?: string; urgencyTier?: string }
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
    try {
        const { data: profile, error: profileError } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (profileError && profileError.code !== "PGRST116") {
            console.error("Error fetching tenant profile:", profileError);
        }

        const p = profile || DEFAULT_PROFILE;

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
7. Include mutation_instructions for each step for AI self-improvement

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
      "on_failure": { "action": "skip|end_sequence|retry_after_seconds", "retry_delay": null },
      "mutation_instructions": "string - channel-specific optimization hints"
    }
  ]
}`;

        if (options?.triggerType) {
            systemPrompt += `\n\nTrigger type should be: ${options.triggerType}`;
        }
        if (options?.urgencyTier) {
            systemPrompt += `\n\nUrgency tier should be: ${options.urgencyTier}`;
        }

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: SEQUENCE_MODEL,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: "Generate the sequence now. Respond with valid JSON only.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI model" };
        }

        const generated = JSON.parse(raw);

        if (!generated.name || typeof generated.name !== "string") {
            return { success: false, error: "AI output missing valid sequence name" };
        }
        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return { success: false, error: "AI output missing valid steps array" };
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

        const { data: sequence, error: seqError } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name: generated.name,
                description: generated.description || null,
                trigger_type: options?.triggerType || generated.trigger_type || "manual",
                urgency_tier: options?.urgencyTier || generated.urgency_tier || "medium",
                ai_generated: true,
                is_active: false,
                enable_adaptive_mutation: true,
                mutation_aggressiveness: "moderate",
            })
            .select("id")
            .single();

        if (seqError || !sequence) {
            return {
                success: false,
                error: `Failed to create sequence: ${seqError?.message || "Unknown error"}`,
            };
        }

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
                    mutation_instructions: step.mutation_instructions || null,
                    is_active: true,
                });

            if (stepError) {
                console.error(`Error inserting step ${step.step_order}:`, stepError);
            }
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("generateAISequence error:", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "An unexpected error occurred",
        };
    }
}

export async function generateAIStepsForSequence(
    clientId: string,
    sequenceId: string,
    userPrompt: string
): Promise<{ success: boolean; stepCount?: number; error?: string }> {
    try {
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

        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const p = profile || DEFAULT_PROFILE;

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
8. Include mutation_instructions for each step

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
      "on_failure": { "action": "skip|end_sequence|retry_after_seconds", "retry_delay": null },
      "mutation_instructions": "string - channel-specific optimization hints"
    }
  ]
}`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: SEQUENCE_MODEL,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: "Generate the additional steps now. Respond with valid JSON only.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI model" };
        }

        const generated = JSON.parse(raw);

        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return { success: false, error: "AI output missing valid steps array" };
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
                    mutation_instructions: step.mutation_instructions || null,
                    is_active: true,
                });

            if (stepError) {
                console.error(`Error inserting step ${step.step_order}:`, stepError);
            } else {
                insertedCount++;
            }
        }

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, stepCount: insertedCount };
    } catch (err) {
        console.error("generateAIStepsForSequence error:", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "An unexpected error occurred",
        };
    }
}
