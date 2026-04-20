import type { REInvestorFormData } from "../types";

/**
 * Builds the VAPI tools array for the RE Investor inbound receptionist.
 * Mirrors the exact tool structure from assistant-creation-actions.ts but
 * with RE-specific configuration (transferCall uses blind transfer like Samantha's setup)
 * and adds `address`/`zip_code` fields to check_availability since the RE prompt
 * tells the agent to pass full property address.
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

    // Transfer call — blind transfer to escalation phone (same as Samantha's setup)
    if (formData.transferPhone) {
        const transferNumber = formatE164(formData.transferPhone);
        tools.push({
            type: "transferCall",
            function: {
                name: "transfer_call_tool",
                description:
                    "Use this function when the caller has asked the agent if you are an AI 2 times in a row",
            },
            destinations: [
                {
                    type: "number",
                    number: transferNumber,
                    message: "Please hold on a sec",
                    description:
                        "Use this destination when the caller has asked the agent if you are an AI 2 times in a row",
                    transferPlan: {
                        mode: "blind-transfer",
                    },
                    numberE164CheckEnabled: true,
                },
            ],
        });
    }

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
