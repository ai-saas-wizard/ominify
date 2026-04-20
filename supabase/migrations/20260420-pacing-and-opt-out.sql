-- Phase 2 — Pacing + persistent opt-out / DNC

-- 2.3 Pacing: spread bulk-enrolled calls across time so the scheduler
-- doesn't fire N calls simultaneously. NULL = no pacing (immediate).
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS pacing_per_minute INT;

COMMENT ON COLUMN sequences.pacing_per_minute IS
  'Max outbound actions per minute. Bulk enrollment spreads next_step_at accordingly. NULL = no pacing (immediate dispatch).';

-- 2.4 Persistent opt-out / do-not-contact. Today the event-processor only
-- flips the current enrollment to manual_stop, which means the same contact
-- can be re-contacted in a new sequence. This fixes that at the contact level.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_channel TEXT;

COMMENT ON COLUMN contacts.opted_out_at IS
  'When this contact opted out globally (STOP reply, unsubscribe link, manual). NULL = still contactable. NON-NULL = skip all outbound across all sequences.';

CREATE INDEX IF NOT EXISTS idx_contacts_opted_out_at
  ON contacts(opted_out_at)
  WHERE opted_out_at IS NOT NULL;
