-- ═══════════════════════════════════════════════════════════
-- AUTO-AGENTS & GOOGLE CALENDAR SCHEMA
-- Auto-create VAPI assistants on onboarding completion
-- ═══════════════════════════════════════════════════════════

-- ─── EXTEND AGENTS TABLE ───

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type TEXT DEFAULT 'custom'
    CHECK (agent_type IN ('inbound', 'outbound', 'custom'));

ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS template_version TEXT;

-- ─── GOOGLE CALENDAR INTEGRATION ───

CREATE TABLE IF NOT EXISTS tenant_google_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- OAuth tokens
    google_access_token_encrypted TEXT,
    google_refresh_token_encrypted TEXT,
    google_calendar_id TEXT DEFAULT 'primary',
    token_expires_at TIMESTAMPTZ,

    -- Booking defaults
    default_duration_minutes INT DEFAULT 60,
    buffer_minutes INT DEFAULT 15,
    booking_window_days INT DEFAULT 14,

    is_active BOOLEAN DEFAULT true,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

-- RLS
ALTER TABLE tenant_google_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_tenant_google_calendar"
    ON tenant_google_calendar FOR ALL TO service_role USING (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_tenant_google_calendar_client
    ON tenant_google_calendar(client_id);
