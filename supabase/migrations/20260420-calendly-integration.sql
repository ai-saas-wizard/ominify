-- ═══════════════════════════════════════════════════════════
-- CALENDLY INTEGRATION
-- PAT-based auth (no OAuth). Mirrors tenant_google_calendar shape
-- so the VAPI dispatch layer can treat both providers uniformly.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_calendly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- Auth: Personal Access Token, encrypted at rest.
    calendly_pat_encrypted TEXT NOT NULL,

    -- Identity resolved from GET /users/me at connect time.
    calendly_user_uri TEXT,
    calendly_organization_uri TEXT,
    calendly_user_email TEXT,
    calendly_user_name TEXT,

    -- Event Type selection (client picks one in settings).
    selected_event_type_uri TEXT,
    selected_event_type_name TEXT,
    selected_event_type_duration INT,
    selected_event_type_scheduling_url TEXT,

    -- Webhook subscription — created on connect, deleted on disconnect.
    webhook_subscription_uri TEXT,
    webhook_signing_key_encrypted TEXT,

    -- How far out we scan availability. Calendly's own endpoint caps
    -- each query at 7 days; we iterate if booking_window_days is larger.
    booking_window_days INT DEFAULT 14,

    is_active BOOLEAN DEFAULT true,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

ALTER TABLE tenant_calendly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_tenant_calendly"
    ON tenant_calendly FOR ALL TO service_role USING (true);

CREATE INDEX IF NOT EXISTS idx_tenant_calendly_client
    ON tenant_calendly(client_id);

-- Webhook lookups — we only trust signed payloads matching one of our rows.
CREATE INDEX IF NOT EXISTS idx_tenant_calendly_user_uri
    ON tenant_calendly(calendly_user_uri)
    WHERE calendly_user_uri IS NOT NULL;

-- ─── EXTEND appointments TABLE ───
-- Provider-agnostic columns so both Google and Calendly events
-- can persist alongside each other.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS calendar_provider TEXT DEFAULT 'google'
        CHECK (calendar_provider IN ('google','calendly')),
    ADD COLUMN IF NOT EXISTS calendly_event_uri TEXT,
    ADD COLUMN IF NOT EXISTS calendly_invitee_uri TEXT;

-- Webhook dedup: don't double-insert when invitee.created fires
-- for an event we just created via POST /invitees.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_calendly_invitee_uri
    ON appointments(calendly_invitee_uri)
    WHERE calendly_invitee_uri IS NOT NULL;
