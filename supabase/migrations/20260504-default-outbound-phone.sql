-- Add a tenant-level default outbound caller ID.
--
-- The sequencer's outbound dispatch (sequencer/src/workers/scheduler-worker.ts)
-- resolves the phoneNumberId in this order:
--   1. tenant_profiles.default_outbound_phone_id (this column)
--   2. agent's per-agent phone (tenant_phone_numbers.agent_id, legacy)
--   3. tenant's first active phone (last-resort fallback)
--
-- This column lets the operator pick ONE phone as the default outbound caller
-- ID for the whole account, configured via /client/[clientId]/settings/outbound-caller-id.

ALTER TABLE tenant_profiles
    ADD COLUMN IF NOT EXISTS default_outbound_phone_id UUID
    REFERENCES tenant_phone_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_profiles_default_outbound
    ON tenant_profiles(default_outbound_phone_id)
    WHERE default_outbound_phone_id IS NOT NULL;
