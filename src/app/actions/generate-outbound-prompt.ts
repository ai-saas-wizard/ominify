"use server";

import {
    getOpenRouterClient,
    PROMPT_AUTHORING_MODEL,
} from "@/lib/openrouter";
import type { REInvestorFormData } from "@/lib/verticals/types";
import { transferToolNameFor } from "@/lib/verticals/real-estate-investor/tools";
import { formatPhoneForSpeech } from "@/lib/verticals/real-estate-investor/phone-format";

/**
 * Generate a VAPI-grade outbound system prompt + first message from a
 * tenant-described scenario. The user explains, in plain English, what their
 * outbound agent should do (who it's calling, the goal, expected objections),
 * and we produce a structured prompt that follows the VAPI prompting guide:
 *
 *   - Sectioned: [Identity], [Style], [Voice Realism], [Response Guidelines],
 *     [Conversation Flow], [Tools], [Error Handling], [Call Closing]
 *   - <wait for user response> markers between speaker turns
 *   - Tools referenced by their EXACT function names (e.g. `gary_transfer`)
 *   - Schema-agnostic seller data via {{contact_data}} JSON + {{contact_field_legend}}
 *   - Voice realism (fillers, ellipses, contractions)
 *   - Hard rules for do-not-call requests + AI-detection
 */
export async function generateOutboundPromptFromScenario(
    formData: REInvestorFormData,
    scenario: string
): Promise<{
    success: boolean;
    systemPrompt?: string;
    firstMessage?: string;
    error?: string;
}> {
    const trimmed = (scenario || "").trim();
    if (trimmed.length < 20) {
        return {
            success: false,
            error: "Please describe your scenario in at least a sentence or two.",
        };
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return {
            success: false,
            error: "Server is missing OPENROUTER_API_KEY.",
        };
    }

    const transferToolName = transferToolNameFor(formData.outboundTransfer);
    const transferFirstName = formData.outboundTransfer.firstName || "the team";
    const transferRole = formData.outboundTransfer.role || "specialist";
    const isWarmSummary = formData.outboundTransfer.mode === "warm-summary";
    const spokenBusinessPhone = formatPhoneForSpeech(formData.businessPhone);

    const tenantContext = {
        company_name: formData.companyName,
        agent_persona_name: formData.agentPersonaName,
        timezone: formData.timezone,
        deal_types: formData.dealTypes,
        appointment_type: formData.appointmentType,
        business_callback_phone_spoken: spokenBusinessPhone,
        transfer_tool_name: transferToolName,
        transfer_specialist_first_name: transferFirstName,
        transfer_specialist_role: transferRole,
        transfer_mode: isWarmSummary ? "warm-with-summary" : "cold-blind",
    };

    const systemInstructions = `You are a senior prompt engineer specializing in VAPI voice AI agents. You write outbound voice-agent system prompts that strictly follow the VAPI prompting guide.

OUTPUT CONTRACT:
Return ONLY a JSON object with exactly two string fields:
{
  "systemPrompt": "<the full system prompt — markdown, multiple sections>",
  "firstMessage": "<a single sentence the agent says first when the call connects>"
}

NO commentary outside the JSON. NO code fences.

VAPI PROMPTING RULES YOU MUST FOLLOW (non-negotiable):

1. STRUCTURE — break the prompt into clearly-labelled sections in this order:
   ## [Identity]               (persona name, age, background, tone)
   ## [Style]                  (warm/calm/concise rules; forbidden phrases)
   ## [Voice Realism]          (contractions: Im/Ill/Dont; fillers: umm/uhh; ellipses for pauses; spell out numbers; no spelling-bee names)
   ## [Response Guidelines]    (one question at a time; never combine; wait for clear responses)
   ## [Data Integrity]         (use only {{contact_data}} fields actually present; never invent prices/dates)
   ## [Hard Rules]             (do-not-call requests; AI-detection; in-person commitments)
   ## [Conversation Flow]      (numbered steps with <wait for user response> markers)
   ## [Tools available]        (list each tool by exact function name + when to invoke it)
   ## [Error Handling]
   ## [Call Closing]
   ## [Voicemail Protocol]

2. TOOLS — reference EVERY tool listed below by its EXACT function name in the [Tools available] section AND in the conversation flow at the moment it should be invoked. Specifically:
   - When the seller wants to schedule a sit-down: instruct "call \`check_availability\`", then "call \`book_appointment\`" after confirming a slot.
   - When the seller mentions an existing appointment they already have: instruct "call \`lookup_appointment\` with {{contact_phone}} first" before deciding what to do next.
   - When the seller wants to move an existing appointment: instruct "call \`reschedule_appointment\`" (NOT \`book_appointment\`).
   - When the seller wants to cancel: instruct "call \`cancel_appointment\` after confirming twice".
   - For transfers: "silently invoke the \`<tool_name>\` function — do NOT send any text response before invoking; the tool plays its own connect message."
   - For ending the call: "silently invoke \`endCall\`".
   Even if the scenario doesn't obviously involve booking, INCLUDE all calendar tools in [Tools available] with a one-line description of when each should be invoked, so the agent can reach for the right one if the seller surfaces it.

3. VARIABLES — the only seller data the agent receives at call time is:
   - {{contact_data}}  : a JSON object of everything we know about this seller
   - {{contact_field_legend}} : describes what each key in {{contact_data}} means
   - {{contact_name}} / {{contact_phone}} / {{contact_email}}
   - {{currentDate}} / {{tenantTimezone}}
   In the [Data Integrity] section instruct the agent to read these silently before speaking and to use ONLY the keys that are present. NEVER invent dollar amounts or dates. If a relevant field is missing, gracefully skip that line.

4. RESPONSE TIMING — use \`<wait for user response>\` after every question or prompt where the agent must wait. Per the VAPI guide.

5. VOICE REALISM — instruct the agent to speak digits one-by-one for phone numbers (e.g. "6-1-5..."), spell out small numbers in words, and use contractions in their spoken (not formal) form (Im, Ill, Dont). Use ellipses ("...") and fillers ("um", "uh") sparingly and naturally.

6. HARD RULES — always include:
   - Do-not-call: if the seller asks to be removed/cursed about being called, apologize once, confirm removal, silently invoke endCall. NEVER ask for verification.
   - Never commit a specific human rep to a physical visit on this call. Only Rhonda/the team coordinates that afterwards.
   - AI detection: 1st time, "Oh gosh, am I so nervous I sound like a robot? This is my third day, how am I doing?" — 2nd time, apologize for being nervous and silently invoke the transfer tool.

7. NO PLACEHOLDERS LEFT UNFILLED. If the scenario doesn't specify something tenant-specific, infer a reasonable default from the supplied tenant context — NEVER leave \`{{like_this}}\` in the prompt for variables not in the allowed list above.

8. FIRST MESSAGE — must be a single short sentence (under 25 words) the agent speaks immediately when the call connects. Reference {{contact_name}} naturally. Example: "Hey, sorry about that — my headset took a second to connect. Is this {{contact_name}}?"

Output JSON only.`;

    const userMessage = `TENANT CONTEXT (interpolate names/numbers into the prompt at build time, do NOT leave them as variables):
${JSON.stringify(tenantContext, null, 2)}

TRANSFER TOOL DETAILS:
- Function name (use this exact name everywhere in the prompt where the transfer tool is referenced): \`${transferToolName}\`
- Mode: ${isWarmSummary ? "warm-transfer-with-AI-spoken-summary" : "cold/blind"}
- Specialist: ${transferFirstName}, ${transferRole}

OTHER TOOLS available (always include in [Tools available] section, by exact name):
- check_availability  — check open slots for booking a sit-down with a specialist
- book_appointment    — book a confirmed slot
- lookup_appointment  — find an existing appointment
- reschedule_appointment
- cancel_appointment
- ${transferToolName}  — ${isWarmSummary ? "warm" : "cold"}-transfer to ${transferFirstName}
- endCall             — for /goodbye and /endvoicemail flows

OUTBOUND SCENARIO (described by the tenant — make the conversation flow specifically address this):
"""
${trimmed}
"""

Generate the prompt now. Output JSON only.`;

    try {
        const client = getOpenRouterClient();

        const response = await client.chat.completions.create({
            model: PROMPT_AUTHORING_MODEL,
            // Most OpenRouter providers accept response_format passthrough; for
            // those that don't, the JSON-only system instruction enforces it.
            response_format: { type: "json_object" },
            max_tokens: 6000,
            temperature: 0.4,
            messages: [
                { role: "system", content: systemInstructions },
                { role: "user", content: userMessage },
            ],
        });

        const rawContent = response.choices[0]?.message?.content;
        if (!rawContent) {
            return { success: false, error: "Empty response from model." };
        }

        // Some models wrap JSON in ```json fences despite the instruction —
        // strip them defensively before parsing.
        const content = rawContent
            .replace(/^\s*```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();

        const parsed = JSON.parse(content);
        const systemPrompt =
            typeof parsed.systemPrompt === "string"
                ? parsed.systemPrompt.trim()
                : "";
        const firstMessage =
            typeof parsed.firstMessage === "string"
                ? parsed.firstMessage.trim()
                : "";

        if (!systemPrompt || !firstMessage) {
            return {
                success: false,
                error: "Model returned an incomplete response. Try rewording your scenario and regenerating.",
            };
        }

        return { success: true, systemPrompt, firstMessage };
    } catch (err: any) {
        console.error("[generateOutboundPrompt] Error:", err);
        return {
            success: false,
            error: err?.message || "Failed to generate prompt",
        };
    }
}
