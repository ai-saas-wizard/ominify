import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/lib/google-calendar";

/**
 * Initiates Google Calendar OAuth flow.
 * Redirects the user to Google's consent screen.
 *
 * GET /api/integrations/google-calendar/authorize?clientId=xxx
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
        return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const authUrl = getAuthorizationUrl(clientId);
    return NextResponse.redirect(authUrl);
}
