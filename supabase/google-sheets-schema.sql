-- ═══════════════════════════════════════════════════════════
-- GOOGLE SHEETS INTEGRATION
-- Stores OAuth tokens and spreadsheet config for auto-logging
-- call data from VAPI structured outputs.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_google_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    google_access_token_encrypted TEXT,
    google_refresh_token_encrypted TEXT,
    google_sheet_id TEXT,
    google_sheet_url TEXT,
    token_expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
