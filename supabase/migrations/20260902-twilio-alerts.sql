-- Twilio balance / failure alerts.
--
-- Context (2026-09-01 incident): a tenant's Twilio balance hit $0. SMS failed
-- "Authenticate" for 5 hours and a VAPI start error leaked a concurrency slot
-- that silently stopped all outbound calls — and nobody was notified. The
-- sequencer now (a) polls BYOA tenants' Twilio balance every 30 min and
-- (b) raises in-app notifications on low balance, auth failures, and calls
-- failing to start. See sequencer/src/lib/twilio-balance.ts.
--
-- RUN BY HAND on the prod database (standard procedure for this repo).

-- 1) New notification types. The CHECK constraint was created inline in
--    emotional-intelligence-schema.sql, so its auto-generated name is
--    tenant_notifications_type_check.
ALTER TABLE tenant_notifications DROP CONSTRAINT IF EXISTS tenant_notifications_type_check;
ALTER TABLE tenant_notifications ADD CONSTRAINT tenant_notifications_type_check CHECK (type IN (
    'hot_lead',
    'needs_human',
    'objection_detected',
    'sentiment_drop',
    'appointment_booked',
    'sequence_completed',
    'escalation',
    'at_risk',
    'twilio_low_balance',
    'twilio_auth_failed',
    'calls_failing'
));

-- 2) Balance bookkeeping on the tenant's Twilio account row.
ALTER TABLE tenant_twilio_accounts
    ADD COLUMN IF NOT EXISTS last_balance NUMERIC,
    ADD COLUMN IF NOT EXISTS last_balance_currency TEXT,
    ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ,
    -- Level the tenant was last notified at ('warn' | 'critical'); NULL once
    -- the balance recovers so the next dip alerts again.
    ADD COLUMN IF NOT EXISTS low_balance_level TEXT
        CHECK (low_balance_level IS NULL OR low_balance_level IN ('warn', 'critical')),
    ADD COLUMN IF NOT EXISTS last_auth_error_at TIMESTAMPTZ;
