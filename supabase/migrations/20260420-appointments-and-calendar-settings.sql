-- ═══════════════════════════════════════════════════════════
-- APPOINTMENTS + TENANT-CONFIGURABLE CALENDAR SETTINGS
-- Adds appointments persistence, configurable business hours,
-- and a per-tenant minimum booking lead-time.
-- ═══════════════════════════════════════════════════════════

-- ─── APPOINTMENTS TABLE ───

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    vapi_call_id TEXT,
    google_event_id TEXT,
    customer_name TEXT NOT NULL,
    customer_phone_e164 TEXT NOT NULL,
    customer_email TEXT,
    service_type TEXT,
    notes TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 60,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked','cancelled','rescheduled','failed','no_show')),
    error_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_client_phone
    ON appointments(client_id, customer_phone_e164);
CREATE INDEX IF NOT EXISTS idx_appointments_client_scheduled
    ON appointments(client_id, scheduled_at);

-- RLS — service_role only (matches tenant_google_calendar policy style).
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_appointments"
    ON appointments FOR ALL TO service_role USING (true);

-- ─── EXTEND tenant_google_calendar ───

ALTER TABLE tenant_google_calendar
    ADD COLUMN IF NOT EXISTS min_lead_minutes INT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS business_hours_json JSONB NOT NULL DEFAULT
        '{"mon":{"start":"09:00","end":"17:00"},"tue":{"start":"09:00","end":"17:00"},"wed":{"start":"09:00","end":"17:00"},"thu":{"start":"09:00","end":"17:00"},"fri":{"start":"09:00","end":"17:00"}}'::jsonb;
