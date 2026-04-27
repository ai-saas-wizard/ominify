import { NextResponse } from "next/server";
import { exchangeMetaCodeForTokens } from "@/lib/meta-ads";

/**
 * Meta OAuth callback.
 *
 * GET /api/integrations/meta-ads/callback?code=...&state={clientId}
 *
 * After token exchange, the user lands on the integrations settings page.
 * They then pick which Page(s) to subscribe to via a separate UI step
 * (see /settings/integrations + meta-ads-actions.subscribeMetaPagesAction).
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const clientId = searchParams.get("state");
    const error = searchParams.get("error");

    if (error || !clientId) {
        const redirectUrl = clientId
            ? `/client/${clientId}/settings/integrations?error=meta_ads_denied`
            : "/?error=meta_ads_denied";
        return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    if (!code) {
        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?error=meta_ads_failed`,
                request.url
            )
        );
    }

    try {
        await exchangeMetaCodeForTokens(code, clientId);
        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?success=meta_ads`,
                request.url
            )
        );
    } catch (err) {
        console.error("[META ADS CALLBACK] Token exchange failed:", err);
        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?error=meta_ads_failed`,
                request.url
            )
        );
    }
}
