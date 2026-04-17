import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import crypto from "crypto";
import { getAccessibleClients } from "@/lib/auth";

/**
 * Mint a short-lived Supabase access JWT scoped to the signed-in user's
 * accessible client IDs.
 *
 * Why this exists:
 *   The app uses Clerk for authentication, not Supabase Auth. Supabase RLS
 *   policies can only inspect claims signed with Supabase's JWT secret, so
 *   the server bridges by issuing a custom HS256 JWT with a `client_ids`
 *   claim that the RLS policy on `active_calls` matches against.
 *
 * Security notes:
 *   - Token lives 30 minutes; the client must re-fetch to refresh.
 *   - `SUPABASE_JWT_SECRET` is server-only, sourced from Supabase dashboard
 *     → Settings → API → JWT Secret.
 *   - The browser sends the token as `Authorization: Bearer <token>` on
 *     every Supabase request. Without it, the anon role hits RLS and gets
 *     zero rows back from `active_calls`.
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

function base64url(input: Buffer | string): string {
    const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
    return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwtHS256(payload: Record<string, unknown>, secret: string): string {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const data = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createHmac("sha256", secret).update(data).digest();
    return `${data}.${base64url(signature)}`;
}

export async function GET() {
    if (!SUPABASE_JWT_SECRET) {
        return NextResponse.json(
            { error: "SUPABASE_JWT_SECRET not configured on server" },
            { status: 500 }
        );
    }

    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    const userEmail = user?.emailAddresses[0]?.emailAddress;

    // Resolve the union of accessible clients by Clerk user ID AND email.
    // getAccessibleClients takes either identifier; we call both so any
    // access route (email invite, direct clerk_id, admin) is covered.
    const seen = new Map<string, { id: string; name: string; email: string }>();
    const clientsById = await getAccessibleClients(userId);
    clientsById.forEach((c) => seen.set(c.id, c));
    if (userEmail) {
        const clientsByEmail = await getAccessibleClients(userEmail);
        clientsByEmail.forEach((c) => seen.set(c.id, c));
    }
    const clientIds = Array.from(seen.keys());

    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 30 * 60; // 30 minutes
    const payload = {
        aud: "authenticated",
        role: "authenticated",
        sub: userId,
        email: userEmail || undefined,
        client_ids: clientIds.join(","),
        iat: now,
        exp: now + ttlSeconds,
    };

    const token = signJwtHS256(payload, SUPABASE_JWT_SECRET);

    return NextResponse.json({
        token,
        expiresAt: (now + ttlSeconds) * 1000,
        clientIds,
    });
}
