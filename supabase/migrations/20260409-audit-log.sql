-- ═══════════════════════════════════════════════════════════════════════════
-- Audit log — record every sensitive write for incident response & compliance
-- ═══════════════════════════════════════════════════════════════════════════
-- Entries are inserted by src/lib/audit.ts from server actions. Rows must
-- never contain the actual secret values — only the fact that a key or
-- setting changed, plus the actor and target. Queries against this table
-- only run server-side via the service role, so no client-facing policy
-- is required.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id TEXT NOT NULL,         -- Clerk user ID of the person performing the action
    actor_email TEXT,                    -- Snapshot of the actor's email at action time
    action TEXT NOT NULL,                -- e.g. 'update_umbrella_key', 'create_client', 'deploy_agent'
    target_type TEXT,                    -- 'umbrella' | 'client' | 'agent' | 'sequence' | ...
    target_id TEXT,                      -- UUID of the target row, or external identifier
    metadata JSONB DEFAULT '{}'::jsonb,  -- Non-secret details (e.g. { changedFields: ['vapi_key'] })
    ip_address TEXT,                     -- X-Forwarded-For first hop
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
    ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_time
    ON audit_log(action, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write. Clients never touch this table directly.
DROP POLICY IF EXISTS "service_role_all_audit_log" ON audit_log;
CREATE POLICY "service_role_all_audit_log" ON audit_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Explicitly deny any authenticated or anon access.
REVOKE ALL ON audit_log FROM anon, authenticated;
