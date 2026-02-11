import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-calendar";

/**
 * Google Calendar OAuth callback.
 * Exchanges the authorization code for tokens and stores them.
 *
 * GET /api/integrations/google-calendar/callback?code=xxx&state=clientId
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const clientId = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
        // User denied access
        const redirectUrl = clientId
            ? `/client/${clientId}/settings/integrations?error=denied`
            : "/?error=denied";
        return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    if (!code || !clientId) {
        return NextResponse.json(
            { error: "Missing authorization code or client ID" },
            { status: 400 }
        );
    }

    try {
        await exchangeCodeForTokens(code, clientId);

        return NextResponse.redirect(
            new URL(`/client/${clientId}/settings/integrations?success=calendar`, request.url)
        );
    } catch (err) {
        console.error("[GOOGLE CALENDAR CALLBACK] Error:", err);
        return NextResponse.redirect(
            new URL(`/client/${clientId}/settings/integrations?error=failed`, request.url)
        );
    }
}
