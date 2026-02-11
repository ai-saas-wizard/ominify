import { NextResponse } from "next/server";
import { getAvailableSlots, createEvent } from "@/lib/google-calendar";

/**
 * VAPI Tool Endpoint: Calendar Operations
 *
 * VAPI calls this when the assistant invokes "check_availability" or "book_appointment".
 * The clientId is passed as a query parameter in the tool's server URL.
 */

export async function POST(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const clientId = searchParams.get("clientId");

        if (!clientId) {
            return NextResponse.json(
                { results: [{ result: "Configuration error. Unable to access the calendar." }] },
                { status: 200 }
            );
        }

        const body = await request.json();

        // VAPI sends tool calls in the message payload
        const toolCall = body.message?.toolCallList?.[0] || body.message;
        const functionName =
            toolCall?.functionCall?.name ||
            toolCall?.function?.name ||
            toolCall?.name;
        const args =
            toolCall?.functionCall?.parameters ||
            toolCall?.function?.arguments ||
            toolCall?.parameters ||
            {};

        if (functionName === "check_availability") {
            const result = await getAvailableSlots(
                clientId,
                args.preferred_date,
                args.duration_minutes
            );

            if (!result) {
                return NextResponse.json({
                    results: [
                        {
                            toolCallId: toolCall?.id,
                            result:
                                "I'm unable to check our schedule right now. Let me take your information and have someone call you back to schedule.",
                        },
                    ],
                });
            }

            if (result.slots.length === 0) {
                return NextResponse.json({
                    results: [
                        {
                            toolCallId: toolCall?.id,
                            result:
                                "I wasn't able to find any available slots in that time range. Would you like me to check a different date?",
                        },
                    ],
                });
            }

            return NextResponse.json({
                results: [
                    {
                        toolCallId: toolCall?.id,
                        result: `Available slots: ${result.formatted}. Which time works best for you?`,
                    },
                ],
            });
        }

        if (functionName === "book_appointment") {
            if (!args.date || !args.time || !args.customer_name || !args.customer_phone) {
                return NextResponse.json({
                    results: [
                        {
                            toolCallId: toolCall?.id,
                            result:
                                "I need the date, time, your name, and phone number to book the appointment. Could you provide those details?",
                        },
                    ],
                });
            }

            const result = await createEvent(clientId, {
                date: args.date,
                time: args.time,
                customerName: args.customer_name,
                customerPhone: args.customer_phone,
                serviceType: args.service_type,
                notes: args.notes,
            });

            if (!result.success) {
                return NextResponse.json({
                    results: [
                        {
                            toolCallId: toolCall?.id,
                            result:
                                result.error === "Google Calendar not connected"
                                    ? "I'm unable to book appointments online right now. Let me take your information and have someone call you back to confirm the appointment."
                                    : "There was an issue booking the appointment. Let me take your information and have someone confirm with you.",
                        },
                    ],
                });
            }

            return NextResponse.json({
                results: [
                    {
                        toolCallId: toolCall?.id,
                        result: `Your appointment has been booked for ${result.formatted}. You're all set!`,
                    },
                ],
            });
        }

        // Unknown function
        return NextResponse.json({
            results: [
                {
                    toolCallId: toolCall?.id,
                    result: "I'm not sure how to help with that. Let me connect you with someone.",
                },
            ],
        });
    } catch (error) {
        console.error("[CALENDAR TOOL] Error:", error);
        return NextResponse.json({
            results: [
                {
                    result:
                        "I'm having trouble with our scheduling system right now. Let me take your information and have someone follow up with you.",
                },
            ],
        });
    }
}
