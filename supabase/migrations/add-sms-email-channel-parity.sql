-- SMS & Email Channel Parity Migration
-- Adds step_brief for intent-guided generation and email_reply_mode for email responder

-- 1. Add step_brief column to sequence_steps
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS step_brief JSONB;
COMMENT ON COLUMN sequence_steps.step_brief IS 'Intent-guided generation brief: { intent, key_points[], cta, constraints[], channel_hints }';

-- 2. Add email_reply_mode to tenant_email_accounts
ALTER TABLE tenant_email_accounts ADD COLUMN IF NOT EXISTS email_reply_mode TEXT DEFAULT 'notify_only';
COMMENT ON COLUMN tenant_email_accounts.email_reply_mode IS 'Email reply behavior: auto (full chatbot), draft (generate + review), notify_only (default)';

-- 3. Add index for email reply mode lookups
CREATE INDEX IF NOT EXISTS idx_tenant_email_accounts_reply_mode ON tenant_email_accounts (client_id) WHERE email_reply_mode != 'notify_only';
