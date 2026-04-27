-- ═══════════════════════════════════════════════════════════
-- META ADS (Facebook & Instagram Lead Ads) INTEGRATION
--
-- OAuth via Facebook Login → list user's Pages → user picks N pages
-- → subscribe each Page's `leadgen` field. A single shared webhook URL
-- (configured once in Meta App dashboard) receives every leadgen event;
-- routes happen by entry[].id (page_id) → tenant_meta_ads_pages.
-- ═══════════════════════════════════════════════════════════

-- Per-tenant Meta connection: holds user-level identity + OAuth tokens.
CREATE TABLE IF NOT EXISTS tenant_meta_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    fb_user_id TEXT,
    fb_user_name TEXT,
    fb_user_email TEXT,

    user_access_token_encrypted TEXT,
    user_token_expires_at TIMESTAMPTZ,

    is_active BOOLEAN DEFAULT true,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

-- One row per Page subscribed by a tenant. page_id is globally unique
-- across Meta — the webhook handler looks up by page_id to find the tenant.
CREATE TABLE IF NOT EXISTS tenant_meta_ads_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    page_id TEXT NOT NULL,
    page_name TEXT,
    page_access_token_encrypted TEXT,

    subscription_active BOOLEAN DEFAULT false,
    last_lead_at TIMESTAMPTZ,
    last_webhook_at TIMESTAMPTZ,

    subscribed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id, page_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_meta_ads_pages_page_id
    ON tenant_meta_ads_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_tenant_meta_ads_pages_client
    ON tenant_meta_ads_pages(client_id);

ALTER TABLE tenant_meta_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_meta_ads_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_tenant_meta_ads"
    ON tenant_meta_ads FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_meta_ads_pages"
    ON tenant_meta_ads_pages FOR ALL TO service_role USING (true);

-- Idempotency: each Meta leadgen_id produces at most one enrollment per tenant,
-- even if Meta retries the webhook (which it does aggressively for ~36h).
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_leadgen_unique_per_tenant
    ON sequence_enrollments (
        tenant_id,
        ((enrollment_data->>'meta_leadgen_id'))
    )
    WHERE enrollment_data->>'meta_leadgen_id' IS NOT NULL;
