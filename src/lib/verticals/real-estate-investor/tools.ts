import type { REInvestorFormData } from "../types";

/**
 * Builds the VAPI tools array for the RE Investor inbound receptionist.
 * Mirrors the exact tool structure from agent-deployment-actions.ts but
 * with RE-specific configuration (transferCall uses blind transfer like Samantha's setup).
 */
export function buildREInboundTools(
    clientId: string,
    appUrl: string,
    formData: REInvestorFormData
): unknown[] {
    const tools: unknown[] = [];

    // Calendar: check availability
    tools.push({
        type: "function",
        function: {
            name: "check_availability",
            description: "Check available appointment slots.",
            parameters: {
                type: "object",
                properties: {
                    preferred_date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format",
                    },
                    service_type: {
                        type: "string",
                        description: "Type of service",
                    },
                },
            },
        },
        server: {
            url: `${appUrl}/api/vapi/tools/calendar`,
        },
    });

    // Calendar: book appointment
    tools.push({
        type: "function",
        function: {
            name: "book_appointment",
            description: "Book a confirmed appointment slot.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format",
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format",
                    },
                    customer_name: {
                        type: "string",
                        description: "Customer name",
                    },
                    customer_phone: {
                        type: "string",
                        description: "Customer phone",
                    },
                    service_type: {
                        type: "string",
                        description: "Type of service",
                    },
                    notes: {
                        type: "string",
                        description: "Additional notes",
                    },
                },
                required: ["date", "time", "customer_name", "customer_phone"],
            },
        },
        server: {
            url: `${appUrl}/api/vapi/tools/calendar`,
        },
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
