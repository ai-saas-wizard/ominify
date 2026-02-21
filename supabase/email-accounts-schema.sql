-- ============================================
-- TENANT EMAIL ACCOUNTS
-- Per-tenant email/SMTP configuration for the sequencer
-- Mirrors tenant_twilio_accounts pattern
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- Provider type
    provider TEXT NOT NULL DEFAULT 'smtp'
        CHECK (provider IN ('smtp', 'gmail')),

    -- Display / From fields
    from_email TEXT NOT NULL,              -- e.g. 'info@mybusiness.com'
    from_name TEXT,                        -- e.g. 'ACME Plumbing'

    -- SMTP credentials (encrypted with AES-256-GCM)
    smtp_host TEXT,                        -- e.g. 'smtp.gmail.com', 'smtp.office365.com'
    smtp_port INT DEFAULT 587,
    smtp_user TEXT,
    smtp_pass_encrypted TEXT,              -- encrypted via sequencer encryption module
    smtp_secure BOOLEAN DEFAULT false,     -- true = port 465 (SSL), false = port 587 (STARTTLS)

    -- Gmail OAuth (encrypted) — for future Gmail API integration
    gmail_access_token_encrypted TEXT,
    gmail_refresh_token_encrypted TEXT,

    -- Reply-to (optional, defaults to from_email)
    reply_to_email TEXT,

    -- Status & verification
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,     -- set true after successful test send
    last_verified_at TIMESTAMPTZ,
    verification_error TEXT,               -- last error from test send

    -- Rate limiting
    daily_send_limit INT DEFAULT 500,      -- per-tenant daily cap
    sends_today INT DEFAULT 0,
    last_send_reset_at TIMESTAMPTZ DEFAULT now(),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)                      -- one email config per tenant
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_email_client ON tenant_email_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_tenant_email_active ON tenant_email_accounts(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE tenant_email_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_tenant_email_accounts" ON tenant_email_accounts FOR ALL TO service_role USING (true);
