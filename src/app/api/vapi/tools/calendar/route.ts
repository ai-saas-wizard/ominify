import { NextResponse } from "next/server";
import {
    getAvailableSlots,
    createEvent,
    lookupAppointmentByPhone,
    rescheduleEvent,
    cancelEvent,
} from "@/lib/google-calendar";
import { supabase } from "@/lib/supabase";

/**
 * VAPI Tool Endpoint: Calendar Operations
 *
 * Handles five tool calls from VAPI assistants:
 *   - check_availability
 *   - book_appointment
 *   - lookup_appointment
 *   - reschedule_appointment
 *   - cancel_appointment
 *
 * Resolves the tenant (clientId) from the assistantId in the VAPI payload.
 * Falls back to ?clientId= query param for backwards compatibility.
 *
 * Response shape:
 *   { results: [{ toolCallId, result: "speech" }] }   on success
 *   { results: [{ toolCallId, error:  "speech" }] }   on failure (LLM retries)
 */

interface ToolResult {
    toolCallId?: string;
    result?: string;
    error?: string;
}

function ok(toolCallId: string | undefined, result: string) {
    const entry: ToolResult = { toolCallId, result };
    return NextResponse.json({ results: [entry] });
}

function fail(toolCallId: string | undefined, error: string) {
    const entry: ToolResult = { toolCallId, error };
    return NextResponse.json({ results: [entry] });
}

export async function POST(request: Request) {
    let parsedToolCallId: string | undefined;

    try {
        const body = await request.json();

        // ─── 1. Resolve clientId ─────────────────────────────────────
        const assistantId = body.message?.call?.assistantId
            || body.message?.assistant?.id
            || null;

        const { searchParams } = new URL(request.url);
        let clientId = searchParams.get("clientId");

        if (assistantId && !clientId) {
            const { data: agentRecord } = await supabase
                .from("agents")
                .select("client_id")
                .eq("vapi_id", assistantId)
                .single();

            if (agentRecord) {
                clientId = agentRecord.client_id;
            }
        }

        // ─── 2. Parse tool call (defensive across VAPI shapes) ──────
        // VAPI docs: message.toolCallList[0]
        // VAPI GitHub examples: message.toolCalls[0]
        // Legacy: message.functionCall
        const toolCall =
            body.message?.toolCallList?.[0] ||
            body.message?.toolCalls?.[0] ||
            body.message?.toolCall ||
            body.message?.functionCall ||
            body.message ||
            {};

        const toolCallId: string | undefined =
            toolCall?.id ||
            toolCall?.toolCallId ||
            toolCall?.tool_call_id;
        parsedToolCallId = toolCallId;

        const functionName: string | undefined =
            toolCall?.function?.name ||
            toolCall?.functionCall?.name ||
            toolCall?.name;

        let rawArgs: unknown =
            toolCall?.function?.arguments ??
            toolCall?.functionCall?.parameters ??
            toolCall?.arguments ??
            toolCall?.parameters ??
            {};

        // VAPI sometimes sends arguments as a JSON string
        if (typeof rawArgs === "string") {
            try {
                rawArgs = JSON.parse(rawArgs);
            } catch {
                rawArgs = {};
            }
        }
        const args: Record<string, any> = (rawArgs as Record<string, any>) || {};

        const vapiCallId: string | undefined = body.message?.call?.id;

        console.log(
            "[CALENDAR TOOL] clientId:", clientId,
            "assistantId:", assistantId,
            "function:", functionName,
            "args:", JSON.stringify(args),
            "vapiCallId:", vapiCallId,
        );

        if (!clientId) {
            console.error("[CALENDAR TOOL] Could not resolve clientId. assistantId:", assistantId);
            return fail(toolCallId, "Configuration error. Calendar is not available for this caller.");
        }

        if (!functionName) {
            console.error("[CALENDAR TOOL] Could not parse functionName from payload");
            return fail(toolCallId, "I couldn't parse that tool call. Please try again.");
        }

        // ─── 3. Dispatch on function name ───────────────────────────
        switch (functionName) {
            case "check_availability": {
                const result = await getAvailableSlots(clientId, {
                    preferredDate: args.preferred_date,
                    daysAhead: args.days_ahead,
                    durationMinutes: args.duration_minutes,
                    timeOfDay: args.time_of_day_preference,
                    earliestTime: args.earliest_time,
                    latestTime: args.latest_time,
                });

                if (!result) {
                    return fail(toolCallId, "Calendar is not connected right now.");
                }

                if (!result.slots || result.slots.length === 0) {
                    return ok(
                        toolCallId,
                        "I'm not finding open slots in that range. Want me to check a different date or time of day?",
                    );
                }

                return ok(
                    toolCallId,
                    `Available slots: ${result.formatted}. Which time works best?`,
                );
            }

            case "book_appointment": {
                if (!args.date || !args.time || !args.customer_name || !args.customer_phone) {
                    return fail(
                        toolCallId,
                        "I need the date, time, name, and phone number to book the appointment.",
                    );
                }

                const result = await createEvent(clientId, {
                    date: args.date,
                    time: args.time,
                    customerName: args.customer_name,
                    customerPhone: args.customer_phone,
                    customerEmail: args.customer_email,
                    timezone: args.timezone,
                    serviceType: args.service_type,
                    notes: args.notes,
                    vapiCallId,
                });

                if (result.success) {
                    return ok(toolCallId, `Booked for ${result.formatted}. You're all set.`);
                }

                switch (result.code) {
                    case "duplicate":
                        return ok(
                            toolCallId,
                            "It looks like we already have you down for that time — no need to book again.",
                        );
                    case "too_soon":
                        return ok(
                            toolCallId,
                            "That's a bit too soon to book — our earliest slot is a bit later. Want me to check other times?",
                        );
                    case "outside_hours":
                        return ok(
                            toolCallId,
                            "That's outside our business hours. Want me to find a slot during business hours?",
                        );
                    case "calendar_not_connected":
                        return fail(toolCallId, "Calendar not connected.");
                    default:
                        return fail(
                            toolCallId,
                            result.error || "I couldn't book that appointment.",
                        );
                }
            }

            case "lookup_appointment": {
                if (!args.customer_phone) {
                    return fail(toolCallId, "I need a phone number to look up the appointment.");
                }

                const result = await lookupAppointmentByPhone(clientId, args.customer_phone);

                if (!result.found || result.appointments.length === 0) {
                    return ok(
                        toolCallId,
                        "I don't see any appointments on your number. Want to book one?",
                    );
                }

                const first = result.appointments[0];
                const extra = result.appointments.length - 1;
                const base = `I have you booked for ${first.scheduledAtLocal}.`;
                const tail = extra > 0 ? ` You also have ${extra} more on file.` : "";
                return ok(toolCallId, base + tail);
            }

            case "reschedule_appointment": {
                if (!args.customer_phone || !args.new_date || !args.new_time) {
                    return fail(
                        toolCallId,
                        "I need a phone number plus the new date and time to reschedule.",
                    );
                }

                const result = await rescheduleEvent(
                    clientId,
                    args.customer_phone,
                    args.new_date,
                    args.new_time,
                    args.timezone,
                );

                if (result.success) {
                    return ok(toolCallId, `Moved to ${result.formatted}.`);
                }

                switch (result.code) {
                    case "not_found":
                        return ok(
                            toolCallId,
                            "I don't see an existing appointment on your number. Want to book a new one?",
                        );
                    case "duplicate":
                        return ok(
                            toolCallId,
                            "It looks like we already have you down for that time — no need to move it.",
                        );
                    case "too_soon":
                        return ok(
                            toolCallId,
                            "That's a bit too soon — our earliest slot is a bit later. Want me to check other times?",
                        );
                    case "outside_hours":
                        return ok(
                            toolCallId,
                            "That's outside our business hours. Want me to find a slot during business hours?",
                        );
                    case "calendar_not_connected":
                        return fail(toolCallId, "Calendar not connected.");
                    default:
                        return fail(
                            toolCallId,
                            result.error || "I couldn't move that appointment.",
                        );
                }
            }

            case "cancel_appointment": {
                if (!args.customer_phone) {
                    return fail(toolCallId, "I need a phone number to cancel the appointment.");
                }

                const result = await cancelEvent(clientId, args.customer_phone);

                if (result.success && (result.cancelled ?? 0) > 0) {
                    return ok(toolCallId, "Cancelled. Anything else I can help with?");
                }

                switch (result.code) {
                    case "not_found":
                        return ok(
                            toolCallId,
                            "I don't see an appointment to cancel on this number.",
                        );
                    case "calendar_not_connected":
                        return fail(toolCallId, "Calendar not connected.");
                    default:
                        return fail(
                            toolCallId,
                            result.error || "I couldn't cancel that appointment.",
                        );
                }
            }

            default:
                console.warn("[CALENDAR TOOL] Unknown function:", functionName);
                return fail(toolCallId, "I'm not sure how to help with that.");
        }
    } catch (error) {
        console.error("[CALENDAR TOOL] Error:", error);
        return fail(
            parsedToolCallId,
            "I'm having trouble with our scheduling system right now.",
        );
    }
}
