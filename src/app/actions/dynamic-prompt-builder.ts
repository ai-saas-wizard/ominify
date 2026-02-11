"use server";

import OpenAI from "openai";
import type { TenantProfileData } from "@/lib/prompt-templates";
import {
    buildIndustryContext,
    buildServicesText,
    buildBusinessHoursText,
    buildBrandVoiceDirective,
    buildCustomPhrasesRules,
    buildQualificationText,
    buildServiceAreaText,
} from "@/lib/prompt-templates";
import type { DynamicPromptResult } from "@/components/onboarding-v2/types";

// ═══════════════════════════════════════════════════════════
// DYNAMIC PROMPT BUILDER
// ONE handler that generates complete VAPI agent prompts
// for ANY agent type using GPT. Replaces all 11 hardcoded
// prompt builders with a single dynamic approach.
// ═══════════════════════════════════════════════════════════

export async function buildDynamicAgentPrompt(request: {
    agentTypeId: string;
    agentName: string;
    agentPurpose: string;
    direction: "inbound" | "outbound";
    businessName: string;
    businessProfile: TenantProfileData;
    conversationFlow: string;
    customInstructions?: string;
}): Promise<DynamicPromptResult> {
    const {
        agentName,
        agentPurpose,
        direction,
        businessName,
        businessProfile,
        conversationFlow,
        customInstructions,
    } = request;

    // Build business context using existing helpers
    const industryContext = buildIndustryContext(
        businessProfile.industry,
        businessProfile.sub_industry
    );
    const servicesText = buildServicesText(businessProfile.job_types);
    const serviceAreaText = buildServiceAreaText(businessProfile.service_area);
    const hoursText = buildBusinessHoursText(
        businessProfile.business_hours,
        businessProfile.timezone
    );
    const brandVoiceDirective = buildBrandVoiceDirective(businessProfile.brand_voice);
    const customPhrasesRules = buildCustomPhrasesRules(businessProfile.custom_phrases);
    const qualificationText = buildQualificationText(businessProfile.qualification_criteria);

    const afterHoursBehavior = businessProfile.after_hours_behavior || "voicemail";

    const businessContext = `
Business: ${businessName}
Industry: ${industryContext}
Services: ${servicesText}
Service Area: ${serviceAreaText}
Brand Voice: ${businessProfile.brand_voice}
Greeting Style: ${businessProfile.greeting_style || "Standard professional greeting"}
Primary Goal: ${businessProfile.primary_goal || "book_appointment"}
Emergency Phone: ${businessProfile.emergency_phone || "N/A"}
After Hours Behavior: ${afterHoursBehavior}

${hoursText}

${brandVoiceDirective}
${customPhrasesRules ? "\n" + customPhrasesRules : ""}
${qualificationText ? "\n" + qualificationText : ""}
`.trim();

    const prompt = `Generate a complete VAPI voice agent configuration. Return JSON with these fields:
- system_prompt: A structured system prompt for a VAPI voice agent (500-800 words). Must include [Identity], [Style], [Task], [Business Hours], [Error Handling] sections.
- first_message: The agent's opening message (under 25 words, natural speech).
- required_tools: Array of tool names this agent needs. Choose from: "check_availability", "book_appointment", "endCall", "transferCall". Only include tools the agent would actually use.
- override_variables: Array of {name, description, default_value} for runtime variables the agent uses.
- sequence_structure: ONLY for outbound agents — an array of sequence steps with {step_order, channel, delay_minutes, content_purpose}. Channels: "sms", "email", "voice". Set to null for inbound agents.

Agent Details:
- Name: ${agentName}
- Purpose: ${agentPurpose}
- Direction: ${direction}
${customInstructions ? `- Custom Instructions: ${customInstructions}` : ""}

Business Context:
${businessContext}

${conversationFlow ? `User-Edited Conversation Flow (incorporate these steps VERBATIM into the [Task] section):
${conversationFlow}` : ""}

IMPORTANT RULES for system_prompt:
1. [Identity] section: "You are ${agentName}, a ${direction} voice agent for ${businessName}..."
2. [Style] section: Include brand voice directives and custom phrases rules
3. [Task] section: ${conversationFlow ? "Use the user-edited conversation flow steps EXACTLY as provided, numbered" : "Generate appropriate conversation steps based on the agent purpose"}
4. Include business hours in the prompt so the agent knows when the business operates
5. Include [Error Handling] section for edge cases
6. Use {{variable_name}} syntax for dynamic variables
7. Keep the tone consistent with the brand voice: ${businessProfile.brand_voice}

For the first_message:
- Inbound: A warm greeting appropriate for the business
- Outbound: A brief, natural introduction stating who you are and why you're calling`;

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 45000,
        });

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return buildFallbackPrompt(request);
        }

        const parsed = JSON.parse(content);

        return {
            systemPrompt: parsed.system_prompt || buildFallbackSystemPrompt(request, businessContext),
            firstMessage: parsed.first_message || buildFallbackFirstMessage(request),
            requiredTools: Array.isArray(parsed.required_tools) ? parsed.required_tools : ["endCall"],
            overrideVariables: Array.isArray(parsed.override_variables)
                ? parsed.override_variables.map((v: Record<string, string>) => ({
                      name: v.name || "",
                      description: v.description || "",
                      default_value: v.default_value || "",
                  }))
                : [],
            sequenceStructure: parsed.sequence_structure && direction === "outbound"
                ? {
                      steps: Array.isArray(parsed.sequence_structure)
                          ? parsed.sequence_structure
                          : parsed.sequence_structure.steps || [],
                  }
                : undefined,
        };
    } catch (error) {
        console.error("[DYNAMIC PROMPT BUILDER] Error:", error);
        return buildFallbackPrompt(request);
    }
}

// ─── FALLBACKS ───

function buildFallbackPrompt(request: {
    agentName: string;
    agentPurpose: string;
    direction: "inbound" | "outbound";
    businessName: string;
    businessProfile: TenantProfileData;
    conversationFlow: string;
}): DynamicPromptResult {
    const businessContext = `${request.businessName} (${request.businessProfile.industry})`;
    return {
        systemPrompt: buildFallbackSystemPrompt(request, businessContext),
        firstMessage: buildFallbackFirstMessage(request),
        requiredTools: request.direction === "inbound"
            ? ["check_availability", "book_appointment", "endCall", "transferCall"]
            : ["endCall"],
        overrideVariables: [
            { name: "customer_name", description: "Customer's name", default_value: "" },
        ],
        sequenceStructure: undefined,
    };
}

function buildFallbackSystemPrompt(
    request: { agentName: string; agentPurpose: string; direction: string; businessName: string; conversationFlow: string },
    businessContext: string
): string {
    const flowSection = request.conversationFlow
        ? `\n[Task]\nFollow these conversation steps:\n${request.conversationFlow}`
        : `\n[Task]\nHelp the caller with their needs related to: ${request.agentPurpose}`;

    return `[Identity]
You are ${request.agentName}, a ${request.direction} voice agent for ${request.businessName}.
${request.agentPurpose}

[Style]
- Be professional, warm, and helpful.
- Use clear, natural speech.
- Keep responses concise and conversational.

${flowSection}

[Business Context]
${businessContext}

[Error Handling]
- If you don't understand something, ask for clarification politely.
- If you can't help with a request, apologize and offer alternatives.
- Always end the call on a positive note.`;
}

function buildFallbackFirstMessage(request: { agentName: string; direction: string; businessName: string }): string {
    if (request.direction === "inbound") {
        return `Thank you for calling ${request.businessName}, how can I help you today?`;
    }
    return `Hi, this is ${request.agentName} from ${request.businessName}.`;
}
