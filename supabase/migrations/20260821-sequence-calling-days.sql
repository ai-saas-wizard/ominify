-- 2026-08-21: Per-sequence calling DAYS (companion to daily_call_cap +
-- calling_window_* from 20260821-daily-cap-calling-window.sql).
--
-- sequences.calling_days holds the days of week voice dialing is allowed,
-- as 'sun'..'sat' keys evaluated in the TENANT's timezone. NULL = every day
-- (existing behavior). Enforced for voice steps in the scheduler gate and
-- re-checked at dial time in the VAPI worker; deferrals jump straight to the
-- window opening on the next allowed day.
--
-- Idempotent — safe to re-run.

ALTER TABLE sequences
    ADD COLUMN IF NOT EXISTS calling_days TEXT[];

COMMENT ON COLUMN sequences.calling_days IS
    'Days of week this sequence may place voice calls (''sun''..''sat'', tenant timezone). NULL = every day. Never an empty array — that would mean "no days", which the app rejects.';

ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_calling_days_valid;
ALTER TABLE sequences ADD CONSTRAINT sequences_calling_days_valid
    CHECK (
        calling_days IS NULL
        OR (
            array_length(calling_days, 1) >= 1
            AND calling_days <@ ARRAY['sun','mon','tue','wed','thu','fri','sat']
        )
    );
