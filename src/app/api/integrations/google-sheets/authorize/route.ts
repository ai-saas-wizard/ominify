import { NextResponse } from "next/server";
import { getSheetsAuthorizationUrl } from "@/lib/google-sheets";

/**
 * Initiates Google Sheets OAuth flow.
 * Redirects the user to Google's consent screen.
 *
 * GET /api/integrations/google-sheets/authorize?clientId=xxx
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
        return NextResponse.json(
            { error: "clientId is required" },
            { status: 400 }
        );
    }

    const authUrl = getSheetsAuthorizationUrl(clientId);
    return NextResponse.redirect(authUrl);
}
