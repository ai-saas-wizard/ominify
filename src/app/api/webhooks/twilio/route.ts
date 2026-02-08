import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Twilio webhook handler for inbound SMS, delivery status, and voice events
// Twilio sends webhooks as application/x-www-form-urlencoded POST requests

export async function POST(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const type = url.searchParams.get("type");
        const tenantId = url.searchParams.get("tenantId");

        // Parse form data from Twilio
        const formData = await request.formData();
        const body: Record<string, string> = {};
        formData.forEach((value, key) => {
            body[key] = value.toString();
        });

        console.log(`[TWILIO WEBHOOK] type=${type} tenantId=${tenantId}`, {
            MessageSid: body.MessageSid,
            From: body.From,
            To: body.To,
            MessageStatus: body.MessageStatus,
        });

        if (!tenantId) {
            console.error("[TWILIO WEBHOOK] Missing tenantId");
            return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
        }

        switch (type) {
            case "sms-inbound":
            case "messaging":
                return handleInboundSMS(tenantId, body);

            case "sms-status":
            case "status":
                return handleDeliveryStatus(tenantId, body);

            case "voice-inbound":
                return handleInboundVoice(tenantId, body);

            default:
                console.log(`[TWILIO WEBHOOK] Unknown type: ${type}`);
                return NextResponse.json({ received: true });
        }
    } catch (error: any) {
        console.error("[TWILIO WEBHOOK] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// ─── Inbound SMS Handler ────────────────────────────────────────────────────

async function handleInboundSMS(tenantId: string, body: Record<string, string>) {
    const from = body.From;
    const to = body.To;
    const messageBody = body.Body;
    const messageSid = body.MessageSid;

    if (!from || !messageBody) {
        return NextResponse.json({ received: true });
    }

    console.log(`[TWILIO SMS] Inbound from ${from} to ${to}: "${messageBody.substring(0, 50)}..."`);

    // Find the contact by phone number in this tenant's contacts
    const { data: contact } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("client_id", tenantId)
        .eq("phone", from)
        .single();

    if (contact) {
        // Record the interaction in contact_history
        await supabase.from("contact_history").insert({
            contact_id: contact.id,
            client_id: tenantId,
            type: "sms_inbound",
            content: messageBody,
            metadata: {
                message_sid: messageSid,
                from,
                to,
            },
        });

        // Check for opt-out keywords
        const normalizedMsg = messageBody.trim().toUpperCase();
        if (["STOP", "UNSUBSCRIBE", "CANCEL"].includes(normalizedMsg)) {
            console.log(`[TWILIO SMS] Opt-out received from ${from} for tenant ${tenantId}`);

            // Unenroll from any active sequences
            await supabase
                .from("sequence_enrollments")
                .update({ status: "opted_out", updated_at: new Date().toISOString() })
                .eq("contact_id", contact.id)
                .in("status", ["active", "paused"]);
        }

        // Check for reply that might affect sequence enrollment
        // Mark any active enrollment as "replied"
        if (!["STOP", "UNSUBSCRIBE", "CANCEL", "START", "YES", "SUBSCRIBE", "HELP", "INFO"].includes(normalizedMsg)) {
            const { data: activeEnrollments } = await supabase
                .from("sequence_enrollments")
                .select("id")
                .eq("contact_id", contact.id)
                .eq("status", "active")
                .limit(1);

            if (activeEnrollments && activeEnrollments.length > 0) {
                await supabase
                    .from("sequence_enrollments")
                    .update({ status: "replied", updated_at: new Date().toISOString() })
                    .eq("id", activeEnrollments[0].id);

                console.log(`[TWILIO SMS] Contact ${contact.id} replied to sequence enrollment ${activeEnrollments[0].id}`);
            }
        }
    } else {
        console.log(`[TWILIO SMS] No matching contact found for ${from} in tenant ${tenantId}`);
    }

    // Respond with empty TwiML (acknowledge receipt)
    return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
            status: 200,
            headers: { "Content-Type": "application/xml" },
        }
    );
}

// ─── Delivery Status Handler ────────────────────────────────────────────────

async function handleDeliveryStatus(tenantId: string, body: Record<string, string>) {
    const messageSid = body.MessageSid || body.SmsSid;
    const messageStatus = body.MessageStatus || body.SmsStatus;

    if (!messageSid || !messageStatus) {
        return NextResponse.json({ received: true });
    }

    console.log(`[TWILIO STATUS] ${messageSid}: ${messageStatus}`);

    // Update execution log with delivery result
    const { error } = await supabase
        .from("sequence_execution_log")
        .update({
            status: messageStatus === "delivered" ? "delivered" : messageStatus === "failed" || messageStatus === "undelivered" ? "failed" : messageStatus,
            provider_message_id: messageSid,
            error_message: messageStatus === "failed" || messageStatus === "undelivered" ? body.ErrorMessage : null,
            updated_at: new Date().toISOString(),
        })
        .eq("provider_message_id", messageSid);

    if (error) {
        // Try matching by tenant_id and recent entries if direct match fails
        console.log(`[TWILIO STATUS] Direct update failed for ${messageSid}, trying fallback`);
    }

    return NextResponse.json({ received: true });
}

// ─── Inbound Voice Handler ──────────────────────────────────────────────────

async function handleInboundVoice(tenantId: string, body: Record<string, string>) {
    const from = body.From;
    const to = body.To;
    const callSid = body.CallSid;

    console.log(`[TWILIO VOICE] Inbound call from ${from} to ${to} (${callSid})`);

    // For now, respond with a simple TwiML that can be extended later
    // In production, this would forward to VAPI or a custom IVR
    return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Thank you for calling. We will get back to you shortly.</Say>
    <Hangup/>
</Response>`,
        {
            status: 200,
            headers: { "Content-Type": "application/xml" },
        }
    );
}
