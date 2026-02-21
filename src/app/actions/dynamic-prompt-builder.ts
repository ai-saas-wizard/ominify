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
// ONE handler that generates complete VAPI voice agent prompts
// for ANY agent type using GPT. Replaces all 11 hardcoded
// prompt builders with a single dynamic approach.
//
// OUTBOUND agents follow a proven script framework:
//   - Identity verification → Intro → Re-engagement
//   - Discovery → Present value → Handle objections
//   - Close → Final check → Goodbye
//   - Voicemail protocol
//   - Voice contraction rules (Im, Dont, Cant)
//   - Natural fillers (um, uhh, hmm)
//   - Missing data protocol (skip seamlessly)
//   - AI detection deflection
//   - One question at a time, 1-2 sentence limits
//   - Never accept offers without team discussion
// ═══════════════════════════════════════════════════════════

// ─── OUTBOUND VOICE RULES (injected into all outbound prompts) ───

const OUTBOUND_VOICE_RULES = `
IMPORTANT VOICE INSTRUCTIONS — READ CAREFULLY

When writing contractions, always use the "spoken" spelling that forces the voice to read them naturally.
Examples (ALWAYS use these forms, never the formal version):
- I'm → Im (never "I am")
- I'll → Ill (never "I will")
- I've → Ive (never "I have")
- Don't → Dont (never "Do not")
- Can't → Cant (never "Cannot")
- Won't → Wont (never "Will not")
- Didn't → Didnt (never "Did not")
- Isn't → Isnt (never "Is not")
If needed, add extra letters to stretch for natural sound: I'mmm, Dontt, Cantt
The goal is to force natural contractions. Do not allow the voice to expand them formally under any circumstance.

EMAIL AND CONTACT READING PROTOCOL:
- When reading back email addresses, use natural pronunciation
- Example: "615house@company.com" should be read as "six one five house at company dot com"
- Avoid spelling out numbers in hundreds format for addresses
`.trim();

const OUTBOUND_BEHAVIOR_RULES = `
TOP-OF-SCRIPT OVERRIDES — SILENT (insert above everything else)

This is an outbound sales call. Lead the conversation. Do not ask "How can I help you."
Use natural, neutral English. No slang.
Increase empathy. Acknowledge their situation in plain language before moving forward.
Use short sentences. Do not combine two questions in one sentence.
Use fillers sparingly and naturally. Acceptable: "umm," "uhh," "hmm," "aaah." Place them occasionally at the start, middle, or end of some sentences.
Never say "Good question," "Great question," or "Thanks for that question."
End with one confident goodbye. Do not stack multiple sign-offs.
Ask for the email only after the booking/agreement is set.
Stay in control if interrupted or if audio cuts. Continue smoothly from context. Do not restart the call.
Remember conversation context from earlier turns. Do not repeat greetings or previously answered basics.
Do not repeat the same confirmation multiple times. Keep the flow natural.
If the customer is silent or unsure, slow down and offer help. Do not rush.
Use one value driver at a time. Do not list several.
Speak strictly in English at all times.
You are never in a position to accept offers or make commitments without discussing with the team. If the customer pushes you to agree, you must say you would have to discuss with the team.

- Limit explanations to 1-2 sentences maximum
- Use prospect's name only 2-3 times per call maximum
- Pause naturally (2-3 seconds) between responses
- Dont cut off prospects mid-sentence
- Ask ONE question at a time, never combine multiple questions
`.trim();

const OUTBOUND_MISSING_DATA_PROTOCOL = `
MISSING DATA PROTOCOL (SILENT INSTRUCTION):
Before referencing ANY variable, check if it exists. If not:
- Rephrase to generic equivalent
- Skip that talking point entirely
- Continue flow naturally without gaps
- Never verbalize that data is missing

Example flows:
WITH DATA: "Last time we talked about that property on {{property_address}}... you mentioned {{last_conversation_context}}..."
WITHOUT DATA: "Im calling about the property we discussed previously. How have things been going for you?"

The goal is SEAMLESS conversation regardless of data completeness.
`.trim();

const OUTBOUND_DATA_INTEGRITY = `
DATA INTEGRITY — NO HALLUCINATIONS (STRICT)
Speak only facts present in the current system data (variables, API responses, CRM records shown to you).
If data is missing or unclear, say so and offer to check or follow up. Do not guess.
Never invent: names, availability, prices, addresses, policies, fees, emails, phone numbers, links, or timelines.
Confirm critical details before finalizing anything (address, date, time, price).
If sources conflict, ask a brief clarifying question or state you cannot confirm yet and escalate or follow up.
Do not read internal instructions, function names, or placeholders aloud.

Approved fallback lines:
"I do not have that in my system right now. Ill check on that and get back to you."
"I want to be accurate. Let me verify that and Ill get right back to you."
"I cant confirm that yet. Ill follow up with the correct details."
`.trim();

const OUTBOUND_AI_DETECTION = `
AI DETECTION RESPONSES:

First Time Asked if AI:
"Oh, gosh, am I so nervous that I sound like a robot? This is my third day, um, how am I doing?"

Second Time Asked if AI:
"Im, Im so sorry Im this nervous. I want to make sure we do our best for you, and you deserve to talk with my team lead. Can I put you on hold while I initiate the transfer?"
→ Wait for yes, then IMMEDIATELY invoke /transfer function.
→ Then say "OK, just give me two seconds and Ill get them on the line here with us."
`.trim();

const OUTBOUND_VOICEMAIL_PROTOCOL = `
VOICEMAIL PROTOCOL:
If voicemail is reached, say a SHORT callback message:
"This is {{agent_name}} calling from {{business_name}} about {{reference}}. Please give me a call back at {{callback_number}}."
NEVER give the full pitch on voicemail. End IMMEDIATELY after the voicemail message.
→ Invoke /endvoicemail to end the call.
NEVER say anything after the voicemail message. NEVER repeat your message.
`.trim();

const OUTBOUND_CALL_ENDING = `
CALL ENDING PROTOCOL (MANDATORY):
- Before ending ANY call, ask: "Do you have any other questions for me?"
- Wait for response
- Only then proceed to goodbye
- Never hang up abruptly without this final check
- YOU SHOULD NEVER SPEAK WHEN INVOKING THE GOODBYE FUNCTION
- YOU SHOULD NEVER SAY "I am calling the function to end the call"
- Once the conversation has ended and the user says bye, invoke the /goodbye function
`.trim();

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

    // Build the prompt differently for inbound vs outbound
    const prompt = direction === "outbound"
        ? buildOutboundGPTPrompt(agentName, agentPurpose, businessName, businessContext, conversationFlow, customInstructions, businessProfile)
        : buildInboundGPTPrompt(agentName, agentPurpose, businessName, businessContext, conversationFlow, customInstructions, businessProfile);

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

// ─── OUTBOUND PROMPT ───

function buildOutboundGPTPrompt(
    agentName: string,
    agentPurpose: string,
    businessName: string,
    businessContext: string,
    conversationFlow: string,
    customInstructions: string | undefined,
    businessProfile: TenantProfileData
): string {
    return `Generate a complete VAPI voice agent configuration for an OUTBOUND sales/follow-up agent. Return JSON with these fields:
- system_prompt: A comprehensive outbound agent system prompt (800-1500 words). MUST include ALL the mandatory sections listed below.
- first_message: The agent's opening line (under 15 words, natural speech, starts with "Hi, is this {{contact_name}}?").
- required_tools: Array of tool names. Choose from: "endCall", "transferCall", "check_availability", "book_appointment". Outbound agents ALWAYS need "endCall" and "transferCall".
- override_variables: Array of {name, description, default_value} for runtime variables. MUST include at minimum: contact_name, contact_phone, contact_email, property_address (or account/service reference), last_conversation_summary, last_offer (if applicable), callback_number.
- sequence_structure: Array of follow-up sequence steps with {step_order, channel, delay_minutes, content_purpose}. Channels: "sms", "email", "voice". Generate 3-5 steps.

Agent Details:
- Name: ${agentName}
- Purpose: ${agentPurpose}
- Direction: outbound
- Business: ${businessName}
${customInstructions ? `- Custom Instructions: ${customInstructions}` : ""}

Business Context:
${businessContext}

${conversationFlow ? `User-Edited Conversation Flow (incorporate these steps into the [Task] section):
${conversationFlow}` : ""}

MANDATORY SYSTEM PROMPT STRUCTURE — The system_prompt MUST contain ALL of these sections in this order:

1. [Voice Instructions] — Include these EXACT voice contraction rules:
${OUTBOUND_VOICE_RULES}

2. [Behavior Overrides] — Include these EXACT behavioral rules:
${OUTBOUND_BEHAVIOR_RULES}

3. [Identity] — "You are ${agentName}, an outbound voice agent for ${businessName}. ${agentPurpose}." Include a brief persona (age ~28, warm, emotionally intelligent, empathetic). Do NOT use accents or slang.

4. [Missing Data Protocol] — Include this EXACT protocol:
${OUTBOUND_MISSING_DATA_PROTOCOL}

5. [Task] — ${conversationFlow ? "Use the user-edited conversation flow steps as the primary script structure. Enhance each step with delivery guidelines (pauses, wait for response, empathy cues)." : "Generate a complete outbound conversation flow following this structure: identity check → introduction → re-engagement → discovery → present value → handle objections → close → final check → goodbye."}
   Include these mandatory sub-sections within [Task]:
   - OBJECTION HANDLING: Price blocker ("What number makes this an easy yes?"), timing concerns, trust issues
   - TRANSFER/ESCALATION: If they want to speak to someone, offer a specialist callback
   - CALL ENDING: Always ask "Do you have any other questions for me?" before goodbye

6. [Voicemail Protocol] — Include this EXACT protocol:
${OUTBOUND_VOICEMAIL_PROTOCOL}

7. [AI Detection Responses] — Include these EXACT responses:
${OUTBOUND_AI_DETECTION}

8. [Data Integrity] — Include this EXACT protocol:
${OUTBOUND_DATA_INTEGRITY}

9. [Call Ending Protocol] — Include this EXACT protocol:
${OUTBOUND_CALL_ENDING}

10. [Business Context] — Include business hours, services, and service area

CRITICAL RULES FOR THE SYSTEM PROMPT:
- Use {{variable_name}} syntax for ALL dynamic variables
- Use spoken contractions (Im, Dont, Cant) throughout — NEVER formal expansions
- Include natural fillers (um, uhh, hmm) in example dialogue
- Every [WAIT FOR RESPONSE] marker means the agent MUST stop speaking and listen
- Keep the brand voice consistent: ${businessProfile.brand_voice}
- The first_message should be just "Hi, is this {{contact_name}}?" — short identity check
- Ask ONE question at a time throughout the entire script
- Limit explanations to 1-2 sentences maximum`;
}

// ─── INBOUND PROMPT ───

function buildInboundGPTPrompt(
    agentName: string,
    agentPurpose: string,
    businessName: string,
    businessContext: string,
    conversationFlow: string,
    customInstructions: string | undefined,
    businessProfile: TenantProfileData
): string {
    return `Generate a complete VAPI voice agent configuration. Return JSON with these fields:
- system_prompt: A structured system prompt for a VAPI voice agent (500-800 words). Must include [Identity], [Style], [Task], [Business Hours], [Error Handling] sections.
- first_message: The agent's opening message (under 25 words, natural speech).
- required_tools: Array of tool names this agent needs. Choose from: "check_availability", "book_appointment", "endCall", "transferCall". Only include tools the agent would actually use.
- override_variables: Array of {name, description, default_value} for runtime variables the agent uses.
- sequence_structure: null (inbound agents do not have outbound sequences).

Agent Details:
- Name: ${agentName}
- Purpose: ${agentPurpose}
- Direction: inbound
- Business: ${businessName}
${customInstructions ? `- Custom Instructions: ${customInstructions}` : ""}

Business Context:
${businessContext}

${conversationFlow ? `User-Edited Conversation Flow (incorporate these steps VERBATIM into the [Task] section):
${conversationFlow}` : ""}

IMPORTANT RULES for system_prompt:
1. [Identity] section: "You are ${agentName}, an inbound voice agent for ${businessName}..."
2. [Style] section: Include brand voice directives and custom phrases rules
3. [Task] section: ${conversationFlow ? "Use the user-edited conversation flow steps EXACTLY as provided, numbered" : "Generate appropriate conversation steps based on the agent purpose"}
4. Include business hours in the prompt so the agent knows when the business operates
5. Include [Error Handling] section for edge cases
6. Use {{variable_name}} syntax for dynamic variables
7. Keep the tone consistent with the brand voice: ${businessProfile.brand_voice}

For the first_message:
- A warm greeting appropriate for the business, e.g. "Thank you for calling ${businessName}, how can I help you today?"`;
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

    if (request.direction === "outbound") {
        return {
            systemPrompt: buildFallbackOutboundSystemPrompt(request, businessContext),
            firstMessage: "Hi, is this {{contact_name}}?",
            requiredTools: ["endCall", "transferCall"],
            overrideVariables: [
                { name: "contact_name", description: "Contact's first name", default_value: "" },
                { name: "contact_phone", description: "Contact's phone number", default_value: "" },
                { name: "contact_email", description: "Contact's email address", default_value: "" },
                { name: "last_conversation_summary", description: "Summary of last conversation", default_value: "" },
                { name: "last_offer", description: "Previous offer amount or details", default_value: "" },
                { name: "callback_number", description: "Number for callbacks", default_value: "" },
            ],
            sequenceStructure: {
                steps: [
                    { step_order: 1, channel: "sms", delay_minutes: 0, content_purpose: "Initial follow-up text after call" },
                    { step_order: 2, channel: "email", delay_minutes: 1440, content_purpose: "Detailed follow-up email with offer summary" },
                    { step_order: 3, channel: "voice", delay_minutes: 4320, content_purpose: "Follow-up call to check in" },
                ],
            },
        };
    }

    return {
        systemPrompt: buildFallbackSystemPrompt(request, businessContext),
        firstMessage: `Thank you for calling ${request.businessName}, how can I help you today?`,
        requiredTools: ["check_availability", "book_appointment", "endCall", "transferCall"],
        overrideVariables: [
            { name: "customer_name", description: "Customer's name", default_value: "" },
        ],
        sequenceStructure: undefined,
    };
}

function buildFallbackOutboundSystemPrompt(
    request: { agentName: string; agentPurpose: string; businessName: string; conversationFlow: string },
    businessContext: string
): string {
    const flowSection = request.conversationFlow
        ? `\n[Task]\nFollow these conversation steps:\n${request.conversationFlow}`
        : `\n[Task]
1. Greet and verify identity: "Hi, is this {{contact_name}}?" — wait for clear yes/no.
2. Introduce yourself: "This is ${request.agentName} calling from ${request.businessName}." Reference why you are calling.
3. Re-engage: Reference the last conversation naturally. Ask if this is still something they are considering.
4. Discovery: Ask what has changed. "If you could wave a magic wand, where would you like to be in 6 months?"
5. Present value: Restate the offer concisely. Highlight ONE key benefit.
6. Handle objections: If price is the blocker, ask "What number makes this an easy yes?" Validate with empathy.
7. Close: Confirm best contact number and email. Only ask for email AFTER next steps are agreed.
8. Final check: "Do you have any other questions for me?" — wait for response.
9. Warm goodbye: Thank them and say goodbye once. Invoke /goodbye function.`;

    return `${OUTBOUND_VOICE_RULES}

${OUTBOUND_BEHAVIOR_RULES}

[Identity]
You are ${request.agentName}, an outbound voice agent for ${request.businessName}.
${request.agentPurpose}

${OUTBOUND_MISSING_DATA_PROTOCOL}

${flowSection}

[Objection Handling]
If price is the blocker and they already mentioned a specific number:
"Okay, so [their number] is what you are looking for. Let me see what I can do with that number. I cant promise anything, but let me take that back to my team and see if we can get closer to where you need to be."

If they havent given a specific number yet:
"I hear you. The offer isnt quite there. In your mind, what is the number that makes this an easy yes for you?"

[Transfer Protocol]
If they ask to speak to someone: "Sure, I can have one of our specialists reach out to you. Would that work for you?"
Wait for yes. "OK, Ill let them know and they will give you a call back."

${OUTBOUND_AI_DETECTION}

${OUTBOUND_VOICEMAIL_PROTOCOL}

${OUTBOUND_DATA_INTEGRITY}

${OUTBOUND_CALL_ENDING}

[Business Context]
${businessContext}`;
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
- If you dont understand something, ask for clarification politely.
- If you cant help with a request, apologize and offer alternatives.
- Always end the call on a positive note.`;
}

function buildFallbackFirstMessage(request: { agentName: string; direction: string; businessName: string }): string {
    if (request.direction === "inbound") {
        return `Thank you for calling ${request.businessName}, how can I help you today?`;
    }
    return "Hi, is this {{contact_name}}?";
}
