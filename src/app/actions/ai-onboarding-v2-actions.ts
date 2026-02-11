"use server";

import OpenAI from "openai";
import type { AIFieldMeta } from "@/components/onboarding/types";
import type { AIAnalysisV2Result } from "@/components/onboarding-v2/types";
import type { SuggestedAgent, AgentCategory } from "@/lib/agent-catalog";

// ═══════════════════════════════════════════════════════════
// V2 AI ANALYSIS — Website analysis + Dynamic Agent Fleet
// Agents are generated DYNAMICALLY per business, not from
// a fixed catalog. GPT invents agents specific to the
// business type, industry, and services.
// ═══════════════════════════════════════════════════════════

const ANALYSIS_INSTRUCTIONS = `You are a business analyst AI building an AI voice agent call center. You will be given a business website URL. Use web search to find and analyze the website, then:
1. Extract comprehensive business profile information
2. INVENT AI agents SPECIFIC to this business — do NOT use generic templates

CRITICAL: Generate agents that are CUSTOM-TAILORED to this specific business.
Examples:
- A dental office might get: "Inbound Receptionist", "New Patient Welcome Caller", "Insurance Verification Agent", "Post-Treatment Review Requester", "Appointment Reminder"
- An HVAC company might get: "Inbound Receptionist", "Emergency Service Dispatcher", "Lead Follow-Up Specialist", "Seasonal Maintenance Caller", "Review Collector"
- A law firm might get: "Inbound Intake Specialist", "Case Status Caller", "Consultation Reminder", "Client Follow-Up Agent"
- A restaurant might get: "Inbound Reservation Agent", "Party/Catering Follow-Up", "Review & Feedback Collector"

AGENT RULES:
- ALWAYS include an inbound receptionist as the first agent (confidence 1.0, enabled true)
- Generate 4-8 total agents based on the business needs
- Each agent must have a UNIQUE purpose specific to this business
- type_id should be a slug (lowercase, underscores) generated from the agent name
- direction: "inbound" for agents that receive calls, "outbound" for agents that make calls
- category: classify as "inbound", "follow_up", "marketing", "retention", or "operations"
- reasoning: explain WHY this specific agent would help THIS business
- suggested_override_variables: list variable names the agent would need at runtime (e.g. "patient_name", "appointment_date")
- Set confidence > 0.7 for strongly recommended agents
- Set enabled=true for agents with confidence > 0.7

PROFILE FIELD CONSTRAINTS:
- industry: MUST be one of: home_services, real_estate, healthcare, legal, automotive, restaurant, retail, professional_services, other
- brand_voice: MUST be one of: professional, friendly, casual, authoritative
- timezone: MUST be one of: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix, America/Anchorage, Pacific/Honolulu
- after_hours_behavior: MUST be one of: voicemail, emergency_forward, schedule_callback, ai_handle
- primary_goal: MUST be one of: book_appointment, phone_qualification, direct_schedule, collect_info, transfer_to_agent
- lead_sources items: MUST be from: google_ads, facebook_ads, yelp, thumbtack, angi, homeadvisor, referral, website_form, phone_call, other
- urgency_tier in job_types: MUST be one of: critical, high, medium, low
- business_hours keys: mon-sun with open (HH:MM), close (HH:MM), closed (boolean)
- confidence values: MUST be one of: high, medium, low`;

const RESPONSE_SCHEMA = {
    type: "object" as const,
    properties: {
        business_name: { type: "string" as const },
        business_name_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        industry: { type: "string" as const },
        industry_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        sub_industry: { type: "string" as const },
        sub_industry_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        business_description: { type: "string" as const },
        business_description_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        service_area: {
            type: "object" as const,
            properties: {
                cities: { type: "array" as const, items: { type: "string" as const } },
                zip_codes: { type: "array" as const, items: { type: "string" as const } },
                radius_miles: { type: "number" as const },
            },
            required: ["cities", "zip_codes", "radius_miles"] as const,
            additionalProperties: false,
        },
        service_area_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        job_types: {
            type: "array" as const,
            items: {
                type: "object" as const,
                properties: {
                    name: { type: "string" as const },
                    urgency_tier: { type: "string" as const },
                    avg_ticket: { type: "string" as const },
                    keywords: { type: "string" as const },
                },
                required: ["name", "urgency_tier", "avg_ticket", "keywords"] as const,
                additionalProperties: false,
            },
        },
        job_types_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        brand_voice: { type: "string" as const },
        brand_voice_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        custom_phrases: {
            type: "object" as const,
            properties: {
                always_mention: { type: "array" as const, items: { type: "string" as const } },
                never_say: { type: "array" as const, items: { type: "string" as const } },
            },
            required: ["always_mention", "never_say"] as const,
            additionalProperties: false,
        },
        custom_phrases_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        greeting_style: { type: "string" as const },
        greeting_style_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        timezone: { type: "string" as const },
        timezone_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        business_hours: {
            type: "object" as const,
            properties: {
                mon: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                tue: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                wed: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                thu: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                fri: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                sat: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
                sun: { type: "object" as const, properties: { open: { type: "string" as const }, close: { type: "string" as const }, closed: { type: "boolean" as const } }, required: ["open", "close", "closed"] as const, additionalProperties: false },
            },
            required: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const,
            additionalProperties: false,
        },
        business_hours_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        after_hours_behavior: { type: "string" as const },
        after_hours_behavior_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        emergency_phone: { type: "string" as const },
        emergency_phone_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        lead_sources: { type: "array" as const, items: { type: "string" as const } },
        lead_sources_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        primary_goal: { type: "string" as const },
        primary_goal_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        qualification_criteria: {
            type: "object" as const,
            properties: {
                must_have: { type: "array" as const, items: { type: "string" as const } },
                nice_to_have: { type: "array" as const, items: { type: "string" as const } },
                disqualifiers: { type: "array" as const, items: { type: "string" as const } },
            },
            required: ["must_have", "nice_to_have", "disqualifiers"] as const,
            additionalProperties: false,
        },
        qualification_criteria_confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
        agent_suggestions: {
            type: "array" as const,
            items: {
                type: "object" as const,
                properties: {
                    name: { type: "string" as const },
                    type_id: { type: "string" as const },
                    purpose: { type: "string" as const },
                    direction: { type: "string" as const, enum: ["inbound", "outbound"] },
                    category: { type: "string" as const, enum: ["inbound", "follow_up", "marketing", "retention", "operations"] },
                    confidence: { type: "number" as const },
                    reasoning: { type: "string" as const },
                    enabled: { type: "boolean" as const },
                    suggested_override_variables: { type: "array" as const, items: { type: "string" as const } },
                },
                required: ["name", "type_id", "purpose", "direction", "category", "confidence", "reasoning", "enabled", "suggested_override_variables"] as const,
                additionalProperties: false,
            },
        },
    },
    required: [
        "business_name", "business_name_confidence",
        "industry", "industry_confidence",
        "sub_industry", "sub_industry_confidence",
        "business_description", "business_description_confidence",
        "service_area", "service_area_confidence",
        "job_types", "job_types_confidence",
        "brand_voice", "brand_voice_confidence",
        "custom_phrases", "custom_phrases_confidence",
        "greeting_style", "greeting_style_confidence",
        "timezone", "timezone_confidence",
        "business_hours", "business_hours_confidence",
        "after_hours_behavior", "after_hours_behavior_confidence",
        "emergency_phone", "emergency_phone_confidence",
        "lead_sources", "lead_sources_confidence",
        "primary_goal", "primary_goal_confidence",
        "qualification_criteria", "qualification_criteria_confidence",
        "agent_suggestions",
    ] as const,
    additionalProperties: false,
};

export async function analyzeBusinessWebsiteV2(websiteUrl: string): Promise<AIAnalysisV2Result> {
    // Validate URL
    try {
        const parsed = new URL(websiteUrl);
        if (!parsed.protocol.startsWith("http")) {
            return { success: false, profile: null, fieldMeta: {}, agentSuggestions: [], businessName: "", industry: "", error: "Please enter a valid URL starting with http:// or https://" };
        }
    } catch {
        return { success: false, profile: null, fieldMeta: {}, agentSuggestions: [], businessName: "", industry: "", error: "Please enter a valid website URL" };
    }

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 60000,
        });

        const response = await openai.responses.create({
            model: "gpt-4o",
            instructions: ANALYSIS_INSTRUCTIONS,
            input: `Search and analyze this business website, then extract all profile information and invent custom AI agents specific to this business: ${websiteUrl}`,
            tools: [
                {
                    type: "web_search" as const,
                    search_context_size: "high" as const,
                },
            ],
            text: {
                format: {
                    type: "json_schema",
                    name: "business_profile_v2",
                    strict: true,
                    schema: RESPONSE_SCHEMA,
                },
            },
            temperature: 0,
        });

        const outputText = response.output_text;
        if (!outputText) {
            return { success: false, profile: null, fieldMeta: {}, agentSuggestions: [], businessName: "", industry: "", error: "AI returned no response" };
        }

        const parsed = JSON.parse(outputText);
        return mapAIResponseToV2Result(parsed);
    } catch (error) {
        console.error("[AI ANALYSIS V2] Error:", error);

        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
            return {
                success: false, profile: null, fieldMeta: {}, agentSuggestions: [],
                businessName: "", industry: "",
                error: "AI analysis took too long. Try again or continue manually.",
            };
        }

        return {
            success: false, profile: null, fieldMeta: {}, agentSuggestions: [],
            businessName: "", industry: "",
            error: `AI analysis failed: ${errorMessage.slice(0, 120)}`,
        };
    }
}

// ─── CATEGORY MAPPING ───

const CATEGORY_MAP: Record<string, AgentCategory> = {
    inbound: "inbound",
    follow_up: "outbound_follow_up",
    marketing: "outbound_marketing",
    retention: "outbound_retention",
    operations: "outbound_follow_up", // map operations to follow_up for display
};

// ─── ICON SELECTION ───

const DIRECTION_ICONS: Record<string, string> = {
    inbound: "Phone",
    outbound: "Zap",
};

const CATEGORY_ICONS: Record<string, string> = {
    inbound: "Phone",
    follow_up: "Zap",
    marketing: "Megaphone",
    retention: "Heart",
    operations: "ClipboardCheck",
};

// ─── RESULT MAPPER ───

function mapAIResponseToV2Result(ai: Record<string, unknown>): AIAnalysisV2Result {
    const fieldMeta: Record<string, AIFieldMeta> = {};

    function meta(field: string): AIFieldMeta {
        const conf = (ai[`${field}_confidence`] as string) || "low";
        const confidence = (["high", "medium", "low"].includes(conf) ? conf : "low") as AIFieldMeta["confidence"];
        return { confidence, aiGenerated: true, userEdited: false };
    }

    // Map field metadata
    const profileFields = [
        "industry", "sub_industry", "business_description", "service_area",
        "job_types", "brand_voice", "custom_phrases", "greeting_style",
        "timezone", "business_hours", "after_hours_behavior", "emergency_phone",
        "lead_sources", "primary_goal", "qualification_criteria",
    ];
    for (const field of profileFields) {
        fieldMeta[field] = meta(field);
    }

    // Build profile
    const serviceArea = ai.service_area as { cities?: string[]; zip_codes?: string[]; radius_miles?: number } | undefined;
    const jobTypes = ai.job_types as { name: string; urgency_tier: string; avg_ticket: string; keywords: string }[] | undefined;
    const customPhrases = ai.custom_phrases as { always_mention?: string[]; never_say?: string[] } | undefined;
    const businessHours = ai.business_hours as Record<string, { open: string; close: string; closed: boolean }> | undefined;
    const qualCriteria = ai.qualification_criteria as { must_have?: string[]; nice_to_have?: string[]; disqualifiers?: string[] } | undefined;
    const leadSources = ai.lead_sources as string[] | undefined;

    const profile = {
        industry: (ai.industry as string) || "",
        sub_industry: (ai.sub_industry as string) || "",
        business_description: (ai.business_description as string) || "",
        website: "",
        service_area: {
            cities: serviceArea?.cities || [],
            zip_codes: serviceArea?.zip_codes || [],
            radius_miles: serviceArea?.radius_miles || 25,
        },
        job_types: (jobTypes || []).map((jt) => ({
            name: jt.name || "",
            urgency_tier: jt.urgency_tier || "medium",
            avg_ticket: jt.avg_ticket || "",
            keywords: jt.keywords || "",
        })),
        brand_voice: (ai.brand_voice as string) || "professional",
        custom_phrases: customPhrases ? JSON.stringify(customPhrases, null, 2) : "",
        greeting_style: (ai.greeting_style as string) || "",
        timezone: (ai.timezone as string) || "America/New_York",
        business_hours: businessHours || {},
        after_hours_behavior: (ai.after_hours_behavior as string) || "voicemail",
        emergency_phone: (ai.emergency_phone as string) || "",
        lead_sources: leadSources || ["website_form", "phone_call"],
        primary_goal: (ai.primary_goal as string) || "",
        qualification_criteria: qualCriteria ? JSON.stringify(qualCriteria, null, 2) : "",
    };

    // Build agent suggestions from GPT's DYNAMIC free-form output
    const aiSuggestions = (ai.agent_suggestions as Array<{
        name: string;
        type_id: string;
        purpose: string;
        direction: "inbound" | "outbound";
        category: string;
        confidence: number;
        reasoning: string;
        enabled: boolean;
        suggested_override_variables: string[];
    }>) || [];

    const agentSuggestions: SuggestedAgent[] = aiSuggestions.map((suggestion) => {
        const category = CATEGORY_MAP[suggestion.category] || "outbound_follow_up";
        const confidenceLabel: SuggestedAgent["confidence_label"] =
            suggestion.confidence >= 0.8 ? "highly_recommended"
                : suggestion.confidence >= 0.6 ? "recommended"
                    : "optional";

        const icon = suggestion.direction === "inbound"
            ? DIRECTION_ICONS.inbound
            : CATEGORY_ICONS[suggestion.category] || DIRECTION_ICONS.outbound;

        return {
            type_id: suggestion.type_id,
            name: suggestion.name,
            description: suggestion.purpose,
            category,
            enabled: suggestion.enabled,
            confidence: suggestion.confidence,
            confidence_label: confidenceLabel,
            icon,
            voice_id: "EXAVITQu4vr4xnSDxMaL",
            voice_name: "Sarah",
            sequence_summary: suggestion.direction === "outbound" ? "Dynamic sequence" : null,
            override_variables: (suggestion.suggested_override_variables || []).map((name) => ({
                name,
                description: name.replace(/_/g, " "),
                default_value: "",
                example: "",
            })),
            custom_instructions: null,
            is_custom: false,
            // V2 dynamic fields
            purpose: suggestion.purpose,
            direction: suggestion.direction,
            reasoning: suggestion.reasoning,
            suggested_override_variables: suggestion.suggested_override_variables,
        };
    });

    // Ensure there's always an inbound receptionist
    if (!agentSuggestions.find((a) => a.direction === "inbound" || a.type_id.includes("inbound") || a.type_id.includes("receptionist"))) {
        agentSuggestions.unshift({
            type_id: "inbound_receptionist",
            name: "Inbound Receptionist",
            description: "Handles all incoming calls, answers questions, and books appointments",
            category: "inbound",
            enabled: true,
            confidence: 1.0,
            confidence_label: "highly_recommended",
            icon: "Phone",
            voice_id: "EXAVITQu4vr4xnSDxMaL",
            voice_name: "Sarah",
            sequence_summary: null,
            override_variables: [
                { name: "customer_name", description: "Caller's name if known", default_value: "", example: "" },
            ],
            custom_instructions: null,
            is_custom: false,
            purpose: "Handles all incoming calls, answers questions, and books appointments",
            direction: "inbound",
            reasoning: "Every business needs an inbound receptionist to handle calls 24/7",
            suggested_override_variables: ["customer_name"],
        });
    }

    // Sort: inbound first, then by confidence descending
    agentSuggestions.sort((a, b) => {
        if (a.direction === "inbound" && b.direction !== "inbound") return -1;
        if (b.direction === "inbound" && a.direction !== "inbound") return 1;
        return b.confidence - a.confidence;
    });

    const businessName = (ai.business_name as string) || "";
    const industry = (ai.industry as string) || "";

    return {
        success: true,
        profile,
        fieldMeta,
        agentSuggestions,
        businessName,
        industry,
    };
}
