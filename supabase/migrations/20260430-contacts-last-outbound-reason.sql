-- Track the most recent outbound call reason on each contact so the inbound
-- agent can reference it when the contact calls back within a recent window.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_outbound_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_call_id TEXT;

CREATE INDEX IF NOT EXISTS contacts_last_outbound_at_idx
  ON contacts (client_id, last_outbound_at DESC)
  WHERE last_outbound_at IS NOT NULL;
