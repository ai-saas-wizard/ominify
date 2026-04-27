import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { unsubscribePage } from "@/lib/meta-ads";

/**
 * Meta Data Deletion Request callback.
 *
 * Required by Meta App Review. When a user removes our app from their
 * Facebook account, Meta POSTs a `signed_request` payload here. We:
 *   1. Verify the HMAC signature using META_APP_SECRET.
 *   2. Extract the user_id (their FB user id).
 *   3. Find every tenant_meta_ads row with matching fb_user_id and
 *      deactivate it + null its tokens. Also unsubscribe each page.
 *   4. Return { url, confirmation_code } so the user can track deletion.
 */

function base64UrlDecode(input: string): Buffer {
    // Convert URL-safe base64 to standard base64.
    const padded =
        input.replace(/-/g, "+").replace(/_/g, "/") +
        "===".slice(0, (4 - (input.length % 4)) % 4);
    return Buffer.from(padded, "base64");
}

function parseSignedRequest(signedRequest: string, appSecret: string): {
    user_id?: string;
    issued_at?: number;
} | null {
    const parts = signedRequest.split(".");
    if (parts.length !== 2) return null;
    const [encodedSig, encodedPayload] = parts;
    const expected = crypto
        .createHmac("sha256", appSecret)
        .update(encodedPayload)
        .digest();
    const provided = base64UrlDecode(encodedSig);
    if (
        expected.length !== provided.length ||
        !crypto.timingSafeEqual(expected, provided)
    ) {
        return null;
    }
    try {
        return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        return NextResponse.json(
            { error: "Server not configured" },
            { status: 500 }
        );
    }

    let signedRequest: string | null = null;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await request.formData();
        signedRequest = (formData.get("signed_request") as string) || null;
    } else if (contentType.includes("application/json")) {
        const json = (await request.json()) as { signed_request?: string };
        signedRequest = json.signed_request || null;
    }
    if (!signedRequest) {
        return NextResponse.json(
            { error: "Missing signed_request" },
            { status: 400 }
        );
    }

    const parsed = parseSignedRequest(signedRequest, appSecret);
    if (!parsed || !parsed.user_id) {
        return NextResponse.json(
            { error: "Invalid signed_request" },
            { status: 400 }
        );
    }

    const fbUserId = parsed.user_id;
    const confirmationCode = crypto.randomBytes(12).toString("hex");

    try {
        // Find every tenant connected as this FB user, unsubscribe all their
        // pages, and clear their tokens.
        const { data: tenants } = await supabase
            .from("tenant_meta_ads")
            .select("client_id")
            .eq("fb_user_id", fbUserId);

        for (const t of tenants || []) {
            const { data: pages } = await supabase
                .from("tenant_meta_ads_pages")
                .select("page_id")
                .eq("client_id", t.client_id)
                .eq("subscription_active", true);
            for (const p of pages || []) {
                await unsubscribePage(t.client_id, p.page_id);
            }
        }

        await supabase
            .from("tenant_meta_ads")
            .update({
                is_active: false,
                user_access_token_encrypted: null,
                updated_at: new Date().toISOString(),
            })
            .eq("fb_user_id", fbUserId);
    } catch (err) {
        console.error("[META DATA DELETION] Failed:", err);
        // Still return success so Meta doesn't retry forever; we'll see
        // the failed cleanup in logs.
    }

    const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app.omnify.com";
    return NextResponse.json({
        url: `${baseUrl.replace(/\/$/, "")}/legal/meta-data-deletion?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
    });
}
