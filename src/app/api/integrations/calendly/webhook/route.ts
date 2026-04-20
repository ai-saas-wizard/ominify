import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyWebhookSignature, getWebhookSigningKey } from "@/lib/calendly";

/**
 * Calendly webhook receiver.
 *
 * Subscribed events: invitee.created, invitee.canceled
 * When a caller reschedules in Calendly, Calendly emits canceled+created.
 *
 * URL: POST /api/integrations/calendly/webhook?clientId={uuid}
 * The clientId is passed as a query param at subscription time so we know
 * which tenant's signing_key to verify against.
 */
export async function POST(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("calendly-webhook-signature");

    const signingKey = await getWebhookSigningKey(clientId);
    if (!signingKey) {
        console.warn("[CALENDLY WEBHOOK] No signing key for client:", clientId);
        // Accept so Calendly doesn't retry forever, but don't trust payload.
        return NextResponse.json({ received: true });
    }

    if (!verifyWebhookSignature(rawBody, signature, signingKey)) {
        console.warn("[CALENDLY WEBHOOK] Signature verification failed for client:", clientId);
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    type InviteeEvent = {
        event: "invitee.created" | "invitee.canceled";
        payload: {
            uri: string;
            event: string;
            status?: string;
        };
    };

    let parsed: InviteeEvent;
    try {
        parsed = JSON.parse(rawBody) as InviteeEvent;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { event, payload } = parsed;
    const inviteeUri = payload.uri;

    // We only reconcile cancellations. invitee.created fires both for our own
    // API bookings (already in DB) and for any external Calendly bookings
    // (which we intentionally don't track — those show up in Calendly's UI).
    if (event === "invitee.canceled") {
        try {
            await supabase
                .from("appointments")
                .update({
                    status: "cancelled",
                    updated_at: new Date().toISOString(),
                })
                .eq("calendly_invitee_uri", inviteeUri);
        } catch (err) {
            console.error("[CALENDLY WEBHOOK] Cancel-sync failed:", err);
            return NextResponse.json({ error: "Handler failed" }, { status: 500 });
        }
    }

    return NextResponse.json({ received: true });
}
