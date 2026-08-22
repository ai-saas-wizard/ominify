-- Per-sequence outbound number rotation ("Rotate numbers") (2026-08-23)
--
-- One campaign dialing/texting hundreds of leads from a single number gets that
-- number spam-flagged. These columns let an operator spread a sequence's voice
-- calls AND SMS across a hand-picked pool of the tenant's numbers:
--
--   * sequences.rotate_phone_numbers        — the toggle. false = today's behavior
--                                             (voice: tenant default → agent number →
--                                             any VAPI number; SMS: Messaging Service /
--                                             'sequencer' number).
--   * sequences.rotation_phone_number_ids   — tenant_phone_numbers.id[] in rotation
--                                             order. Read only when the toggle is on.
--                                             No FK (array column): released numbers
--                                             are hard-deleted, so the sequencer
--                                             filters to rows that still exist, are
--                                             active and VAPI-synced at dispatch; the
--                                             settings card prunes them on save.
--   * sequence_enrollments.outbound_phone_id — the number this lead is stuck to.
--                                             Picked round-robin on the first outbound
--                                             touch (sequencer lib/outbound-phone.ts),
--                                             reused for every later call + text.
--                                             ON DELETE SET NULL: a released number
--                                             re-picks on the next touch.
--
-- Enforced in sequencer/src/lib/outbound-phone.ts (scheduler voice dispatch,
-- vapi-worker dial-time fallback, sms-worker). Idempotent — safe to re-run.

ALTER TABLE sequences
    ADD COLUMN IF NOT EXISTS rotate_phone_numbers BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rotation_phone_number_ids UUID[];

COMMENT ON COLUMN sequences.rotate_phone_numbers IS
    'Spread this sequence''s outbound calls and texts across rotation_phone_number_ids, sticky per enrollment. false = legacy single-number resolution.';

COMMENT ON COLUMN sequences.rotation_phone_number_ids IS
    'tenant_phone_numbers.id[] to rotate across, in rotation order. Read only when rotate_phone_numbers is true; kept when the toggle is off so it can be switched back on. Entries may reference released numbers — filtered at dispatch.';

-- Toggle ON with nothing to rotate across would silently mean "legacy" while the
-- UI reads "rotating": require a non-empty pool when on. A stored pool while
-- OFF is fine. coalesce() matters: array_length() is NULL for both NULL and
-- '{}', and a NULL CHECK passes — without it the constraint would never fire.
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_rotation_pool_valid;
ALTER TABLE sequences ADD CONSTRAINT sequences_rotation_pool_valid
    CHECK (
        rotate_phone_numbers = false
        OR coalesce(array_length(rotation_phone_number_ids, 1), 0) >= 1
    );

ALTER TABLE sequence_enrollments
    ADD COLUMN IF NOT EXISTS outbound_phone_id UUID
        REFERENCES tenant_phone_numbers(id) ON DELETE SET NULL;

COMMENT ON COLUMN sequence_enrollments.outbound_phone_id IS
    'Sticky outbound number when the sequence rotates numbers: set on the first outbound touch, reused for every later call/SMS. NULL = not yet picked (or the number was released). Ignored while rotate_phone_numbers is false.';

-- Postgres does not index FK columns; without this every number release
-- (ON DELETE SET NULL) scans sequence_enrollments. Partial: only picked rows.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_outbound_phone
    ON sequence_enrollments(outbound_phone_id) WHERE outbound_phone_id IS NOT NULL;
