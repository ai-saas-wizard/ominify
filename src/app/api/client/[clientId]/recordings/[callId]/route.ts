import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { canAccessClient } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getClientVapiKey } from "@/lib/client-secrets";
import { getCall } from "@/lib/vapi";

// GET /api/client/{clientId}/recordings/{callId}
//
// Call recordings live in VAPI's HIPAA storage (Cloudflare R2). The
// `recordingUrl` VAPI puts in the end-of-call webhook — and that we store on
// `calls.recording_url` — is a bare R2 object URL that R2 refuses without a
// signature ("InvalidArgument: Authorization"), so the Unibox player never
// had anything playable. VAPI does hand out presigned URLs
// (`artifact.presignedMonoUrl`), but they expire after 30 minutes, so they
// can't be stored either. This route fetches a fresh one at play time and
// redirects the <audio> element to it.
export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ clientId: string; callId: string }> },
) {
    const { clientId, callId } = await context.params;

    // Recordings are sensitive: require a signed-in user with access to
    // this client (same check the sequence actions use).
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await currentUser();
    const lookupKey = user?.emailAddresses[0]?.emailAddress || userId;
    if (!(await canAccessClient(lookupKey, clientId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only serve calls that belong to this client and actually have a recording.
    const { data: call } = await supabase
        .from("calls")
        .select("id, recording_url")
        .eq("client_id", clientId)
        .eq("vapi_call_id", callId)
        .maybeSingle();
    if (!call?.recording_url) {
        return NextResponse.json({ error: "No recording for this call" }, { status: 404 });
    }

    const apiKey = await getClientVapiKey(clientId);
    if (!apiKey) {
        return NextResponse.json({ error: "VAPI key not configured for this client" }, { status: 503 });
    }

    const vapiCall = await getCall(callId, apiKey);
    const artifact = vapiCall?.artifact;
    const playable =
        artifact?.presignedMonoUrl ||
        artifact?.presignedStereoUrl ||
        // Non-HIPAA orgs get a plain public URL back; only trust it if it
        // isn't the unsigned R2 form we already know is rejected.
        (vapiCall?.recordingUrl && !/r2\.cloudflarestorage\.com\/[^?]+$/.test(vapiCall.recordingUrl)
            ? vapiCall.recordingUrl
            : null);

    if (!playable) {
        return NextResponse.json({ error: "Recording is not available yet" }, { status: 404 });
    }

    // Presigned URLs are short-lived and per-request: never let a browser or
    // CDN cache the redirect.
    return NextResponse.redirect(playable, {
        status: 302,
        headers: { "Cache-Control": "private, no-store" },
    });
}
