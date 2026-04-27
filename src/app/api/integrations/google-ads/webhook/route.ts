import { NextResponse } from "next/server";
import {
    getGoogleAdsSigningKey,
    verifyGoogleAdsKey,
    normalizeGoogleLeadFields,
    recordGoogleAdsWebhookHit,
    recordGoogleAdsLeadDelivered,
} from "@/lib/google-ads";
import { ingestAdLead } from "@/lib/ad-leads";

interface GoogleAdsWebhookPayload {
    google_key?: string;
    lead_id?: string;
    gcl_id?: string;
    campaign_id?: number | string;
    form_id?: number | string;
    is_test?: boolean | string;
    user_column_data?: Array<{ column_name?: string; string_value?: string }>;
    api_version?: string;
}

/**
 * Google Ads Lead Form Asset webhook receiver.
 *
 * URL: POST /api/integrations/google-ads/webhook?clientId={uuid}
 *
 * Google Ads delivers a JSON payload like:
 *   {
 *     "lead_id": "...",
 *     "user_column_data": [
 *       { "column_name": "FULL_NAME", "string_value": "Jane Doe" },
 *       { "column_name": "EMAIL",     "string_value": "jane@example.com" },
 *       { "column_name": "PHONE_NUMBER", "string_value": "+15551234567" }
 *     ],
 *     "api_version": "1.0",
 *     "form_id": 12345,
 *     "campaign_id": 67890,
 *     "google_key": "<key the user pasted in Google Ads UI>",
 *     "is_test": false,
 *     ...
 *   }
 *
 * The receiver MUST verify `google_key` matches the per-tenant key we
 * generated. We always reply 200 once the key matches so Google Ads
 * doesn't retry forever — downstream errors are logged and surfaced
 * via `last_webhook_at` / `last_lead_at` in the integrations UI.
 */
export async function POST(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
    }

    let payload: GoogleAdsWebhookPayload;
    try {
        payload = (await request.json()) as GoogleAdsWebhookPayload;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const expectedKey = await getGoogleAdsSigningKey(clientId);
    const presentedKey =
        typeof payload?.google_key === "string" ? payload.google_key : null;

    if (!verifyGoogleAdsKey(presentedKey, expectedKey)) {
        console.warn(
            "[GOOGLE ADS WEBHOOK] Invalid or missing google_key for client:",
            clientId
        );
        return NextResponse.json({ error: "Invalid key" }, { status: 401 });
    }

    // Touch webhook timestamp regardless of whether this is a test or real lead.
    await recordGoogleAdsWebhookHit(clientId);

    const isTest = payload?.is_test === true || payload?.is_test === "true";
    const fields = normalizeGoogleLeadFields(payload?.user_column_data ?? []);

    // Google's "lead_id" is sometimes absent on test pings; fall back to a
    // synthesized id so the idempotency index still has a value to dedupe on.
    const externalLeadId =
        (typeof payload?.lead_id === "string" && payload.lead_id) ||
        `gform-${payload?.form_id ?? "unknown"}-${Date.now()}`;

    try {
        await ingestAdLead({
            clientId,
            triggerType: "google_ads_lead",
            source: "google_ads",
            externalLeadId,
            externalAdId: payload?.gcl_id || payload?.campaign_id?.toString() || null,
            externalFormId: payload?.form_id?.toString() || null,
            name: fields.full_name,
            phone: fields.phone_number,
            email: fields.email,
            rawFields: payload?.user_column_data ?? null,
            isTest,
        });
    } catch (err) {
        console.error("[GOOGLE ADS WEBHOOK] ingestAdLead failed:", err);
        // Still return 200 so Google Ads doesn't retry — the lead is logged
        // server-side and the user will see the issue via missing last_lead_at.
        return NextResponse.json({ received: true, error: "ingest_failed" });
    }

    if (!isTest) {
        await recordGoogleAdsLeadDelivered(clientId);
    }

    return NextResponse.json({ received: true, test: isTest });
}
