import "server-only";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt, secretLastChars } from "@/lib/encryption-helpers";

// ═══════════════════════════════════════════════════════════
// GOOGLE ADS — Lead Form Asset webhook integration (no OAuth).
//
// Tenant clicks "Generate webhook URL" → we mint a unique signing key
// and persist it. Tenant pastes the URL + key into each Google Ads
// Lead Form Asset (Tools → Asset Library → Lead Forms → edit form
// → Lead delivery options → Webhook integration). Google Ads then
// POSTs JSON to our endpoint with `google_key` matching what they
// pasted; we constant-time compare against the stored key.
// ═══════════════════════════════════════════════════════════

const KEY_PREFIX = "gak_";

function getWebhookBaseUrl(): string {
    const baseUrl =
        process.env.GOOGLE_ADS_WEBHOOK_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";
    return baseUrl.replace(/\/$/, "");
}

export function buildGoogleAdsWebhookUrl(clientId: string): string {
    return `${getWebhookBaseUrl()}/api/integrations/google-ads/webhook?clientId=${clientId}`;
}

function generateSigningKey(): string {
    return KEY_PREFIX + crypto.randomBytes(32).toString("hex");
}

export interface GoogleAdsConnection {
    is_active: boolean;
    connected_at: string | null;
    last_lead_at: string | null;
    last_webhook_at: string | null;
    webhook_signing_key_preview: string | null;
    webhook_url: string;
}

export async function generateGoogleAdsWebhook(clientId: string): Promise<{
    webhookUrl: string;
    signingKey: string;
}> {
    const signingKey = generateSigningKey();
    const nowIso = new Date().toISOString();

    const { error } = await supabase.from("tenant_google_ads").upsert(
        {
            client_id: clientId,
            webhook_signing_key_encrypted: encrypt(signingKey),
            is_active: true,
            connected_at: nowIso,
            updated_at: nowIso,
        },
        { onConflict: "client_id" }
    );

    if (error) {
        console.error("[GOOGLE ADS] Failed to save connection:", error);
        throw new Error("Failed to save Google Ads connection");
    }

    return { webhookUrl: buildGoogleAdsWebhookUrl(clientId), signingKey };
}

export async function rotateGoogleAdsKey(
    clientId: string
): Promise<{ signingKey: string }> {
    const signingKey = generateSigningKey();
    const { error } = await supabase
        .from("tenant_google_ads")
        .update({
            webhook_signing_key_encrypted: encrypt(signingKey),
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    if (error) {
        console.error("[GOOGLE ADS] Failed to rotate key:", error);
        throw new Error("Failed to rotate signing key");
    }
    return { signingKey };
}

export async function getGoogleAdsConnectionStatus(
    clientId: string
): Promise<GoogleAdsConnection | null> {
    const { data } = await supabase
        .from("tenant_google_ads")
        .select(
            "is_active, connected_at, last_lead_at, last_webhook_at, webhook_signing_key_encrypted"
        )
        .eq("client_id", clientId)
        .maybeSingle();

    if (!data) return null;

    return {
        is_active: !!data.is_active,
        connected_at: data.connected_at,
        last_lead_at: data.last_lead_at,
        last_webhook_at: data.last_webhook_at,
        webhook_signing_key_preview: secretLastChars(
            data.webhook_signing_key_encrypted,
            4
        ),
        webhook_url: buildGoogleAdsWebhookUrl(clientId),
    };
}

export async function getGoogleAdsSigningKey(
    clientId: string
): Promise<string | null> {
    const { data } = await supabase
        .from("tenant_google_ads")
        .select("webhook_signing_key_encrypted, is_active")
        .eq("client_id", clientId)
        .maybeSingle();

    if (!data || !data.is_active) return null;
    return safeDecrypt(data.webhook_signing_key_encrypted);
}

export async function disconnectGoogleAds(clientId: string): Promise<boolean> {
    const { error } = await supabase
        .from("tenant_google_ads")
        .update({
            is_active: false,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);
    if (error) {
        console.error("[GOOGLE ADS] Disconnect failed:", error);
        return false;
    }
    return true;
}

export function verifyGoogleAdsKey(
    presented: string | null | undefined,
    expected: string | null
): boolean {
    if (!presented || !expected) return false;
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

interface GoogleLeadColumn {
    column_name?: string;
    string_value?: string | null;
}

export interface GoogleNormalizedLead {
    full_name: string | null;
    phone_number: string | null;
    email: string | null;
}

export function normalizeGoogleLeadFields(
    rows: GoogleLeadColumn[]
): GoogleNormalizedLead {
    const out: GoogleNormalizedLead = {
        full_name: null,
        phone_number: null,
        email: null,
    };
    let firstName: string | null = null;
    let lastName: string | null = null;

    for (const r of rows || []) {
        const k = (r.column_name || "").toUpperCase();
        const v = r.string_value?.toString().trim() || null;
        if (!v) continue;
        if (k === "FULL_NAME" || k === "NAME") out.full_name = v;
        else if (k === "FIRST_NAME") firstName = v;
        else if (k === "LAST_NAME") lastName = v;
        else if (k === "PHONE_NUMBER" || k === "PHONE") out.phone_number = v;
        else if (k === "EMAIL") out.email = v;
    }

    if (!out.full_name && (firstName || lastName)) {
        out.full_name = [firstName, lastName].filter(Boolean).join(" ") || null;
    }

    return out;
}

export async function recordGoogleAdsWebhookHit(clientId: string): Promise<void> {
    await supabase
        .from("tenant_google_ads")
        .update({ last_webhook_at: new Date().toISOString() })
        .eq("client_id", clientId);
}

export async function recordGoogleAdsLeadDelivered(
    clientId: string
): Promise<void> {
    await supabase
        .from("tenant_google_ads")
        .update({ last_lead_at: new Date().toISOString() })
        .eq("client_id", clientId);
}
