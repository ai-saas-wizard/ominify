import { NextResponse } from "next/server";
import { getMetaAuthorizationUrl } from "@/lib/meta-ads";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) {
        return NextResponse.json(
            { error: "clientId is required" },
            { status: 400 }
        );
    }
    try {
        return NextResponse.redirect(getMetaAuthorizationUrl(clientId));
    } catch (err) {
        console.error("[META ADS AUTHORIZE] Failed to build URL:", err);
        return NextResponse.redirect(
            new URL(
                `/client/${clientId}/settings/integrations?error=meta_ads_failed`,
                request.url
            )
        );
    }
}
