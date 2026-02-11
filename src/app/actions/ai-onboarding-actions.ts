"use server";

import OpenAI from "openai";
import type { AIAnalysisResult, AIFieldMeta } from "@/components/onboarding/types";

// ─── AI ANALYSIS USING RESPONSES API + WEB SEARCH ───

const ANALYSIS_INSTRUCTIONS = `You are a business analyst AI. You will be given a business website URL. Use web search to find and analyze the website content, then extract comprehensive business profile information.

For fields you cannot determine from the website content, make intelligent inferences based on the industry and context, but mark them with lower confidence.

IMPORTANT RULES:
- Use ONLY the exact enum values specified for constrained fields
- For business_hours, infer typical hours for the industry if not explicitly stated on the website
- For job_types, extract ALL services mentioned on the website
- For custom_phrases.always_mention, pull actual phrases/taglines from the website copy
- If a phone number is found, use it for emergency_phone
- Default lead_sources should include website_form and phone_call at minimum
- Infer primary_goal based on the business type (e.g., healthcare -> book_appointment, home_services -> direct_schedule)

FIELD CONSTRAINTS:
- industry: MUST be one of: home_services, real_estate, healthcare, legal, automotive, restaurant, retail, professional_services, other
- brand_voice: MUST be one of: professional, friendly, casual, authoritative
- timezone: MUST be one of: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix, America/Anchorage, Pacific/Honolulu
- after_hours_behavior: MUST be one of: voicemail, emergency_forward, schedule_callback, ai_handle
- primary_goal: MUST be one of: book_appointment, phone_qualification, direct_schedule, collect_info, transfer_to_agent
- lead_sources items: MUST be from: google_ads, facebook_ads, yelp, thumbtack, angi, homeadvisor, referral, website_form, phone_call, other
- urgency_tier in job_types: MUST be one of: critical, high, medium, low
- business_hours keys: mon, tue, wed, thu, fri, sat, sun — each with open (HH:MM), close (HH:MM), closed (boolean)
- confidence values: MUST be one of: high, medium, low`;

const RESPONSE_SCHEMA = {
    type: "object" as const,
    properties: {
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
    },
    required: [
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
    ] as const,
    additionalProperties: false,
};

/**
 * Analyzes a business website using OpenAI's Responses API with web search.
 * GPT-5.3 will search the web itself to find and analyze the business website,
 * bypassing 403/bot-blocking issues that affect server-side scraping.
 */
export async function analyzeBusinessWebsite(websiteUrl: string): Promise<AIAnalysisResult> {
    // Validate URL
    try {
        const parsed = new URL(websiteUrl);
        if (!parsed.protocol.startsWith("http")) {
            return { success: false, profile: null, fieldMeta: {}, error: "Please enter a valid URL starting with http:// or https://" };
        }
    } catch {
        return { success: false, profile: null, fieldMeta: {}, error: "Please enter a valid website URL" };
    }

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 60000, // 60s — web search + analysis takes longer
        });

        const response = await openai.responses.create({
            model: "gpt-5.3",
            instructions: ANALYSIS_INSTRUCTIONS,
            input: `Search and analyze this business website, then extract all profile information: ${websiteUrl}`,
            tools: [
                {
                    type: "web_search" as const,
                },
            ],
            text: {
                format: {
                    type: "json_schema",
                    name: "business_profile",
                    strict: true,
                    schema: RESPONSE_SCHEMA,
                },
            },
            temperature: 0,
        });

        const outputText = response.output_text;
        if (!outputText) {
            return { success: false, profile: null, fieldMeta: {}, error: "AI returned no response" };
        }

        const parsed = JSON.parse(outputText);
        return mapAIResponseToProfile(parsed);
    } catch (error) {
        console.error("[AI ANALYSIS] Error:", error);

        // Check for specific error types
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
            return {
                success: false,
                profile: null,
                fieldMeta: {},
                error: "AI analysis took too long. Try again or continue manually.",
            };
        }

        return {
            success: false,
            profile: null,
            fieldMeta: {},
            error: "AI analysis failed. You can continue filling in the fields manually.",
        };
    }
}

// ─── PROFILE MAPPER ───

function mapAIResponseToProfile(
    ai: Record<string, unknown>
): AIAnalysisResult {
    const fieldMeta: Record<string, AIFieldMeta> = {};

    function meta(field: string): AIFieldMeta {
        const conf = (ai[`${field}_confidence`] as string) || "low";
        const confidence = (["high", "medium", "low"].includes(conf) ? conf : "low") as AIFieldMeta["confidence"];
        return { confidence, aiGenerated: true, userEdited: false };
    }

    // Map each field
    fieldMeta.industry = meta("industry");
    fieldMeta.sub_industry = meta("sub_industry");
    fieldMeta.business_description = meta("business_description");
    fieldMeta.service_area = meta("service_area");
    fieldMeta.job_types = meta("job_types");
    fieldMeta.brand_voice = meta("brand_voice");
    fieldMeta.custom_phrases = meta("custom_phrases");
    fieldMeta.greeting_style = meta("greeting_style");
    fieldMeta.timezone = meta("timezone");
    fieldMeta.business_hours = meta("business_hours");
    fieldMeta.after_hours_behavior = meta("after_hours_behavior");
    fieldMeta.emergency_phone = meta("emergency_phone");
    fieldMeta.lead_sources = meta("lead_sources");
    fieldMeta.primary_goal = meta("primary_goal");
    fieldMeta.qualification_criteria = meta("qualification_criteria");

    // Build the profile
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
        website: "", // website is already known, set by caller
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

    return { success: true, profile, fieldMeta };
}
