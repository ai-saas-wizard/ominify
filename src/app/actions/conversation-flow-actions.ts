"use server";

import OpenAI from "openai";
import type { TenantProfile } from "@/components/onboarding/types";

// ═══════════════════════════════════════════════════════════
// CONVERSATION FLOW GENERATION
// Generates conversation flow steps for any agent type
// using GPT. Fully dynamic — works for ANY agent purpose.
// ═══════════════════════════════════════════════════════════

export async function generateConversationFlowSteps(
    agentName: string,
    agentPurpose: string,
    direction: "inbound" | "outbound",
    businessProfile: TenantProfile
): Promise<string[]> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 30000,
        });

        const businessContext = [
            businessProfile.industry && `Industry: ${businessProfile.industry}`,
            businessProfile.sub_industry && `Specialty: ${businessProfile.sub_industry}`,
            businessProfile.business_description && `About: ${businessProfile.business_description}`,
            businessProfile.brand_voice && `Brand voice: ${businessProfile.brand_voice}`,
            businessProfile.greeting_style && `Greeting style: ${businessProfile.greeting_style}`,
            businessProfile.primary_goal && `Primary goal: ${businessProfile.primary_goal}`,
            businessProfile.after_hours_behavior && `After hours: ${businessProfile.after_hours_behavior}`,
            businessProfile.job_types.length > 0 && `Services: ${businessProfile.job_types.map((j) => j.name).join(", ")}`,
            businessProfile.service_area.cities.length > 0 && `Service area: ${businessProfile.service_area.cities.join(", ")}`,
        ].filter(Boolean).join("\n");

        const prompt = `Generate a conversation flow for an AI voice agent.

Agent: ${agentName}
Purpose: ${agentPurpose}
Direction: ${direction}

Business context:
${businessContext}

Generate 5-8 numbered conversation steps that this agent should follow during a ${direction} call. Each step should be a clear, actionable instruction for the AI agent.

For inbound agents, steps should cover: greeting, identifying caller needs, gathering info, qualifying, providing info/booking, confirming, and closing.
For outbound agents, steps should cover: introduction, stating purpose, engaging the contact, handling objections, achieving goal, and closing.

Return as JSON: { "steps": ["step text 1", "step text 2", ...] }`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return getDefaultFlowSteps(direction);

        const parsed = JSON.parse(content);
        const steps = parsed.steps as string[];

        if (!Array.isArray(steps) || steps.length === 0) {
            return getDefaultFlowSteps(direction);
        }

        return steps;
    } catch (error) {
        console.error("[CONVERSATION FLOW] Error generating flow:", error);
        return getDefaultFlowSteps(direction);
    }
}

function getDefaultFlowSteps(direction: "inbound" | "outbound"): string[] {
    if (direction === "inbound") {
        return [
            "Greet the caller warmly and introduce yourself as a representative of the business",
            "Ask how you can help them today and listen to their needs",
            "Gather relevant details about their request (name, contact info, specific service needed)",
            "Qualify the caller by asking about timeline, location, and any special requirements",
            "Provide helpful information or check availability for an appointment",
            "Confirm the details and next steps with the caller",
            "Thank the caller and end the conversation professionally",
        ];
    }
    return [
        "Introduce yourself and state the business name clearly",
        "Explain the reason for the call concisely and respectfully",
        "Ask if now is a good time to talk briefly",
        "Present the value proposition or information relevant to the contact",
        "Handle any questions or objections with empathy",
        "Attempt to achieve the call goal (book appointment, confirm info, etc.)",
        "Summarize next steps and thank them for their time",
    ];
}
