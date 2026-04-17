"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════
// Browser-side Supabase client for RLS-scoped realtime reads.
// ═══════════════════════════════════════════════════════════
// This file is explicitly client-only. The service role key must NEVER be
// imported here. We use the anon key + a short-lived signed JWT obtained
// from /api/supabase-token, which contains the user's accessible client_ids
// claim. Supabase RLS policies check that claim before returning rows.
//
// Without a valid JWT the anon key still hits RLS — so an attacker who
// inspects the bundle, steals the anon key, and tries to query `active_calls`
// gets zero rows back.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface TokenResponse {
    token: string;
    expiresAt: number;
    clientIds: string[];
}

/**
 * Fetch a freshly signed Supabase JWT for the current Clerk session.
 * Returns null if the user isn't signed in or the server isn't configured.
 */
export async function fetchSupabaseToken(): Promise<TokenResponse | null> {
    try {
        const res = await fetch("/api/supabase-token", { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as TokenResponse;
    } catch {
        return null;
    }
}

/**
 * Build a Supabase client authenticated with the provided access token.
 * The token is injected as an Authorization header on every request —
 * including realtime WebSocket frames — so RLS policies see the user's
 * `client_ids` claim.
 */
export function createAuthedSupabase(accessToken: string): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        realtime: {
            params: {
                apikey: SUPABASE_ANON_KEY,
                access_token: accessToken,
            },
        },
    });
}
