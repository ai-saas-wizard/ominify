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

// ─── DB Schema Constants ─────────────────────────────────────────────────────
// These mirror the exact Supabase table definitions.

const VALID_CHANNELS = ["sms", "email", "voice", "wait", "condition", "webhook", "notify_team"] as const;
const AI_CHANNELS = ["sms", "email", "voice"] as const; // subset AI can generate
const VALID_DELAY_TYPES = ["immediate", "fixed_delay", "business_hours_only", "specific_time", "after_previous"] as const;
const VALID_SKIP_IF = ["contact_replied", "contact_answered_call", "appointment_booked"] as const;
const VALID_SUCCESS_ACTIONS = ["continue", "jump_to_step", "end_sequence"] as const;
const VALID_FAILURE_ACTIONS = ["retry_after_seconds", "skip", "end_sequence"] as const;

// ─── JSON Extraction Helper ──────────────────────────────────────────────────

function extractJSON(raw: string): any {
    let cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .trim();

    try { return JSON.parse(cleaned); } catch { /* continue */ }

    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonBlockMatch) {
        try { return JSON.parse(jsonBlockMatch[1].trim()); } catch {
            const fixed = jsonBlockMatch[1].trim().replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
            try { return JSON.parse(fixed); } catch { /* continue */ }
        }
    }

    let depth = 0, start = -1;
    for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "{") { if (depth === 0) start = i; depth++; }
        else if (cleaned[i] === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { start = -1; }
            }
        }
    }

    const f = cleaned.indexOf("{"), l = cleaned.lastIndexOf("}");
    if (f !== -1 && l > f) {
        const fixed = cleaned.slice(f, l + 1).replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/\/\/[^\n]*/g, "");
        try { return JSON.parse(fixed); } catch { /* continue */ }
    }

    throw new Error("Could not extract valid JSON from model response");
}

// ─── Schema Validation & Transformation ──────────────────────────────────────
// Validates AI-generated JSON against the actual Supabase sequence_steps schema.
// Auto-fixes what it can (delay_seconds→delay_minutes, missing content fields).
// Returns { valid, data, errors } so callers can decide to repair or fail.

// ── Validated step shape used for schema validation before DB insert.
interface ValidatedStep {
    step_order: number;
    channel: string;
    delay_minutes: number;
    delay_type: string;
    content: Record<string, any>;
    skip_conditions: Record<string, any> | null;
    on_success: Record<string, any>;
    on_failure: Record<string, any>;
}

interface ValidationResult {
    valid: boolean;
    name?: string;
    description?: string;
    steps?: ValidatedStep[];
    errors: string[];
    warnings: string[];
}

function validateAndTransformSequence(raw: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Top-level fields
    if (!raw || typeof raw !== "object") {
        return { valid: false, errors: ["Output is not a JSON object"], warnings };
    }
    if (!raw.name || typeof raw.name !== "string") {
        errors.push("Missing or invalid 'name' field (expected string)");
    }
    if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
        errors.push("Missing or empty 'steps' array");
        return { valid: false, errors, warnings };
    }

    const validatedSteps: ValidatedStep[] = [];

    for (let i = 0; i < raw.steps.length; i++) {
        const step = raw.steps[i];
        const stepLabel = `Step ${i + 1}`;

        if (!step || typeof step !== "object") {
            errors.push(`${stepLabel}: not a valid object`);
            continue;
        }

        // ── Channel validation
        const channel = (step.channel || "").toLowerCase().trim();
        if (!AI_CHANNELS.includes(channel as any)) {
            errors.push(`${stepLabel}: invalid channel "${step.channel}" (must be sms, email, or voice)`);
            continue;
        }

        // ── Delay: convert delay_seconds to delay_minutes if needed
        let delayMinutes = 0;
        if (step.delay_minutes !== undefined && step.delay_minutes !== null) {
            delayMinutes = Math.max(0, Math.round(Number(step.delay_minutes) || 0));
        } else if (step.delay_seconds !== undefined && step.delay_seconds !== null) {
            // AI generated delay_seconds — convert to minutes
            const seconds = Number(step.delay_seconds) || 0;
            delayMinutes = Math.max(0, Math.round(seconds / 60));
            warnings.push(`${stepLabel}: converted delay_seconds (${seconds}) to delay_minutes (${delayMinutes})`);
        } else if (step.delay !== undefined) {
            delayMinutes = Math.max(0, Math.round(Number(step.delay) || 0));
            warnings.push(`${stepLabel}: converted 'delay' to delay_minutes`);
        }

        // ── Delay type validation
        let delayType = (step.delay_type || "fixed_delay").toLowerCase().trim();
        // Map common AI variations
        if (delayType === "after_enrollment") delayType = "immediate";
        if (delayType === "after_previous_step") delayType = "after_previous";
        if (!VALID_DELAY_TYPES.includes(delayType as any)) {
            warnings.push(`${stepLabel}: invalid delay_type "${step.delay_type}", defaulting to "fixed_delay"`);
            delayType = "fixed_delay";
        }

        // ── Content validation per channel
        let content = step.content;
        if (!content || typeof content !== "object") {
            errors.push(`${stepLabel}: missing or invalid 'content' object`);
            continue;
        }

        if (channel === "sms") {
            if (!content.body || typeof content.body !== "string") {
                if (content.message) {
                    content = { body: content.message };
                    warnings.push(`${stepLabel}: renamed content.message → content.body`);
                } else if (content.text) {
                    content = { body: content.text };
                    warnings.push(`${stepLabel}: renamed content.text → content.body`);
                } else {
                    errors.push(`${stepLabel}: SMS content missing 'body' field`);
                    continue;
                }
            }
        } else if (channel === "email") {
            if (!content.subject) {
                content.subject = "Following up on your inquiry";
                warnings.push(`${stepLabel}: email missing subject, added default`);
            }
            if (!content.body_html) {
                if (content.html) {
                    content.body_html = content.html;
                    delete content.html;
                    warnings.push(`${stepLabel}: renamed content.html → content.body_html`);
                } else if (content.body_text || content.body) {
                    content.body_html = `<p>${content.body_text || content.body}</p>`;
                    warnings.push(`${stepLabel}: generated body_html from text`);
                } else {
                    errors.push(`${stepLabel}: email content missing body (no body_html, body_text, or body)`);
                    continue;
                }
            }
            if (!content.body_text) {
                content.body_text = (content.body_html || "").replace(/<[^>]+>/g, "").trim() || "Hi, we wanted to follow up.";
            }
        } else if (channel === "voice") {
            if (!content.first_message) {
                if (content.greeting || content.opening) {
                    content.first_message = content.greeting || content.opening;
                    warnings.push(`${stepLabel}: renamed content.greeting/opening → content.first_message`);
                } else {
                    errors.push(`${stepLabel}: voice content missing 'first_message'`);
                    continue;
                }
            }
            if (!content.system_prompt) {
                if (content.instructions || content.prompt) {
                    content.system_prompt = content.instructions || content.prompt;
                    warnings.push(`${stepLabel}: renamed content.instructions/prompt → content.system_prompt`);
                } else {
                    content.system_prompt = `You are a follow-up specialist for {{business_name}}. Be friendly and professional. Help the contact with their inquiry and try to book an appointment.`;
                    warnings.push(`${stepLabel}: voice missing system_prompt, added default`);
                }
            }
        }

        // ── skip_conditions
        let skipConditions = step.skip_conditions || null;
        if (skipConditions && typeof skipConditions === "object") {
            if (Array.isArray(skipConditions.skip_if)) {
                skipConditions.skip_if = skipConditions.skip_if.filter(
                    (v: string) => VALID_SKIP_IF.includes(v as any)
                );
                if (skipConditions.skip_if.length === 0) delete skipConditions.skip_if;
            }
        }

        // ── on_success
        let onSuccess = step.on_success || { action: "continue" };
        if (typeof onSuccess === "string") onSuccess = { action: onSuccess };
        if (!VALID_SUCCESS_ACTIONS.includes(onSuccess.action as any)) {
            onSuccess = { action: "continue" };
        }

        // ── on_failure
        let onFailure = step.on_failure || { action: "skip" };
        if (typeof onFailure === "string") onFailure = { action: onFailure };
        if (!VALID_FAILURE_ACTIONS.includes(onFailure.action as any)) {
            onFailure = { action: "skip" };
        }

        validatedSteps.push({
            step_order: Number(step.step_order) || (i + 1),
            channel,
            delay_minutes: delayMinutes,
            delay_type: delayType,
            content,
            skip_conditions: skipConditions,
            on_success: onSuccess,
            on_failure: onFailure,
        });
    }

    if (validatedSteps.length === 0 && errors.length > 0) {
        return { valid: false, errors, warnings };
    }

    if (warnings.length > 0) {
        console.log("[validateAndTransform] Warnings:", warnings.join("; "));
    }

    return {
        valid: errors.length === 0 || validatedSteps.length > 0,
        name: raw.name || "Generated Sequence",
        description: raw.description || null,
        steps: validatedSteps,
        errors,
        warnings,
    };
}

// ─── AI Repair: send invalid JSON back for correction ────────────────────────

async function repairWithAI(invalidJSON: any, validationErrors: string[]): Promise<any> {
    const openrouter = getOpenRouterClient();

    const repairPrompt = `The following JSON was generated for a sequence automation system but failed schema validation.

VALIDATION ERRORS:
${validationErrors.map((e) => `- ${e}`).join("\n")}

ORIGINAL (INVALID) JSON:
${JSON.stringify(invalidJSON, null, 2).substring(0, 4000)}

CORRECT SCHEMA FOR sequence_steps:
- step_order: INT (1, 2, 3...)
- channel: TEXT ("sms", "email", or "voice")
- delay_minutes: INT (delay in MINUTES, not seconds. e.g. 60 = 1 hour, 1440 = 1 day)
- delay_type: TEXT ("immediate", "fixed_delay", "business_hours_only", "after_previous")
- content: JSONB — depends on channel:
    SMS:   {"body": "message text"}
    Email: {"subject": "...", "body_html": "<p>...</p>", "body_text": "plain text version"}
    Voice: {"first_message": "opening greeting", "system_prompt": "full agent instructions"}
- skip_conditions: JSONB ({"skip_if": ["contact_replied", "appointment_booked"]})
- on_success: JSONB ({"action": "continue"} or {"action": "jump_to_step", "target_step": 3} or {"action": "end_sequence"})
- on_failure: JSONB ({"action": "skip"} or {"action": "retry_after_seconds", "retry_delay": 3600} or {"action": "end_sequence"})

IMPORTANT:
- Use delay_minutes (NOT delay_seconds)
- Use the exact content field names per channel shown above
- Do NOT add any extra fields beyond the ones listed above
- Fix ALL validation errors listed above

Output the corrected JSON object with the same structure: {"name": "...", "description": "...", "steps": [...]}`;

    const completion = await openrouter.chat.completions.create({
        model: GENERATION_MODEL,
        temperature: 0.2,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: repairPrompt },
            { role: "user", content: "Fix the JSON and return the corrected version. Output ONLY the JSON object." },
        ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Repair model returned empty response");
    return extractJSON(raw);
}

// ─── VAPI Agent Lookup ───────────────────────────────────────────────────────
// Look up the client's outbound VAPI agent so voice steps can reference it
// instead of generating redundant system prompts.

async function getOutboundVapiId(clientId: string): Promise<string | null> {
    const { data } = await supabase
        .from("agents")
        .select("vapi_id")
        .eq("client_id", clientId)
        .eq("agent_type", "outbound")
        .limit(1)
        .single();
    return data?.vapi_id || null;
}

// Inject vapi_assistant_id into voice step content when an outbound agent exists.
// This tells the sequencer to use the existing VAPI assistant instead of creating
// an inline one from the system_prompt.
function injectVapiAssistantId(steps: ValidatedStep[], vapiId: string): ValidatedStep[] {
    return steps.map(step => {
        if (step.channel === "voice") {
            return {
                ...step,
                content: {
                    ...step.content,
                    vapi_assistant_id: vapiId,
                },
            };
        }
        return step;
    });
}

// ─── Shared DB Insert Helpers ────────────────────────────────────────────────

async function insertSequence(
    clientId: string,
    name: string,
    description: string | null,
    triggerType: string,
    urgencyTier: string,
    options?: {
        generation_mode?: "static" | "dynamic";
        sequence_strategy?: Record<string, any> | null;
    }
) {
    return supabase
        .from("sequences")
        .insert({
            client_id: clientId,
            name,
            description,
            trigger_type: triggerType || "manual",
            urgency_tier: urgencyTier || "medium",
            ai_generated: true,
            is_active: false,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "moderate",
            generation_mode: options?.generation_mode || "static",
            sequence_strategy: options?.sequence_strategy || null,
        })
        .select("id")
        .single();
}

async function insertSteps(sequenceId: string, steps: ValidatedStep[]) {
    let insertedCount = 0;
    const stepErrors: string[] = [];

    for (const step of steps) {
        const mutationInstructions = step.channel === "sms"
            ? "Keep under 160 chars. Reference prior conversation naturally. Match brand voice."
            : step.channel === "email"
            ? "Reference prior interactions in the opening. Address known objections. Keep professional tone."
            : step.channel === "voice"
            ? "Adjust opening based on prior calls. Reference any objections or topics discussed."
            : null;

        const { error: stepError } = await supabase
            .from("sequence_steps")
            .insert({
                sequence_id: sequenceId,
                step_order: step.step_order,
                channel: step.channel,
                delay_minutes: step.delay_minutes,
                delay_type: step.delay_type,
                content: step.content,
                skip_conditions: step.skip_conditions,
                on_success: step.on_success,
                on_failure: step.on_failure,
                enable_ai_mutation: true,
                mutation_instructions: mutationInstructions,
            });

        if (stepError) {
            console.error(`Error inserting step ${step.step_order}:`, stepError);
            stepErrors.push(`Step ${step.step_order}: ${stepError.message}`);
        } else {
            insertedCount++;
        }
    }

    return { insertedCount, stepErrors };
}

// ─── Generation Prompt (shared between confirmAndGenerate and generateAISequence)

const STEP_SCHEMA_INSTRUCTIONS = `
EXACT DB SCHEMA FOR EACH STEP:
- step_order: integer (1, 2, 3...)
- channel: "sms", "email", or "voice"
- delay_minutes: integer — delay in MINUTES (not seconds!). Examples: 0 = immediate, 30 = 30 min, 120 = 2 hours, 1440 = 1 day
- delay_type: "immediate", "fixed_delay", "business_hours_only", or "after_previous"
- content: JSON object — format depends on channel:
    SMS:   {"body": "Hi {{first_name}}, this is {{business_name}}..."}
    Email: {"subject": "Subject line", "body_html": "<p>HTML content</p>", "body_text": "Plain text version"}
    Voice: {"first_message": "Opening greeting for the call", "system_prompt": "Full instructions for the AI voice agent"}
- skip_conditions: {"skip_if": ["contact_replied", "appointment_booked"]} (optional)
- on_success: {"action": "continue"} or {"action": "jump_to_step", "target_step": 3} or {"action": "end_sequence"}
- on_failure: {"action": "skip"} or {"action": "retry_after_seconds", "retry_delay": 60} or {"action": "end_sequence"}

CRITICAL: Use "delay_minutes" (NOT "delay_seconds"). Values are in MINUTES.
CRITICAL: Only use the fields listed above. Do NOT add any extra fields.

DYNAMIC TEMPLATE VARIABLES:
These placeholders are resolved per-lead at execution time. Use them in step content to make messages personalized:

Contact variables: {{first_name}}, {{last_name}}, {{customer_name}}, {{phone}}, {{email}}, {{company}}
Business variables: {{business_name}}, {{callback_number}}, {{property_address}}
Conversation context (resolved from prior interactions — empty string if no history):
  {{last_call_summary}} — summary of the most recent phone call
  {{last_call_objections}} — objections raised on the last call
  {{last_sms_reply}} — the lead's most recent SMS reply text
  {{last_sms_reply_intent}} — detected intent of last SMS (e.g. "interested", "not_interested")
  {{overall_sentiment}} — lead's overall sentiment across all channels (positive/neutral/negative)
  {{objections_raised}} — all known objections accumulated across interactions
  {{key_topics}} — topics discussed across all interactions
  {{interaction_count}} — human-readable count like "2 calls, 3 SMS, 1 emails"
  {{days_since_first_contact}} — days since the first interaction

PERSONALIZATION RULES:
- Step 1 (first contact): Use basic contact variables ({{first_name}}, {{business_name}})
- Steps 2+: USE conversation context variables. For example:
  - SMS: "Hi {{first_name}}, following up on our conversation{{last_call_summary}}. {{business_name}} is here to help."
  - Email: Reference {{objections_raised}} to proactively address concerns
  - Voice first_message: "Hi {{first_name}}, I'm calling from {{business_name}} to follow up on {{key_topics}}."
- If referencing conversation history, wrap it naturally — these vars may be empty on first contact

EXAMPLE OUTPUT (2-step sequence):
{
  "name": "New Lead Follow-up",
  "description": "Automated follow-up for new leads with SMS and voice",
  "steps": [
    {
      "step_order": 1,
      "channel": "sms",
      "delay_minutes": 0,
      "delay_type": "immediate",
      "content": {"body": "Hi {{first_name}}, thanks for reaching out to {{business_name}}! We received your inquiry and will be in touch shortly. Reply STOP to opt out."},
      "skip_conditions": {"skip_if": ["contact_replied", "appointment_booked"]},
      "on_success": {"action": "continue"},
      "on_failure": {"action": "skip"}
    },
    {
      "step_order": 2,
      "channel": "voice",
      "delay_minutes": 120,
      "delay_type": "after_previous",
      "content": {"first_message": "Hi {{first_name}}, this is the team at {{business_name}} following up on your recent inquiry.", "system_prompt": "You are a follow-up specialist for {{business_name}}. Your goal is to understand their needs and book an appointment. Be friendly and professional."},
      "skip_conditions": {"skip_if": ["contact_replied", "contact_answered_call", "appointment_booked"]},
      "on_success": {"action": "end_sequence"},
      "on_failure": {"action": "retry_after_seconds", "retry_delay": 60}
    }
  ]
}`;

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
    systemPromptContext: string,
    generationMode: "static" | "dynamic" = "static"
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
5. Use dynamic template variables for personalization (see DYNAMIC TEMPLATE VARIABLES in schema below). For steps after the first, use conversation context variables like {{last_call_summary}}, {{objections_raised}}, {{overall_sentiment}} to reference prior interactions.
6. Channel timing (in delay_minutes):
   - SMS: 0-30 min for urgent, 60-240 for medium
   - Voice: 60-240 min delay minimum (let SMS land first)
   - Email: 240-1440 min gaps (4-24 hours)
7. Last step should have on_success: {"action": "end_sequence"}

${STEP_SCHEMA_INSTRUCTIONS}

Generate the full sequence. Respond with ONLY the JSON object.`;

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

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            console.error("Empty model response. Full choice:", JSON.stringify(completion.choices[0]));
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        console.log("[confirmAndGenerate] Raw response length:", raw.length);

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch (parseErr) {
            console.error("Failed to parse AI JSON. Raw:", raw.substring(0, 500));
            return { success: false, error: "AI response could not be parsed as JSON. Please try again." };
        }

        // ── Validate against DB schema
        let validation = validateAndTransformSequence(generated);

        // If validation failed, attempt one AI repair
        if (!validation.valid || !validation.steps || validation.steps.length === 0) {
            console.log("[confirmAndGenerate] Validation failed, attempting repair:", validation.errors);
            try {
                const repaired = await repairWithAI(generated, validation.errors);
                validation = validateAndTransformSequence(repaired);
                if (!validation.valid || !validation.steps || validation.steps.length === 0) {
                    return { success: false, error: `Sequence failed schema validation after repair: ${validation.errors.join(", ")}` };
                }
                console.log("[confirmAndGenerate] Repair successful");
            } catch (repairErr) {
                console.error("Repair failed:", repairErr);
                return { success: false, error: `Sequence failed schema validation: ${validation.errors.join(", ")}` };
            }
        }

        // ── Inject VAPI assistant ID into voice steps
        const hasVoiceSteps = validation.steps!.some(s => s.channel === "voice");
        if (hasVoiceSteps) {
            const vapiId = await getOutboundVapiId(clientId);
            if (vapiId) {
                validation.steps = injectVapiAssistantId(validation.steps!, vapiId);
            }
        }

        // ── Build sequence strategy for dynamic mode
        const sequenceStrategy = generationMode === "dynamic" ? {
            goal: plan.goal,
            max_steps: plan.step_count,
            available_channels: plan.channels as ("sms" | "email" | "voice")[],
            agent_context: plan.summary,
            planned_steps: validation.steps, // informational: full plan
        } : null;

        // ── Insert sequence
        const { data: sequence, error: seqError } = await insertSequence(
            clientId,
            validation.name!,
            validation.description || null,
            plan.trigger_type,
            plan.urgency_tier,
            { generation_mode: generationMode, sequence_strategy: sequenceStrategy }
        );

        if (seqError || !sequence) {
            return { success: false, error: `Failed to create sequence: ${seqError?.message || "Unknown error"}` };
        }

        // ── Insert steps: for dynamic mode, only insert step 1
        const stepsToInsert = generationMode === "dynamic"
            ? validation.steps!.slice(0, 1)
            : validation.steps!;

        const { insertedCount, stepErrors } = await insertSteps(sequence.id, stepsToInsert);

        if (insertedCount === 0) {
            console.error("All step inserts failed:", stepErrors);
            await supabase.from("sequences").delete().eq("id", sequence.id);
            return { success: false, error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.` };
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("confirmAndGenerate error:", err);
        return { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred" };
    }
}

// ═══════════════════════════════════════════════════════════
// Legacy Functions (updated to use OpenRouter + validation)
// ═══════════════════════════════════════════════════════════

export async function generateAISequence(
    clientId: string,
    userPrompt: string,
    options?: { triggerType?: string; urgencyTier?: string; generationMode?: "static" | "dynamic"; maxSteps?: number }
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
5. Use dynamic template variables for personalization (see DYNAMIC TEMPLATE VARIABLES in schema below). For steps after the first, use conversation context variables like {{last_call_summary}}, {{objections_raised}}, {{overall_sentiment}} to reference prior interactions.

${STEP_SCHEMA_INSTRUCTIONS}`;

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
                { role: "user", content: "Generate the sequence now. Output ONLY the JSON object." },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch {
            return { success: false, error: "AI response could not be parsed. Please try again." };
        }

        // ── Validate against DB schema
        let validation = validateAndTransformSequence(generated);

        if (!validation.valid || !validation.steps || validation.steps.length === 0) {
            try {
                const repaired = await repairWithAI(generated, validation.errors);
                validation = validateAndTransformSequence(repaired);
                if (!validation.valid || !validation.steps || validation.steps.length === 0) {
                    return { success: false, error: `Schema validation failed: ${validation.errors.join(", ")}` };
                }
            } catch {
                return { success: false, error: `Schema validation failed: ${validation.errors.join(", ")}` };
            }
        }

        const triggerType = options?.triggerType || generated.trigger_type || "manual";
        const urgencyTier = options?.urgencyTier || generated.urgency_tier || "medium";
        const generationMode = options?.generationMode || "static";

        // ── Inject VAPI assistant ID into voice steps
        const hasVoiceSteps = validation.steps!.some(s => s.channel === "voice");
        if (hasVoiceSteps) {
            const vapiId = await getOutboundVapiId(clientId);
            if (vapiId) {
                validation.steps = injectVapiAssistantId(validation.steps!, vapiId);
            }
        }

        // ── Build sequence strategy for dynamic mode
        const sequenceStrategy = generationMode === "dynamic" ? {
            goal: generated.description || "Follow up with lead",
            max_steps: options?.maxSteps || validation.steps!.length,
            available_channels: [...new Set(validation.steps!.map(s => s.channel))] as ("sms" | "email" | "voice")[],
            agent_context: userPrompt,
            planned_steps: validation.steps,
        } : null;

        const { data: sequence, error: seqError } = await insertSequence(
            clientId, validation.name!, validation.description || null, triggerType, urgencyTier,
            { generation_mode: generationMode, sequence_strategy: sequenceStrategy }
        );

        if (seqError || !sequence) {
            return { success: false, error: `Failed to create sequence: ${seqError?.message || "Unknown error"}` };
        }

        // For dynamic mode, only insert step 1
        const stepsToInsert = generationMode === "dynamic"
            ? validation.steps!.slice(0, 1)
            : validation.steps!;

        const { insertedCount, stepErrors } = await insertSteps(sequence.id, stepsToInsert);

        if (insertedCount === 0) {
            await supabase.from("sequences").delete().eq("id", sequence.id);
            return { success: false, error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.` };
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("generateAISequence error:", err);
        return { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred" };
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
            return { success: false, error: `Sequence not found: ${seqFetchError?.message || "Unknown error"}` };
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

        const startOrder = existingSteps && existingSteps.length > 0
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
3. Use dynamic template variables for personalization (see DYNAMIC TEMPLATE VARIABLES in schema below). Since these are follow-up steps, USE conversation context variables like {{last_call_summary}}, {{objections_raised}}, {{last_sms_reply}} to make messages reference prior interactions.

${STEP_SCHEMA_INSTRUCTIONS}`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.4,
            max_tokens: 6000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Generate the additional steps now. Output ONLY the JSON object." },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "Model returned an empty response. Please try again." };
        }

        let generated: any;
        try {
            generated = extractJSON(raw);
        } catch {
            return { success: false, error: "AI response could not be parsed. Please try again." };
        }

        // Wrap in sequence-like structure for validation
        const wrapped = { name: existingSequence.name, steps: generated.steps || [] };
        let validation = validateAndTransformSequence(wrapped);

        if (!validation.valid || !validation.steps || validation.steps.length === 0) {
            try {
                const repaired = await repairWithAI(wrapped, validation.errors);
                validation = validateAndTransformSequence(repaired);
                if (!validation.valid || !validation.steps || validation.steps.length === 0) {
                    return { success: false, error: `Schema validation failed: ${validation.errors.join(", ")}` };
                }
            } catch {
                return { success: false, error: `Schema validation failed: ${validation.errors.join(", ")}` };
            }
        }

        // Re-number steps starting at startOrder
        validation.steps!.forEach((step, i) => {
            step.step_order = startOrder + i;
        });

        // ── Inject VAPI assistant ID into voice steps
        const hasVoiceSteps = validation.steps!.some(s => s.channel === "voice");
        if (hasVoiceSteps) {
            const vapiId = await getOutboundVapiId(clientId);
            if (vapiId) {
                validation.steps = injectVapiAssistantId(validation.steps!, vapiId);
            }
        }

        const { insertedCount, stepErrors } = await insertSteps(sequenceId, validation.steps!);

        if (insertedCount === 0) {
            return { success: false, error: `Failed to create steps: ${stepErrors[0] || "Unknown error"}. Please try again.` };
        }

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, stepCount: insertedCount };
    } catch (err) {
        console.error("generateAIStepsForSequence error:", err);
        return { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred" };
    }
}

// ═══════════════════════════════════════════════════════════
// Task-Based Sequence Creation (Phase 2)
// Natural language instruction → dynamic sequence with step 1
// ═══════════════════════════════════════════════════════════

export interface TaskExtractionResult {
    goal: string;
    channels: ("sms" | "email" | "voice")[];
    max_steps: number;
    urgency: "critical" | "high" | "medium" | "low";
    first_step: {
        channel: "sms" | "email" | "voice";
        content: Record<string, any>;
    };
}

export async function createTaskFromDescription(
    clientId: string,
    instruction: string,
    csvColumns?: string[],
    availableChannels?: { sms: { ready: boolean }; email: { ready: boolean }; voice: { ready: boolean } }
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
    try {
        // ── Fetch tenant profile for business context
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const p = profile || DEFAULT_PROFILE;

        // ── Determine which channels are actually available
        const readyChannels: string[] = [];
        if (availableChannels) {
            if (availableChannels.sms?.ready) readyChannels.push("sms");
            if (availableChannels.email?.ready) readyChannels.push("email");
            if (availableChannels.voice?.ready) readyChannels.push("voice");
        } else {
            readyChannels.push("sms", "email", "voice");
        }

        if (readyChannels.length === 0) {
            return { success: false, error: "No channels are available. Please configure at least one channel (SMS, email, or voice) before creating a task." };
        }

        // ── Build CSV context for the prompt
        const csvContext = csvColumns && csvColumns.length > 0
            ? `\n\nCSV COLUMNS AVAILABLE (use as {{column_name}} placeholders in generated content):\n${csvColumns.map(c => `- {{${c}}}`).join("\n")}\nIMPORTANT: Use these column names as template variables in the step content where appropriate. For example, if there's a "first_name" column, use {{first_name}} in greetings.`
            : "";

        // ── Build the extraction prompt
        const extractionPrompt = `You are an expert marketing automation strategist. Analyze a plain-text task instruction and extract a structured plan for an automated outreach sequence.

BUSINESS PROFILE:
- Business: ${p.business_name || "Business"}
- Industry: ${buildIndustryContext(p.industry, p.sub_industry)}
- Brand Voice: ${p.brand_voice || "professional"}
- Primary Goal: ${p.primary_goal || "book_appointment"}
- Timezone: ${p.timezone || "America/New_York"}

AVAILABLE CHANNELS (only use these): ${readyChannels.join(", ")}
${csvContext}

USER INSTRUCTION:
"${instruction}"

Extract the following as a JSON object:
{
  "goal": "brief description of the task's goal (1 sentence)",
  "channels": ["sms", "email", "voice"],  // subset of available channels that make sense for this task
  "max_steps": 5,  // reasonable number of steps (1-10) for this task
  "urgency": "high",  // "critical", "high", "medium", or "low"
  "sequence_name": "Short Task Name",  // concise name for this task sequence (2-5 words)
  "first_step": {
    "channel": "sms",  // best channel for step 1
    "content": {}  // content object matching the channel format below
  }
}

CHANNEL CONTENT FORMATS:
- SMS: {"body": "Hi {{first_name}}, ..."}
- Email: {"subject": "Subject", "body_html": "<p>HTML content</p>", "body_text": "Plain text"}
- Voice: {"first_message": "Opening greeting", "system_prompt": "Full AI agent instructions"}

RULES:
1. Only include channels from the AVAILABLE CHANNELS list
2. If the instruction mentions specific channels, prefer those
3. For urgent/time-sensitive tasks, start with SMS or voice
4. For informational/nurture tasks, email is fine as first step
5. Use template variables ({{first_name}}, {{business_name}}, etc.) for personalization
${csvColumns && csvColumns.length > 0 ? "6. Use CSV column variables where they naturally fit in the content" : ""}
7. Match the business's brand voice
8. Keep SMS under 160 characters
9. TCPA compliance: mention reasonable contact hours

Output ONLY the JSON object.`;

        const openrouter = getOpenRouterClient();

        const completion = await openrouter.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.3,
            max_tokens: 2000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: extractionPrompt },
                { role: "user", content: "Extract the task plan and generate step 1. Output ONLY the JSON object." },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "AI returned an empty response. Please try again." };
        }

        console.log("[createTaskFromDescription] Raw response length:", raw.length);

        let extracted: any;
        try {
            extracted = extractJSON(raw);
        } catch {
            return { success: false, error: "Could not parse AI response. Please try again." };
        }

        // ── Validate extracted plan
        if (!extracted.goal || !extracted.first_step?.channel || !extracted.first_step?.content) {
            return { success: false, error: "AI extraction was incomplete. Please provide more detail in your instruction." };
        }

        // ── Validate and filter channels to only available ones
        const channels = (extracted.channels || [extracted.first_step.channel])
            .filter((ch: string) => readyChannels.includes(ch));
        if (channels.length === 0) {
            return { success: false, error: "None of the AI-suggested channels are available. Please configure your channels first." };
        }

        // ── Validate first step channel
        const firstStepChannel = readyChannels.includes(extracted.first_step.channel)
            ? extracted.first_step.channel
            : channels[0];

        // ── Validate first step content using the existing validator
        const mockStepForValidation = {
            step_order: 1,
            channel: firstStepChannel,
            delay_minutes: 0,
            delay_type: "immediate",
            content: extracted.first_step.content,
            skip_conditions: { skip_if: ["contact_replied", "appointment_booked"] },
            on_success: { action: "continue" },
            on_failure: { action: "skip" },
        };

        const mockSequence = {
            name: extracted.sequence_name || "Task Sequence",
            steps: [mockStepForValidation],
        };

        let validation = validateAndTransformSequence(mockSequence);

        if (!validation.valid || !validation.steps || validation.steps.length === 0) {
            // Attempt repair
            try {
                const repaired = await repairWithAI(mockSequence, validation.errors);
                validation = validateAndTransformSequence(repaired);
                if (!validation.valid || !validation.steps || validation.steps.length === 0) {
                    return { success: false, error: `Step validation failed: ${validation.errors.join(", ")}` };
                }
            } catch {
                return { success: false, error: `Step validation failed: ${validation.errors.join(", ")}` };
            }
        }

        // ── Inject VAPI assistant ID for voice steps
        if (validation.steps![0].channel === "voice") {
            const vapiId = await getOutboundVapiId(clientId);
            if (vapiId) {
                validation.steps = injectVapiAssistantId(validation.steps!, vapiId);
            }
        }

        // ── Build sequence strategy for dynamic JIT generation
        const sequenceStrategy = {
            goal: extracted.goal,
            max_steps: Math.min(Math.max(extracted.max_steps || 5, 1), 10),
            available_channels: channels as ("sms" | "email" | "voice")[],
            agent_context: instruction,
            csv_columns: csvColumns || null,
        };

        const urgency = ["critical", "high", "medium", "low"].includes(extracted.urgency)
            ? extracted.urgency
            : "medium";

        // ── Insert sequence with is_task metadata
        const { data: sequence, error: seqError } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name: extracted.sequence_name || "Task Sequence",
                description: extracted.goal,
                trigger_type: "manual",
                urgency_tier: urgency,
                ai_generated: true,
                is_active: false,
                enable_adaptive_mutation: true,
                mutation_aggressiveness: "moderate",
                generation_mode: "dynamic",
                sequence_strategy: sequenceStrategy,
                metadata: { is_task: true, source_instruction: instruction },
            })
            .select("id")
            .single();

        if (seqError || !sequence) {
            // If metadata column doesn't exist, retry without it
            if (seqError?.message?.includes("metadata")) {
                console.log("[createTaskFromDescription] metadata column not found, inserting without it");
                const { data: seq2, error: seqError2 } = await insertSequence(
                    clientId,
                    extracted.sequence_name || "Task Sequence",
                    extracted.goal,
                    "manual",
                    urgency,
                    {
                        generation_mode: "dynamic",
                        sequence_strategy: { ...sequenceStrategy, is_task: true, source_instruction: instruction },
                    }
                );

                if (seqError2 || !seq2) {
                    return { success: false, error: `Failed to create task sequence: ${seqError2?.message || "Unknown error"}` };
                }

                // Insert step 1
                const { insertedCount, stepErrors } = await insertSteps(seq2.id, validation.steps!);
                if (insertedCount === 0) {
                    await supabase.from("sequences").delete().eq("id", seq2.id);
                    return { success: false, error: `Failed to create first step: ${stepErrors[0] || "Unknown error"}` };
                }

                revalidatePath(`/client/${clientId}/sequences`);
                return { success: true, sequenceId: seq2.id };
            }

            return { success: false, error: `Failed to create task sequence: ${seqError?.message || "Unknown error"}` };
        }

        // ── Insert only step 1 (rest generated JIT at runtime)
        const { insertedCount, stepErrors } = await insertSteps(sequence.id, validation.steps!);

        if (insertedCount === 0) {
            await supabase.from("sequences").delete().eq("id", sequence.id);
            return { success: false, error: `Failed to create first step: ${stepErrors[0] || "Unknown error"}` };
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: sequence.id };
    } catch (err) {
        console.error("createTaskFromDescription error:", err);
        return { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred" };
    }
}
