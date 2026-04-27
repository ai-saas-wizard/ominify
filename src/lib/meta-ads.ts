import "server-only";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt } from "@/lib/encryption-helpers";

// ═══════════════════════════════════════════════════════════
// META ADS (Facebook & Instagram Lead Ads) INTEGRATION
//
// OAuth → user picks Page(s) → we subscribe each Page's `leadgen`
// webhook field. A single shared webhook URL (configured in the Meta
// App dashboard) receives all leadgen events across all subscribed
// Pages. The receiver routes by `entry[].id` (page_id) → tenant.
// ═══════════════════════════════════════════════════════════

const FB_GRAPH = "https://graph.facebook.com/v21.0";

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI;

const META_SCOPES = [
    "email",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
    "leads_retrieval",
    "business_management",
];

function requireConfig() {
    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
        throw new Error(
            "META_APP_ID, META_APP_SECRET and META_REDIRECT_URI must be set"
        );
    }
    return {
        appId: META_APP_ID,
        appSecret: META_APP_SECRET,
        redirectUri: META_REDIRECT_URI,
    };
}

// ─── OAuth ───

export function getMetaAuthorizationUrl(clientId: string): string {
    const { appId, redirectUri } = requireConfig();
    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state: clientId,
        scope: META_SCOPES.join(","),
        response_type: "code",
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeMetaCodeForTokens(
    code: string,
    clientId: string
): Promise<void> {
    const { appId, appSecret, redirectUri } = requireConfig();

    // 1) code → short-lived user token
    const shortRes = await fetch(
        `${FB_GRAPH}/oauth/access_token?` +
            new URLSearchParams({
                client_id: appId,
                client_secret: appSecret,
                redirect_uri: redirectUri,
                code,
            }),
        { method: "GET" }
    );
    if (!shortRes.ok) {
        const body = await shortRes.text();
        throw new Error(`Meta short-lived token exchange failed: ${body}`);
    }
    const shortJson = (await shortRes.json()) as {
        access_token: string;
        expires_in?: number;
    };

    // 2) short-lived → long-lived user token (60 days)
    const longRes = await fetch(
        `${FB_GRAPH}/oauth/access_token?` +
            new URLSearchParams({
                grant_type: "fb_exchange_token",
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: shortJson.access_token,
            }),
        { method: "GET" }
    );
    if (!longRes.ok) {
        const body = await longRes.text();
        throw new Error(`Meta long-lived token exchange failed: ${body}`);
    }
    const longJson = (await longRes.json()) as {
        access_token: string;
        expires_in?: number;
    };

    const userToken = longJson.access_token;
    const expiresAt = longJson.expires_in
        ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
        : null;

    // 3) Identity (so we can correlate Meta data-deletion requests by fb_user_id)
    const meRes = await fetch(
        `${FB_GRAPH}/me?fields=id,name,email&access_token=${encodeURIComponent(userToken)}`
    );
    if (!meRes.ok) {
        const body = await meRes.text();
        throw new Error(`Meta /me lookup failed: ${body}`);
    }
    const me = (await meRes.json()) as {
        id: string;
        name?: string;
        email?: string;
    };

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("tenant_meta_ads").upsert(
        {
            client_id: clientId,
            fb_user_id: me.id,
            fb_user_name: me.name || null,
            fb_user_email: me.email || null,
            user_access_token_encrypted: encrypt(userToken),
            user_token_expires_at: expiresAt,
            is_active: true,
            connected_at: nowIso,
            updated_at: nowIso,
        },
        { onConflict: "client_id" }
    );
    if (error) {
        console.error("[META ADS] Failed to save tokens:", error);
        throw new Error("Failed to save Meta connection");
    }
}

// ─── Token retrieval ───

async function getUserAccessToken(clientId: string): Promise<string | null> {
    const { data } = await supabase
        .from("tenant_meta_ads")
        .select("user_access_token_encrypted, is_active")
        .eq("client_id", clientId)
        .maybeSingle();
    if (!data || !data.is_active) return null;
    return safeDecrypt(data.user_access_token_encrypted);
}

async function getPageAccessToken(pageId: string): Promise<string | null> {
    const { data } = await supabase
        .from("tenant_meta_ads_pages")
        .select("page_access_token_encrypted, subscription_active")
        .eq("page_id", pageId)
        .maybeSingle();
    if (!data || !data.subscription_active) return null;
    return safeDecrypt(data.page_access_token_encrypted);
}

// ─── Page management ───

export interface MetaPage {
    id: string;
    name: string;
    category?: string;
    access_token: string;
}

export interface MetaSubscribedPage {
    id: string;
    page_id: string;
    page_name: string | null;
    subscribed_at: string | null;
    last_lead_at: string | null;
    last_webhook_at: string | null;
    subscription_active: boolean;
}

export async function listUserPages(clientId: string): Promise<MetaPage[]> {
    const userToken = await getUserAccessToken(clientId);
    if (!userToken) return [];

    const res = await fetch(
        `${FB_GRAPH}/me/accounts?fields=id,name,category,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`
    );
    if (!res.ok) {
        const body = await res.text();
        console.error("[META ADS] /me/accounts failed:", body);
        return [];
    }
    const json = (await res.json()) as { data?: MetaPage[] };
    return json.data ?? [];
}

export async function listSubscribedPages(
    clientId: string
): Promise<MetaSubscribedPage[]> {
    const { data } = await supabase
        .from("tenant_meta_ads_pages")
        .select(
            "id, page_id, page_name, subscribed_at, last_lead_at, last_webhook_at, subscription_active"
        )
        .eq("client_id", clientId)
        .order("subscribed_at", { ascending: false });
    return (data as MetaSubscribedPage[]) ?? [];
}

export async function subscribePages(
    clientId: string,
    pageIds: string[]
): Promise<{ success: boolean; subscribed: string[]; failed: { pageId: string; error: string }[] }> {
    if (pageIds.length === 0) {
        return { success: true, subscribed: [], failed: [] };
    }

    const pages = await listUserPages(clientId);
    const wanted = pages.filter((p) => pageIds.includes(p.id));

    const subscribed: string[] = [];
    const failed: { pageId: string; error: string }[] = [];

    for (const page of wanted) {
        try {
            const subRes = await fetch(
                `${FB_GRAPH}/${page.id}/subscribed_apps`,
                {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        subscribed_fields: "leadgen",
                        access_token: page.access_token,
                    }),
                }
            );
            if (!subRes.ok) {
                const body = await subRes.text();
                failed.push({ pageId: page.id, error: body });
                continue;
            }

            const nowIso = new Date().toISOString();
            const { error } = await supabase
                .from("tenant_meta_ads_pages")
                .upsert(
                    {
                        client_id: clientId,
                        page_id: page.id,
                        page_name: page.name,
                        page_access_token_encrypted: encrypt(page.access_token),
                        subscription_active: true,
                        subscribed_at: nowIso,
                        updated_at: nowIso,
                    },
                    { onConflict: "client_id,page_id" }
                );
            if (error) {
                failed.push({ pageId: page.id, error: error.message });
                continue;
            }
            subscribed.push(page.id);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            failed.push({ pageId: page.id, error: message });
        }
    }

    return { success: failed.length === 0, subscribed, failed };
}

export async function unsubscribePage(
    clientId: string,
    pageId: string
): Promise<boolean> {
    const pageToken = await getPageAccessToken(pageId);
    if (pageToken) {
        try {
            await fetch(
                `${FB_GRAPH}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
                { method: "DELETE" }
            );
        } catch (err) {
            console.error("[META ADS] Unsubscribe call failed:", err);
            // Fall through — we still mark inactive so the tenant isn't stuck.
        }
    }

    const { error } = await supabase
        .from("tenant_meta_ads_pages")
        .update({
            subscription_active: false,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId)
        .eq("page_id", pageId);
    return !error;
}

export async function disconnectMetaAds(clientId: string): Promise<boolean> {
    const subscribed = await listSubscribedPages(clientId);
    for (const sub of subscribed) {
        if (sub.subscription_active) {
            await unsubscribePage(clientId, sub.page_id);
        }
    }
    const { error } = await supabase
        .from("tenant_meta_ads")
        .update({
            is_active: false,
            user_access_token_encrypted: null,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);
    return !error;
}

// ─── Connection status ───

export interface MetaAdsConnectionStatus {
    is_active: boolean;
    connected_at: string | null;
    fb_user_name: string | null;
    fb_user_email: string | null;
    user_token_expires_at: string | null;
    subscribed_pages: MetaSubscribedPage[];
}

export async function getMetaAdsConnectionStatus(
    clientId: string
): Promise<MetaAdsConnectionStatus | null> {
    const { data } = await supabase
        .from("tenant_meta_ads")
        .select(
            "is_active, connected_at, fb_user_name, fb_user_email, user_token_expires_at"
        )
        .eq("client_id", clientId)
        .maybeSingle();
    if (!data || !data.is_active) return null;

    const subscribed_pages = await listSubscribedPages(clientId);
    return {
        is_active: !!data.is_active,
        connected_at: data.connected_at,
        fb_user_name: data.fb_user_name,
        fb_user_email: data.fb_user_email,
        user_token_expires_at: data.user_token_expires_at,
        subscribed_pages,
    };
}

// ─── Webhook signature ───

export function verifyMetaWebhookSignature(
    rawBody: string,
    headerValue: string | null
): boolean {
    if (!headerValue || !META_APP_SECRET) return false;
    const expected = "sha256=" + crypto
        .createHmac("sha256", META_APP_SECRET)
        .update(rawBody, "utf8")
        .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(headerValue);
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

export function metaVerifyToken(): string | undefined {
    return process.env.META_WEBHOOK_VERIFY_TOKEN;
}

// ─── Lead retrieval ───

interface MetaLeadFieldData {
    name: string;
    values: string[];
}

interface MetaLeadResponse {
    id: string;
    created_time: string;
    field_data: MetaLeadFieldData[];
    ad_id?: string;
    form_id?: string;
    campaign_id?: string;
}

export interface MetaNormalizedLead {
    full_name: string | null;
    phone_number: string | null;
    email: string | null;
}

export function normalizeMetaLeadFields(
    field_data: MetaLeadFieldData[]
): MetaNormalizedLead {
    const out: MetaNormalizedLead = {
        full_name: null,
        phone_number: null,
        email: null,
    };
    let firstName: string | null = null;
    let lastName: string | null = null;
    for (const f of field_data || []) {
        const name = (f.name || "").toLowerCase();
        const value = f.values?.[0] || null;
        if (!value) continue;
        if (name === "full_name" || name === "name") out.full_name = value;
        else if (name === "first_name") firstName = value;
        else if (name === "last_name") lastName = value;
        else if (name === "phone_number" || name === "phone") out.phone_number = value;
        else if (name === "email") out.email = value;
    }
    if (!out.full_name && (firstName || lastName)) {
        out.full_name = [firstName, lastName].filter(Boolean).join(" ") || null;
    }
    return out;
}

export async function fetchLeadDetails(
    pageAccessToken: string,
    leadgenId: string
): Promise<MetaLeadResponse | null> {
    const res = await fetch(
        `${FB_GRAPH}/${leadgenId}?fields=id,created_time,field_data,ad_id,form_id,campaign_id&access_token=${encodeURIComponent(pageAccessToken)}`
    );
    if (!res.ok) {
        const body = await res.text();
        console.error("[META ADS] fetchLeadDetails failed:", body);
        return null;
    }
    return (await res.json()) as MetaLeadResponse;
}

// ─── Leadgen event processing ───

export interface MetaLeadgenChange {
    leadgen_id: string;
    page_id: string;
    form_id: string;
    ad_id?: string;
    adgroup_id?: string;
    created_time: number;
}

export async function processMetaLeadEvent(
    value: MetaLeadgenChange,
    deps: { ingestAdLead: typeof import("./ad-leads").ingestAdLead }
): Promise<void> {
    // Look up tenant by page_id (globally unique across Meta).
    const { data: pageRow } = await supabase
        .from("tenant_meta_ads_pages")
        .select("client_id, page_access_token_encrypted, subscription_active")
        .eq("page_id", value.page_id)
        .maybeSingle();
    if (!pageRow || !pageRow.subscription_active) {
        console.warn(
            "[META ADS] leadgen for unknown/inactive page_id:",
            value.page_id
        );
        return;
    }

    const pageToken = safeDecrypt(pageRow.page_access_token_encrypted);
    if (!pageToken) {
        console.error("[META ADS] No page token for page_id:", value.page_id);
        return;
    }

    // Touch last_webhook_at first so the UI reflects "we got something" even if
    // the Graph fetch fails downstream.
    await supabase
        .from("tenant_meta_ads_pages")
        .update({ last_webhook_at: new Date().toISOString() })
        .eq("page_id", value.page_id);

    const lead = await fetchLeadDetails(pageToken, value.leadgen_id);
    if (!lead) return;

    const fields = normalizeMetaLeadFields(lead.field_data);

    await deps.ingestAdLead({
        clientId: pageRow.client_id,
        triggerType: "meta_ads_lead",
        source: "meta_ads",
        externalLeadId: value.leadgen_id,
        externalAdId: value.ad_id || lead.ad_id || null,
        externalFormId: value.form_id || lead.form_id || null,
        name: fields.full_name,
        phone: fields.phone_number,
        email: fields.email,
        rawFields: lead.field_data,
    });

    await supabase
        .from("tenant_meta_ads_pages")
        .update({ last_lead_at: new Date().toISOString() })
        .eq("page_id", value.page_id);
}
