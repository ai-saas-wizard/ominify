"use server";

import OpenAI from "openai";
import type { AIAnalysisResult, AIFieldMeta } from "@/components/onboarding/types";

// ─── WEBSITE SCRAPING ───

export async function scrapeWebsite(url: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
}> {
    // Validate URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
        if (!parsedUrl.protocol.startsWith("http")) {
            return { success: false, error: "Please enter a valid URL starting with http:// or https://" };
        }
    } catch {
        return { success: false, error: "Please enter a valid website URL" };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(parsedUrl.toString(), {
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            redirect: "follow",
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return {
                success: false,
                error: `We couldn't access this website (Error ${response.status}). Please check the URL and try again.`,
            };
        }

        const html = await response.text();

        if (!html || html.length < 100) {
            return {
                success: false,
                error: "We found the website but couldn't extract any content. You can continue manually.",
            };
        }

        const content = extractTextFromHTML(html);

        if (!content || content.length < 50) {
            return {
                success: false,
                error: "We couldn't extract meaningful content from this website. You can continue manually.",
            };
        }

        return { success: true, content };
    } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
            return {
                success: false,
                error: "The website took too long to respond. Try again or continue manually.",
            };
        }
        console.error("[SCRAPE] Error:", err);
        return {
            success: false,
            error: "We couldn't reach this website. Please check the URL and try again.",
        };
    }
}

function extractTextFromHTML(html: string): string {
    const sections: string[] = [];

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
        sections.push(`TITLE: ${cleanText(titleMatch[1])}`);
    }

    // Extract meta description
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i)
        || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i);
    if (metaDescMatch) {
        sections.push(`DESCRIPTION: ${cleanText(metaDescMatch[1])}`);
    }

    // Extract JSON-LD structured data
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
        try {
            const data = JSON.parse(match[1]);
            sections.push(`STRUCTURED_DATA: ${JSON.stringify(data).slice(0, 1500)}`);
        } catch {
            // ignore invalid JSON-LD
        }
    }

    // Strip unwanted tags entirely (including content)
    let cleaned = html;
    const stripTags = ["script", "style", "noscript", "svg", "iframe"];
    for (const tag of stripTags) {
        cleaned = cleaned.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
    }

    // Extract headings
    const headingMatches = cleaned.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);
    for (const match of headingMatches) {
        const text = cleanText(match[2]);
        if (text.length > 2) {
            sections.push(`H${match[1]}: ${text}`);
        }
    }

    // Extract paragraphs
    const pMatches = cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const match of pMatches) {
        const text = cleanText(match[1]);
        if (text.length > 10) {
            sections.push(text);
        }
    }

    // Extract list items
    const liMatches = cleaned.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    for (const match of liMatches) {
        const text = cleanText(match[1]);
        if (text.length > 5) {
            sections.push(`- ${text}`);
        }
    }

    // Extract phone numbers via regex from full HTML
    const phoneMatches = html.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phoneMatches) {
        const uniquePhones = [...new Set(phoneMatches)];
        sections.push(`PHONE_NUMBERS: ${uniquePhones.join(", ")}`);
    }

    // Extract email addresses
    const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
        const uniqueEmails = [...new Set(emailMatches)].filter(
            (e) => !e.includes("example.com") && !e.includes("sentry")
        );
        if (uniqueEmails.length > 0) {
            sections.push(`EMAILS: ${uniqueEmails.join(", ")}`);
        }
    }

    // Extract addresses (basic pattern)
    const addressMatches = html.match(/\d{1,5}\s[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place)[.,]?\s*[\w\s]*,?\s*[A-Z]{2}\s*\d{5}/gi);
    if (addressMatches) {
        sections.push(`ADDRESSES: ${[...new Set(addressMatches)].join("; ")}`);
    }

    const result = sections.join("\n\n");
    // Truncate to ~8000 chars for GPT-4o context
    return result.slice(0, 8000);
}

function cleanText(html: string): string {
    return html
        .replace(/<[^>]*>/g, "") // strip HTML tags
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// ─── AI ANALYSIS ───

const ANALYSIS_SYSTEM_PROMPT = `You are a business analyst AI. Given text content scraped from a business website, extract and infer comprehensive business profile information.

For fields you cannot determine from the website content, make intelligent inferences based on the industry and context, but mark them with lower confidence.

Return a JSON object with the following structure:

{
  "industry": "one of: home_services, real_estate, healthcare, legal, automotive, restaurant, retail, professional_services, other",
  "industry_confidence": "high or medium or low",
  "sub_industry": "specific specialization (e.g., HVAC, Family Law, Pediatrics)",
  "sub_industry_confidence": "high or medium or low",
  "business_description": "2-3 sentence summary of the business, its services, and unique value proposition",
  "business_description_confidence": "high or medium or low",
  "service_area": {
    "cities": ["list of cities mentioned or inferred"],
    "zip_codes": ["zip codes if found"],
    "radius_miles": 25
  },
  "service_area_confidence": "high or medium or low",
  "job_types": [
    {
      "name": "service name",
      "urgency_tier": "critical or high or medium or low",
      "avg_ticket": "estimated price like $250",
      "keywords": "comma-separated relevant keywords"
    }
  ],
  "job_types_confidence": "high or medium or low",
  "brand_voice": "one of: professional, friendly, casual, authoritative",
  "brand_voice_confidence": "high or medium or low",
  "custom_phrases": {
    "always_mention": ["key phrases from website like family-owned, licensed & insured"],
    "never_say": ["industry-specific words to avoid"]
  },
  "custom_phrases_confidence": "high or medium or low",
  "greeting_style": "suggested phone greeting using business name and matching their tone",
  "greeting_style_confidence": "high or medium or low",
  "timezone": "inferred timezone like America/New_York based on location. Must be one of: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix, America/Anchorage, Pacific/Honolulu",
  "timezone_confidence": "high or medium or low",
  "business_hours": {
    "mon": { "open": "08:00", "close": "17:00", "closed": false },
    "tue": { "open": "08:00", "close": "17:00", "closed": false },
    "wed": { "open": "08:00", "close": "17:00", "closed": false },
    "thu": { "open": "08:00", "close": "17:00", "closed": false },
    "fri": { "open": "08:00", "close": "17:00", "closed": false },
    "sat": { "open": "09:00", "close": "14:00", "closed": false },
    "sun": { "open": "00:00", "close": "00:00", "closed": true }
  },
  "business_hours_confidence": "high or medium or low",
  "after_hours_behavior": "one of: voicemail, emergency_forward, schedule_callback, ai_handle",
  "after_hours_behavior_confidence": "high or medium or low",
  "emergency_phone": "phone number found on website, or empty string if not found",
  "emergency_phone_confidence": "high or medium or low",
  "lead_sources": ["inferred from website mentions. Choose from: google_ads, facebook_ads, yelp, thumbtack, angi, homeadvisor, referral, website_form, phone_call, other"],
  "lead_sources_confidence": "high or medium or low",
  "primary_goal": "one of: book_appointment, phone_qualification, direct_schedule, collect_info, transfer_to_agent",
  "primary_goal_confidence": "high or medium or low",
  "qualification_criteria": {
    "must_have": ["criteria inferred from business type"],
    "nice_to_have": ["additional positive signals"],
    "disqualifiers": ["reasons to decline service"]
  },
  "qualification_criteria_confidence": "high or medium or low"
}

IMPORTANT:
- Use ONLY the exact enum values specified for constrained fields
- For business_hours, infer typical hours for the industry if not explicitly stated
- For job_types, extract all services mentioned on the website
- For custom_phrases.always_mention, pull actual phrases/taglines from the website copy
- If a phone number is found, use it for emergency_phone
- Default lead_sources should include website_form and phone_call at minimum
- Infer primary_goal based on the business type (e.g., healthcare -> book_appointment)`;

export async function analyzeBusinessWithAI(
    websiteContent: string,
    websiteUrl: string
): Promise<AIAnalysisResult> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 30000,
        });

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            max_tokens: 4000,
            temperature: 0,
            messages: [
                { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: `Analyze this business website content and extract all profile information.\n\nWebsite URL: ${websiteUrl}\n\nWebsite Content:\n${websiteContent}`,
                },
            ],
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return { success: false, profile: null, fieldMeta: {}, error: "AI returned no response" };
        }

        const parsed = JSON.parse(content);
        return mapAIResponseToProfile(parsed);
    } catch (error) {
        console.error("[AI ANALYSIS] Error:", error);
        return {
            success: false,
            profile: null,
            fieldMeta: {},
            error: "AI analysis failed. You can continue filling in the fields manually.",
        };
    }
}

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
