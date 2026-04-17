-- ═══════════════════════════════════════════════════════════════════════════
-- Fix cross-tenant leak on active_calls
-- ═══════════════════════════════════════════════════════════════════════════
-- The previous policy was:
--     CREATE POLICY "Allow select for all" ON active_calls FOR SELECT USING (true);
-- This meant any holder of the Supabase anon key could SELECT every tenant's
-- live call rows — a cross-tenant data leak that becomes live the moment
-- NEXT_PUBLIC_SUPABASE_ANON_KEY is added to the client.
--
-- New policy: only return rows for clients whose IDs appear in the caller's
-- `client_ids` JWT claim. The claim is set by /api/supabase-token, which is
-- Clerk-authenticated and signs a short-lived JWT with the server-only
-- SUPABASE_JWT_SECRET.
--
-- Service-role access is unchanged (used by the server for webhook handlers
-- and admin reads).
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow select for all" ON active_calls;

CREATE POLICY "tenant_read_own_active_calls" ON active_calls
    FOR SELECT
    TO authenticated
    USING (
        client_id::text = ANY(
            string_to_array(
                coalesce(
                    (current_setting('request.jwt.claims', true)::jsonb ->> 'client_ids'),
                    ''
                ),
                ','
            )
        )
    );

-- Defense in depth: explicitly deny any anonymous SELECT.
-- (RLS already default-denies, but stating it makes intent unambiguous
-- and survives policy changes that might accidentally grant broader rights.)
REVOKE SELECT ON active_calls FROM anon;
