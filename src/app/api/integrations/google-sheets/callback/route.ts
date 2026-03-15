import { NextResponse } from "next/server";
import {
    exchangeSheetsCodeForTokens,
    createLeadSheet,
} from "@/lib/google-sheets";

/**
 * Google Sheets OAuth callback.
 * Exchanges the authorization code for tokens, stores them,
 * and auto-creates a lead spreadsheet with column headers.
 *
 * GET /api/integrations/google-sheets/callback?code=xxx&state=clientId
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const clientId = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
        const redirectUrl = clientId
            ? `/client/${clientId}/settings/integrations?error=sheets_denied`
            : "/?error=sheets_denied";
        return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    if (!code || !clientId) {
        return NextResponse.json(
            { error: "Missing authorization code or client ID" },
            { status: 400 }
        );
    }

    try {
        // 1. Exchange code for tokens and save to DB
        await exchangeSheetsCodeForTokens(code, clientId);

        // 2. Auto-create lead spreadsheet with headers
        const sheet = await createLeadSheet(clientId);
        if (!sheet) {
            console.error(
                "[GOOGLE SHEETS CALLBACK] Sheet creation failed for:",
                clientId
            );
        }

        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?success=sheets`,
                request.url
            )
        );
    } catch (err) {
        console.error("[GOOGLE SHEETS CALLBACK] Error:", err);
        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?error=sheets_failed`,
                request.url
            )
        );
    }
}
