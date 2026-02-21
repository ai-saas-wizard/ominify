"use server";

import OpenAI from "openai";
import type { TenantProfile } from "@/components/onboarding/types";

// ═══════════════════════════════════════════════════════════
// CONVERSATION FLOW GENERATION
// Generates conversation flow steps for any agent type
// using GPT. Fully dynamic — works for ANY agent purpose.
//
// OUTBOUND agents follow a proven script structure:
//   1. Identity verification (is this {{contact_name}}?)
//   2. Introduction + company name + reason for call
//   3. Re-engagement / context from last interaction
//   4. Discovery (open-ended questions, "magic wand" Q)
//   5. Present value / offer / pitch
//   6. Handle objections (price, timing, trust)
//   7. Close (book appointment, send agreement, confirm next steps)
//   8. Final check ("Do you have any other questions for me?")
//   9. Warm goodbye + end call
//
// INBOUND agents follow standard intake structure.
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

        const outboundInstructions = `
CRITICAL: For outbound agents, you MUST follow this proven conversation structure. Generate 8-12 steps that follow this exact pattern:

STEP STRUCTURE FOR OUTBOUND:
1. IDENTITY CHECK — Verify you are speaking to the right person. Example: "Greet and ask 'Is this {{contact_name}}?' — wait for clear yes/no response before proceeding."
2. WARM INTRODUCTION — State your name, company, and briefly reference the reason for calling. Mention the relevant property/account/service. Example: "Introduce yourself as [Agent Name] from [Company]. Reference the property/account/previous interaction naturally."
3. RE-ENGAGEMENT — Reference the last conversation or interaction naturally (rephrase in your own words, never verbatim). Check if they are still interested. Example: "Reference previous conversation context naturally. Ask if this is still something they are considering."
4. DISCOVERY / CHECK-IN — Ask an open-ended question about what has changed. Use a 'magic wand' style question to uncover their ideal outcome. Example: "Ask what has changed since last conversation. Ask 'If you could wave a magic wand, where would you like to be in 6 months?'"
5. PRESENT VALUE / OFFER — Restate the offer or value proposition concisely. Highlight key benefits (no fees, flexibility, convenience). Only use one value driver at a time. Example: "Present the current offer or value proposition. Highlight ONE key benefit naturally."
6. HANDLE OBJECTIONS — If price is the blocker, ask for their target number. Validate their concerns with empathy before redirecting. Never stack multiple value drivers. Example: "If price objection: ask 'What number makes this an easy yes?' If timing objection: acknowledge and offer flexibility."
7. CLOSE / NEXT STEPS — If interested, confirm the next step (send agreement, book appointment, schedule callback). Confirm best contact number and email. Example: "If they agree, confirm next steps. Ask 'Is this still the best number to reach you?' Then confirm email for sending documents."
8. TRANSFER / ESCALATION — If they want to speak to someone or request a callback, acknowledge and offer to connect them with the right person. Example: "If they ask to speak with someone, offer to have a specialist call them back."
9. FINAL CHECK — ALWAYS ask "Do you have any other questions for me?" before ending. Wait for their response. Example: "Ask 'Do you have any other questions for me?' and wait for response."
10. WARM GOODBYE — End with one confident goodbye. Do not stack multiple sign-offs. Example: "Thank them for their time and say goodbye once. End call."

VOICEMAIL STEP (ALWAYS INCLUDE AS LAST STEP):
"VOICEMAIL PROTOCOL: If voicemail is reached, leave a brief message: 'This is [Agent Name] calling from [Company] about [reference]. Please give me a call back at [callback number].' Do NOT give the full pitch on voicemail. End immediately after."

IMPORTANT OUTBOUND RULES:
- This is an outbound sales call. Lead the conversation. Never ask "How can I help you?"
- Ask ONE question at a time, never combine multiple questions
- Wait for clear responses before proceeding to next section
- Use fillers naturally and sparingly (um, so, uhh)
- Never say "Good question" or "Great question" or "Thanks for that question"
- End with ONE confident goodbye, do not stack multiple sign-offs
- If they say they need to discuss with someone else, respect that and offer a callback
- Never accept offers or make commitments without noting it needs team discussion
- Use the contact's name only 2-3 times maximum per call
- Limit explanations to 1-2 sentences maximum
- If data/variables are missing, skip that talking point seamlessly — never acknowledge missing data`;

        const inboundInstructions = `
For inbound agents, generate 5-8 steps covering:
1. Greet the caller warmly and introduce yourself
2. Ask how you can help them today and listen to their needs
3. Gather relevant details (name, contact info, specific service needed)
4. Qualify the caller (timeline, location, special requirements)
5. Provide helpful information or check availability
6. Confirm details and next steps
7. Thank the caller and end professionally`;

        const prompt = `Generate a conversation flow for an AI voice agent.

Agent: ${agentName}
Purpose: ${agentPurpose}
Direction: ${direction}

Business context:
${businessContext}

${direction === "outbound" ? outboundInstructions : inboundInstructions}

Return as JSON: { "steps": ["step text 1", "step text 2", ...] }

Each step should be a clear, actionable instruction written in second person ("Greet the contact...", "Ask about...", "If they object..."). Make steps specific to THIS business and agent purpose, not generic.`;

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
        "Greet and verify identity: 'Is this {{contact_name}}?' — wait for clear yes/no before proceeding",
        "Introduce yourself: state your name, company name, and briefly reference why you are calling (mention the relevant property/account/service)",
        "Re-engage: reference the last conversation or interaction naturally in your own words. Ask if this is still something they are considering",
        "Discovery: ask what has changed since the last conversation. Use an open-ended question like 'If you could wave a magic wand, where would you like to be in 6 months?'",
        "Present value: restate the offer or value proposition concisely. Highlight ONE key benefit (no fees, flexible closing, convenience). Do not stack multiple value drivers",
        "Handle objections: if price is the blocker, ask 'What is the number that makes this an easy yes for you?' Validate their concerns with empathy before redirecting. If timing, offer flexibility",
        "If they want to speak to someone, offer to have a specialist call them back. Confirm this works for them before proceeding",
        "Close: if interested, confirm best contact number ('Is this still the best number to reach you?'). Then confirm email for sending documents. Only ask for email AFTER next steps are agreed",
        "Final check: ALWAYS ask 'Do you have any other questions for me?' — wait for their response before ending",
        "Warm goodbye: thank them for their time and say goodbye once. Do NOT stack multiple sign-offs. End the call",
        "VOICEMAIL PROTOCOL: if voicemail is reached, leave a brief message — name, company, reference to the property/account, and callback number. Do NOT give the full pitch. End immediately after the voicemail message",
    ];
}
