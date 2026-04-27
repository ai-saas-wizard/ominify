-- ═══════════════════════════════════════════════════════════
-- GOOGLE ADS (Lead Form Asset webhook) INTEGRATION
--
-- MVP architecture: tenant clicks "Generate webhook URL" in our
-- settings; we mint a per-tenant URL + HMAC-style signing key.
-- Tenant pastes both into each Google Ads Lead Form Asset's
-- "Webhook integration" delivery option. Google Ads sends a JSON
-- POST with a `google_key` field; we constant-time compare against
-- the stored key. No OAuth, no Google Ads Developer Token, no
-- changes to the existing Google Cloud project.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_google_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- The HMAC signing secret we generated for this tenant. The plaintext
    -- is shown to the user once at generation; afterwards "Show key" pulls
    -- it from this encrypted column for display.
    webhook_signing_key_encrypted TEXT NOT NULL,

    is_active BOOLEAN DEFAULT true,
    last_lead_at TIMESTAMPTZ,
    last_webhook_at TIMESTAMPTZ,

    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

ALTER TABLE tenant_google_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_tenant_google_ads"
    ON tenant_google_ads FOR ALL TO service_role USING (true);

CREATE INDEX IF NOT EXISTS idx_tenant_google_ads_client
    ON tenant_google_ads(client_id);

-- Idempotency: each Google Ads lead delivery should produce at most one
-- enrollment per tenant, even if Google Ads retries a webhook.
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_ads_lead_unique_per_tenant
    ON sequence_enrollments (
        tenant_id,
        ((enrollment_data->>'google_lead_id'))
    )
    WHERE enrollment_data->>'google_lead_id' IS NOT NULL;
