import { NextResponse } from "next/server";
import {
    verifyMetaWebhookSignature,
    metaVerifyToken,
    processMetaLeadEvent,
    type MetaLeadgenChange,
} from "@/lib/meta-ads";
import { ingestAdLead } from "@/lib/ad-leads";

/**
 * Meta Ads (Facebook + Instagram Lead Ads) webhook.
 *
 * Single shared URL across all tenants — Meta dispatches every leadgen
 * event for every Page subscribed to our App here. Routing happens by
 * `entry[].id` (page_id) → tenant_meta_ads_pages → tenant.
 *
 * GET  /api/integrations/meta-ads/webhook  — verification handshake.
 * POST /api/integrations/meta-ads/webhook  — leadgen events.
 */

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    const expectedToken = metaVerifyToken();
    if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
        return new Response(challenge, {
            status: 200,
            headers: { "content-type": "text/plain" },
        });
    }
    return new Response("Forbidden", { status: 403 });
}

interface MetaLeadgenWebhook {
    object: "page";
    entry: Array<{
        id: string;
        time: number;
        changes: Array<{
            field: string;
            value: MetaLeadgenChange;
        }>;
    }>;
}

export async function POST(request: Request) {
    const rawBody = await request.text();
    const sig = request.headers.get("x-hub-signature-256");

    if (!verifyMetaWebhookSignature(rawBody, sig)) {
        console.warn("[META ADS WEBHOOK] Invalid signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: MetaLeadgenWebhook;
    try {
        payload = JSON.parse(rawBody) as MetaLeadgenWebhook;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (payload.object !== "page") {
        // Acknowledge unknown payloads so Meta doesn't retry.
        return NextResponse.json({ received: true });
    }

    for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue;
            try {
                await processMetaLeadEvent(change.value, { ingestAdLead });
            } catch (err) {
                console.error("[META ADS WEBHOOK] processMetaLeadEvent failed:", err);
                // Swallow — always 200 so Meta stops retrying. The unique
                // index on enrollment_data->>'meta_leadgen_id' prevents
                // duplicate enrollments if we DO eventually succeed.
            }
        }
    }

    return NextResponse.json({ received: true });
}
