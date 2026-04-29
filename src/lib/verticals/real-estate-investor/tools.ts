import type {
    REInvestorFormData,
    TransferSpecialist,
} from "../types";

/**
 * Derives the transferCall function name from the specialist's first name.
 * Used by both the tool definition and the prompt body so the LLM can
 * reference the exact tool name when instructed to transfer.
 *
 * "Gary"   → "gary_transfer"
 * "Rhonda" → "rhonda_transfer"
 * ""       → "specialist_transfer" (fallback)
 */
export function transferToolNameFor(specialist: TransferSpecialist): string {
    const slug = (specialist.firstName || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    return `${slug || "specialist"}_transfer`;
}

/**
 * Builds a rich transferCall tool — supports warm-transfer with an LLM-spoken
 * summary briefing the operator before connecting the seller, or a cold/blind
 * transfer. Modelled on the user's production `gary_transfer` config.
 *
 * `direction` is included in the tool description so the LLM understands
 * whether this is an inbound or outbound handoff (slightly different framing).
 */
export function buildTransferTool(
    specialist: TransferSpecialist,
    direction: "inbound" | "outbound"
): Record<string, unknown> | null {
    if (!specialist.phone) return null;

    const phoneE164 = formatE164(specialist.phone);
    const fname = specialist.firstName || "the team";
    const role = specialist.role || "specialist";
    const toolName = transferToolNameFor(specialist);
    const isWarmSummary = specialist.mode === "warm-summary";

    const triggerSituations =
        direction === "outbound"
            ? "(1) the seller asks to be transferred or asks if Sam is an AI for the SECOND time after the first-time deflection has been used, OR (2) the seller agrees to next steps that need a human, OR (3) the seller gives a counter-offer the team needs to decide on."
            : "(1) the caller asks to speak to a human / be transferred, OR (2) the caller asks if you are an AI for the SECOND time in the same call after the first-time deflection has been used.";

    const summaryPlan = isWarmSummary
        ? {
              enabled: true,
              messages: [
                  {
                      role: "system",
                      content: `You are briefing your ${role} ${fname} on a seller call that just happened. Give a concise, spoken-style summary in 3–4 sentences: the seller's name, property address, where the conversation left off (their stated price, any objections, key motivations), and what ${fname} should pick up on. Do not read the transcript verbatim or list bullets — sound like one rep handing off to another verbally.`,
                  },
                  {
                      role: "user",
                      content:
                          "Transcript of the call:\n\n{{transcript}}",
                  },
              ],
              timeoutSeconds: 5,
              useAssistantLlm: false,
          }
        : undefined;

    const transferPlan = isWarmSummary
        ? {
              mode: "warm-transfer-wait-for-operator-to-speak-first-and-then-say-summary",
              sipVerb: "refer",
              summaryPlan,
          }
        : { mode: "blind-transfer" };

    return {
        type: "transferCall",
        function: {
            name: toolName,
            parameters: null,
            description: `${isWarmSummary ? "Warm" : "Cold"}-transfer the call to ${fname}, the ${role}, when the seller asks to speak to a human, agrees to next steps requiring ${fname}'s involvement, gives a specific counter-offer the team needs to decide on, or when instructed to transfer. ${
                isWarmSummary
                    ? `${fname} will hear a short spoken summary before the seller is connected.`
                    : `The seller will be connected immediately with no summary.`
            }`,
        },
        messages: [{ type: "request-start", blocking: false }],
        destinations: [
            {
                type: "number",
                number: phoneE164,
                message: `Of course — let me see if I can get ${fname} on the line for you real quick. Just give me one second while I try to connect you.`,
                description: `${isWarmSummary ? "Warm" : "Cold"}-transfer to ${fname} (${role}). Invoke when: ${triggerSituations} Never invoke for any other reason.`,
                transferPlan,
                numberE164CheckEnabled: true,
            },
        ],
    };
}

/**
 * Builds the VAPI tools array for the RE Investor inbound receptionist.
 * Mirrors the exact tool structure from assistant-creation-actions.ts but
 * with RE-specific configuration (rich warm/cold transferCall with an
 * LLM-spoken summary briefing) and adds `address`/`zip_code` fields to
 * check_availability since the RE prompt tells the agent to pass full
 * property address.
 */
export function buildREInboundTools(
    clientId: string,
    appUrl: string,
    formData: REInvestorFormData
): unknown[] {
    const serverUrl = `${appUrl}/api/vapi/tools/calendar`;
    const tools: unknown[] = [];

    // Calendar: check availability
    tools.push({
        type: "function",
        function: {
            name: "check_availability",
            description:
                "Check available appointment slots, optionally filtered by day-part or time range. Call this when the customer wants to book or asks about availability.",
            parameters: {
                type: "object",
                properties: {
                    preferred_date: {
                        type: "string",
                        description:
                            "Preferred date in YYYY-MM-DD format. Omit to check the next few business days.",
                    },
                    days_ahead: {
                        type: "integer",
                        description:
                            "How many days forward to scan. Use 7 for 'next week', 3 for 'next few days'.",
                    },
                    duration_minutes: {
                        type: "integer",
                        description: "Appointment length in minutes. Omit to use tenant default.",
                    },
                    time_of_day_preference: {
                        type: "string",
                        enum: ["morning", "afternoon", "evening", "any"],
                        description: "Customer-stated day-part preference.",
                    },
                    earliest_time: {
                        type: "string",
                        description: "Earliest acceptable time in HH:MM (24h), tenant timezone.",
                    },
                    latest_time: {
                        type: "string",
                        description: "Latest acceptable time in HH:MM (24h), tenant timezone.",
                    },
                    service_type: {
                        type: "string",
                        description: "The type of service or appointment.",
                    },
                    address: {
                        type: "string",
                        description: "Full property address",
                    },
                    zip_code: {
                        type: "string",
                        description: "Property zip code",
                    },
                },
            },
        },
        server: { url: serverUrl, timeoutSeconds: 20 },
        messages: [
            { type: "request-start", content: "Let me check the schedule for you." },
            {
                type: "request-failed",
                content:
                    "I'm having trouble reaching our calendar right now. Let me take your information and have someone call you back.",
            },
            {
                type: "request-response-delayed",
                content: "Still checking — one moment.",
                timingMilliseconds: 3000,
            },
        ],
    });

    // Calendar: book appointment
    tools.push({
        type: "function",
        function: {
            name: "book_appointment",
            description:
                "Book a confirmed appointment. Only call after the customer has picked a specific date and time.",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "YYYY-MM-DD" },
                    time: { type: "string", description: "HH:MM 24-hour" },
                    customer_name: { type: "string", description: "Full name" },
                    customer_phone: {
                        type: "string",
                        description: "Phone; any format, will be normalized",
                    },
                    customer_email: {
                        type: "string",
                        description: "Email for calendar invite (optional)",
                    },
                    timezone: {
                        type: "string",
                        description:
                            "IANA timezone if caller volunteered it (e.g. America/Chicago). Omit to use tenant default.",
                    },
                    service_type: { type: "string" },
                    notes: { type: "string" },
                },
                required: ["date", "time", "customer_name", "customer_phone"],
            },
        },
        server: { url: serverUrl, timeoutSeconds: 20 },
        messages: [
            { type: "request-start", content: "Booking that for you now." },
            {
                type: "request-failed",
                content:
                    "Something went wrong booking that slot. Let me try a different time.",
            },
            {
                type: "request-response-delayed",
                content: "Almost done — one moment.",
                timingMilliseconds: 3000,
            },
        ],
    });

    // Calendar: lookup appointment
    tools.push({
        type: "function",
        function: {
            name: "lookup_appointment",
            description:
                "Find existing appointments for a caller by phone number. Call when a returning caller asks about their booking.",
            parameters: {
                type: "object",
                properties: {
                    customer_phone: { type: "string", description: "Phone in any format" },
                },
                required: ["customer_phone"],
            },
        },
        server: { url: serverUrl, timeoutSeconds: 20 },
        messages: [
            { type: "request-start", content: "Let me pull up your appointment." },
            {
                type: "request-failed",
                content: "I can't reach our records right now. Can you hold while I try again?",
            },
        ],
    });

    // Calendar: reschedule appointment
    tools.push({
        type: "function",
        function: {
            name: "reschedule_appointment",
            description:
                "Move a caller's existing appointment to a new date and time. Only call after the caller has agreed to a specific new slot.",
            parameters: {
                type: "object",
                properties: {
                    customer_phone: { type: "string" },
                    new_date: { type: "string", description: "YYYY-MM-DD" },
                    new_time: { type: "string", description: "HH:MM 24-hour" },
                    timezone: { type: "string" },
                },
                required: ["customer_phone", "new_date", "new_time"],
            },
        },
        server: { url: serverUrl, timeoutSeconds: 20 },
        messages: [
            { type: "request-start", content: "Moving that for you now." },
            {
                type: "request-failed",
                content:
                    "I'm having trouble moving the appointment. Let me take your info and have someone follow up.",
            },
        ],
    });

    // Calendar: cancel appointment
    tools.push({
        type: "function",
        function: {
            name: "cancel_appointment",
            description:
                "Cancel a caller's existing appointment. Only call after the caller has explicitly confirmed they want to cancel.",
            parameters: {
                type: "object",
                properties: {
                    customer_phone: { type: "string" },
                },
                required: ["customer_phone"],
            },
        },
        server: { url: serverUrl, timeoutSeconds: 20 },
        messages: [
            { type: "request-start", content: "Cancelling that now." },
            {
                type: "request-failed",
                content: "I couldn't cancel the appointment. Let me have someone follow up.",
            },
        ],
    });

    // Rich transferCall tool — warm or cold based on tenant config
    const transferTool = buildTransferTool(formData.inboundTransfer, "inbound");
    if (transferTool) tools.push(transferTool);

    return tools;
}

/**
 * Builds the VAPI tools array for the RE Investor outbound follow-up agent.
 * Same tool surface as inbound (calendar + transferCall) but uses the
 * outbound-specific transfer specialist (which may differ from inbound).
 * `endCall` is appended by the payload builder, not here.
 */
export function buildREOutboundTools(
    clientId: string,
    appUrl: string,
    formData: REInvestorFormData
): unknown[] {
    // Outbound reuses the same calendar surface — sellers can still book a
    // sit-down with a specialist when they're ready. Only the transferCall
    // destination differs.
    const tools = buildREInboundTools(clientId, appUrl, formData).filter(
        (t: any) => t?.type !== "transferCall"
    );
    const transferTool = buildTransferTool(formData.outboundTransfer, "outbound");
    if (transferTool) tools.push(transferTool);
    return tools;
}

/**
 * Format phone number to E.164 format for VAPI.
 * "6158634486" → "+16158634486"
 * "(615) 863-4486" → "+16158634486"
 */
function formatE164(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("1") && digits.length === 11) {
        return `+${digits}`;
    }
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    return `+${digits}`;
}
