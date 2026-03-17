"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { getOpenRouterClient, CONVERSATION_MODEL, GENERATION_MODEL } from "@/lib/openrouter";
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

// ─── JSON Extraction Helper ──────────────────────────────────────────────────
// GLM-5 is a reasoning model that may wrap output in <think> tags, markdown
// code blocks, or add explanatory text around JSON. This handles all cases.

function extractJSON(raw: string): any {
    // Step 0: Strip reasoning/thinking tags that reasoning models add
    let cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .trim();

    // Try 1: Direct parse (model returned pure JSON)
    try {
        return JSON.parse(cleaned);
    } catch {
        // continue
    }

    // Try 2: Extract from ```json ... ``` block (greedy to get the largest block)
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonBlockMatch) {
        try {
            return JSON.parse(jsonBlockMatch[1].trim());
        } catch {
            // Try fixing common issues: trailing commas
            const fixed = jsonBlockMatch[1].trim()
                .replace(/,\s*}/g, "}")
                .replace(/,\s*]/g, "]");
            try {
                return JSON.parse(fixed);
            } catch {
                // continue
            }
        }
    }

    // Try 3: Find the outermost { ... } in the response
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (cleaned[i] === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                end = i;
                // Don't break — we want the LAST complete top-level object
                // Actually, try to parse the FIRST complete one
                try {
                    return JSON.parse(cleaned.slice(start, end + 1));
                } catch {
                    // Reset and keep looking
                    start = -1;
                }
            }
        }
    }

    // Try 4: Last resort — find first { and last } (less precise)
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = cleaned.slice(firstBrace, lastBrace + 1);
        // Fix common JSON issues before parsing
        const fixed = candidate
            .replace(/,\s*}/g, "}")
            .replace(/,\s*]/g, "]")
            .replace(/\/\/[^\n]*/g, ""); // Strip single-line comments
        try {
            return JSON.parse(fixed);
        } catch {
            // continue
        }
    }

    throw new Error("Could not extract valid JSON from model response");
}

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
  "trigger_type": "new_lead",
  "urgency_tier": "high",
  "channels": ["sms", "email", "voice"],
  "step_count": 5,
  "goal": "brief description of the goal",
  "summary": "1-2 sentence human-readable summary of the sequence",
  "timing_strategy": "brief description of timing approach"
}
\`\`\`

Valid trigger_type values: new_lead, missed_call, form_submission, manual, tag_added, status_change, schedule
Valid urgency_tier values: critical, high, medium, low
Valid channels: sms, email, voice

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
            model: CONVERSATION_MODEL,
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
            const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
            if (jsonMatch) {
                try {
                    const plan = JSON.parse(jsonMatch[1]) as ConversationPlan;
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
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const p = profile || DEFAULT_PROFILE;

        const userContext = messages
            .filter((m) => m.role === "user")
            .map((m) => `- ${m.content}`)
            .join("\n");

        // Build a concrete example that matches the exact sequencer schema
        const generationPrompt = `You are an expert marketing automation engineer. Generate a complete multi-channel follow-up sequence as a JSON object.

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

WHAT THE USER DESCRIBED:
${userContext}

RULES:
1. Generate exactly ${plan.step_count} steps (can be ±1)
2. Use ONLY these channels: ${plan.channels.join(", ")}
3. TCPA compliance: no calls/texts before 8am or after 9pm
4. Match the "${p.brand_voice || "professional"}" brand voice
5. Template variables you can use: {{customer_name}}, {{first_name}}, {{last_name}}, {{phone}}, {{email}}, {{business_name}}, {{property_address}}, {{callback_number}}
6. Channel timing:
   - SMS: immediate to 30min for urgent, hours for medium
   - Voice: 1-4 hour delay minimum (let SMS land first)
   - Email: 4-24 hour gaps
7. skip_conditions.skip_if values: "contact_replied", "contact_answered_call", "appointment_booked"
8. on_success action values: "continue", "jump_to_step", "end_sequence"
9. on_failure action values: "retry_after_seconds", "skip", "end_sequence"
10. For voice retry: use retry_delay of 3600-7200 (seconds)
11. Last step should have on_success: {"action": "end_sequence"}

EXACT CONTENT FORMAT PER CHANNEL:

For SMS steps, content must be:
{"body": "Hi {{first_name}}, this is {{business_name}}. We got your inquiry..."}

For email steps, content must be:
{"subject": "Following up on your inquiry", "body_html": "<p>Hi {{first_name}},</p><p>Thank you for reaching out...</p>", "body_text": "Hi {{first_name}}, Thank you for reaching out..."}

For voice steps, content must be:
{"first_message": "Hi, is this {{first_name}}? This is the team at {{business_name}} calling about your recent inquiry.", "system_prompt": "You are a friendly follow-up specialist for {{business_name}}. Your goal is to help the caller with their inquiry and book an appointment if possible. Be conversational, not pushy. If they're not interested, thank them and end the call gracefully."}

EXAMPLE OUTPUT (2-step sequence):
{
  "name": "New Lead Follow-up",
  "description": "Automated follow-up for new leads with SMS and voice",
  "steps": [
    {
      "step_order": 1,
      "channel": "sms",
      "delay_seconds": 0,
      "delay_type": "after_enrollment",
      "content": {"body": "Hi {{first_name}}, thanks for reaching out to {{business_name}}! We received your inquiry and will be in touch shortly. Reply STOP to opt out."},
      "skip_conditions": {"skip_if": ["contact_replied", "appointment_booked"]},
      "on_success": {"action": "continue"},
      "on_failure": {"action": "skip"},
      "mutation_instructions": "Optimize message length and tone. Test emoji usage. Vary CTA phrasing."
    },
    {
      "step_order": 2,
      "channel": "voice",
      "delay_seconds": 7200,
      "delay_type": "after_previous",
      "content": {"first_message": "Hi, is this {{first_name}}? This is the team at {{business_name}} following up on your recent inquiry. Do you have a quick moment?", "system_prompt": "You are a follow-up specialist for {{business_name}}. The contact recently submitted an inquiry. Your goal is to understand their needs and book an appointment. Be friendly and professional. If they are busy, offer to call back at a better time. Use the check_availability tool to find open slots and book_appointment to confirm."},
      "skip_conditions": {"skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"]},
      "on_success": {"action": "end_sequence"},
      "on_failure": {"action": "retry_after_seconds", "retry_delay": 3600},
      "mutation_instructions": "Adjust opening energy and pacing. Vary first message length. Test different objection handling approaches."
    }
  ]
}

NOW GENERATE THE FULL SEQUENCE. Respond with ONLY the JSON object, no explanation, no markdown formatting, no code blocks. Start with { and end with }.`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.4,
            max_tokens: 6000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: generationPrompt },
                {
                    role: "user",
                    content: `Generate the complete ${plan.step_count}-step sequence for the "${plan.trigger_type}" trigger with ${plan.channels.join(", ")} channels at ${plan.urgency_tier} urgency. Output ONLY the JSON object.`,
                },
            ],
        });

        // Handle reasoning models: content may be in different fields
        const choice = completion.choices[0];
        const raw = choice?.message?.content;
        if (!raw) {
            console.error("Empty model response. Full choice:", JSON.stringify(choice));
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        console.log("[confirmAndGenerate] Raw response length:", raw.length, "Preview:", raw.substring(0, 200));

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch (parseErr) {
            console.error("Failed to parse AI JSON. Raw response:", raw.substring(0, 1000));
            return {
                success: false,
                error: `AI response could not be parsed as JSON. Response preview: "${raw.substring(0, 100)}...". Please try again.`,
            };
        }

        // Validate output
        if (!generated.name || typeof generated.name !== "string") {
            return { success: false, error: "AI output missing sequence name. Please try again." };
        }
        if (!Array.isArray(generated.steps) || generated.steps.length < 1) {
            return { success: false, error: "AI output missing steps. Please try again." };
        }

        // Validate and fix each step
        for (const step of generated.steps) {
            if (!step.step_order || !step.channel || !step.content) {
                return {
                    success: false,
                    error: `Step ${step.step_order || "?"} missing required fields. Please try again.`,
                };
            }
            if (!["sms", "email", "voice"].includes(step.channel)) {
                return {
                    success: false,
                    error: `Step ${step.step_order} has invalid channel "${step.channel}". Please try again.`,
                };
            }

            // Ensure content has required fields per channel
            if (step.channel === "sms" && !step.content.body) {
                step.content.body = "Hi {{first_name}}, this is {{business_name}} following up.";
            }
            if (step.channel === "email") {
                if (!step.content.subject) step.content.subject = "Following up on your inquiry";
                if (!step.content.body_html) step.content.body_html = `<p>${step.content.body_text || "Hi {{first_name}}, we wanted to follow up."}</p>`;
                if (!step.content.body_text) step.content.body_text = step.content.body_html?.replace(/<[^>]+>/g, "") || "Hi, we wanted to follow up.";
            }
            if (step.channel === "voice") {
                if (!step.content.first_message) step.content.first_message = "Hi, is this {{first_name}}? This is the team at {{business_name}} calling.";
                if (!step.content.system_prompt) step.content.system_prompt = `You are a follow-up specialist for {{business_name}}. Be friendly and professional. Help the contact with their inquiry and try to book an appointment.`;
            }
        }

        // Insert sequence — match columns from sequencer/src/lib/ai-sequence-generator.ts
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

        // Insert steps — match columns from sequencer/src/lib/ai-sequence-generator.ts
        let insertedCount = 0;
        const stepErrors: string[] = [];

        for (const step of generated.steps) {
            // Coerce numeric fields — AI may return strings like "1" instead of 1
            const stepOrder = Number(step.step_order) || (insertedCount + 1);
            const delaySeconds = Number(step.delay_seconds) || 0;

            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequence.id,
                    step_order: stepOrder,
                    channel: step.channel,
                    delay_seconds: delaySeconds,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    mutation_instructions: step.mutation_instructions || null,
                });

            if (stepError) {
                console.error(`Error inserting step ${stepOrder}:`, stepError);
                stepErrors.push(`Step ${stepOrder}: ${stepError.message}`);
            } else {
                insertedCount++;
            }
        }

        // If NO steps were inserted, rollback the sequence and return error
        if (insertedCount === 0) {
            console.error("All step inserts failed:", stepErrors);
            await supabase.from("sequences").delete().eq("id", sequence.id);
            return {
                success: false,
                error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.`,
            };
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

        let systemPrompt = `You are a marketing automation expert. Generate a multi-channel follow-up sequence as a JSON object.

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
5. Template variables: {{customer_name}}, {{first_name}}, {{last_name}}, {{phone}}, {{email}}, {{business_name}}, {{property_address}}, {{callback_number}}

CONTENT FORMAT PER CHANNEL:
- SMS: {"body": "message text here"}
- Email: {"subject": "subject", "body_html": "<p>HTML</p>", "body_text": "plain text"}
- Voice: {"first_message": "opening greeting", "system_prompt": "full agent instructions"}

skip_conditions.skip_if values: "contact_replied", "contact_answered_call", "appointment_booked"
on_success.action values: "continue", "jump_to_step", "end_sequence"
on_failure.action values: "retry_after_seconds", "skip", "end_sequence"

Respond with ONLY a JSON object in this format (no markdown, no explanation):
{
  "name": "Sequence Name",
  "description": "What this sequence does",
  "trigger_type": "new_lead",
  "urgency_tier": "high",
  "steps": [
    {
      "step_order": 1,
      "channel": "sms",
      "delay_seconds": 0,
      "delay_type": "after_enrollment",
      "content": {"body": "Hi {{first_name}}, thanks for reaching out to {{business_name}}!"},
      "skip_conditions": {"skip_if": ["contact_replied", "appointment_booked"]},
      "on_success": {"action": "continue"},
      "on_failure": {"action": "skip"},
      "mutation_instructions": "Optimize tone and CTA."
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
            model: GENERATION_MODEL,
            temperature: 0.4,
            max_tokens: 6000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: "Generate the sequence now. Output ONLY the JSON object.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            console.error("Empty model response:", JSON.stringify(completion.choices[0]));
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        console.log("[generateAISequence] Raw response length:", raw.length, "Preview:", raw.substring(0, 200));

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch {
            console.error("Failed to parse AI output:", raw.substring(0, 1000));
            return {
                success: false,
                error: `AI response could not be parsed. Preview: "${raw.substring(0, 80)}...". Please try again.`,
            };
        }

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

        let insertedCount = 0;
        const stepErrors: string[] = [];

        for (const step of generated.steps) {
            const stepOrder = Number(step.step_order) || (insertedCount + 1);
            const delaySeconds = Number(step.delay_seconds) || 0;

            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequence.id,
                    step_order: stepOrder,
                    channel: step.channel,
                    delay_seconds: delaySeconds,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    mutation_instructions: step.mutation_instructions || null,
                });

            if (stepError) {
                console.error(`Error inserting step ${stepOrder}:`, stepError);
                stepErrors.push(`Step ${stepOrder}: ${stepError.message}`);
            } else {
                insertedCount++;
            }
        }

        if (insertedCount === 0) {
            await supabase.from("sequences").delete().eq("id", sequence.id);
            return {
                success: false,
                error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.`,
            };
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

        const systemPrompt = `You are a marketing automation expert adding steps to an existing sequence. Generate new steps as a JSON object.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${p.industry || "general"} (${p.sub_industry || "general"})
- Brand voice: ${p.brand_voice || "professional"}
- Primary goal: ${p.primary_goal || "book_appointment"}
- Timezone: ${p.timezone || "America/New_York"}

EXISTING SEQUENCE:
- Name: ${existingSequence.name}
- Trigger: ${existingSequence.trigger_type}
- Urgency: ${existingSequence.urgency_tier}
- Existing steps: ${JSON.stringify(existingStepsAll || [], null, 2)}

USER REQUEST:
${userPrompt}

RULES:
1. Generate NEW steps that complement existing ones — don't duplicate
2. Step ordering starts at ${startOrder}
3. Template variables: {{customer_name}}, {{first_name}}, {{last_name}}, {{phone}}, {{email}}, {{business_name}}, {{callback_number}}

CONTENT FORMAT PER CHANNEL:
- SMS: {"body": "message text here"}
- Email: {"subject": "subject", "body_html": "<p>HTML</p>", "body_text": "plain text"}
- Voice: {"first_message": "opening greeting", "system_prompt": "full agent instructions"}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "steps": [
    {
      "step_order": ${startOrder},
      "channel": "sms",
      "delay_seconds": 3600,
      "delay_type": "after_previous",
      "content": {"body": "Hi {{first_name}}, just following up from {{business_name}}."},
      "skip_conditions": {"skip_if": ["contact_replied", "appointment_booked"]},
      "on_success": {"action": "continue"},
      "on_failure": {"action": "skip"},
      "mutation_instructions": "Optimize tone and CTA."
    }
  ]
}`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.4,
            max_tokens: 6000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: "Generate the additional steps now. Output ONLY the JSON object.",
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            console.error("Empty model response:", JSON.stringify(completion.choices[0]));
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        console.log("[generateAISteps] Raw response length:", raw.length, "Preview:", raw.substring(0, 200));

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch {
            console.error("Failed to parse AI output:", raw.substring(0, 1000));
            return {
                success: false,
                error: `AI response could not be parsed. Preview: "${raw.substring(0, 80)}...". Please try again.`,
            };
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

        let insertedCount = 0;
        const stepErrors: string[] = [];

        for (const step of generated.steps) {
            const stepOrder = Number(step.step_order) || (insertedCount + startOrder);
            const delaySeconds = Number(step.delay_seconds) || 0;

            const { error: stepError } = await supabase
                .from("sequence_steps")
                .insert({
                    sequence_id: sequenceId,
                    step_order: stepOrder,
                    channel: step.channel,
                    delay_seconds: delaySeconds,
                    delay_type: step.delay_type || "after_previous",
                    content: step.content,
                    skip_conditions: step.skip_conditions || null,
                    on_success: step.on_success || { action: "continue" },
                    on_failure: step.on_failure || { action: "skip" },
                    enable_ai_mutation: true,
                    mutation_instructions: step.mutation_instructions || null,
                });

            if (stepError) {
                console.error(`Error inserting step ${stepOrder}:`, stepError);
                stepErrors.push(`Step ${stepOrder}: ${stepError.message}`);
            } else {
                insertedCount++;
            }
        }

        if (insertedCount === 0) {
            return {
                success: false,
                error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.`,
            };
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
