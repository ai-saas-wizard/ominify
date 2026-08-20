-- Per-sequence dial pacing: daily call cap + calling window (2026-08-21)
--
-- Enrolling ~2,000 leads at once used to mean the scheduler dialed every one of
-- them as fast as VAPI concurrency allowed. These three columns let an operator
-- say "at most 150 calls a day, only between 10:00 and 16:00" per sequence:
--
--   * daily_call_cap        — enforced in scheduler-worker.ts via a Redis
--                             counter keyed by sequence + tenant-tz calendar
--                             day. NULL = uncapped (existing behavior).
--   * calling_window_start  — tenant-timezone time-of-day bounds, INTERSECTED
--   * calling_window_end      with (not replacing) the tenant business-hours
--                             and the TCPA 8am-9pm gates. NULL = no
--                             per-sequence window (existing behavior).
--
-- Voice steps only; SMS/email pacing stays governed by pacing_per_minute.
-- Idempotent — safe to re-run.

ALTER TABLE sequences
    ADD COLUMN IF NOT EXISTS daily_call_cap INT,
    ADD COLUMN IF NOT EXISTS calling_window_start TIME,
    ADD COLUMN IF NOT EXISTS calling_window_end TIME;

COMMENT ON COLUMN sequences.daily_call_cap IS
    'Max outbound voice calls this sequence may place per calendar day (tenant timezone). NULL = uncapped. Reserved atomically in Redis at dispatch; over-cap enrollments defer to the next day''s window.';

COMMENT ON COLUMN sequences.calling_window_start IS
    'Earliest time-of-day (tenant timezone) this sequence may place voice calls. NULL = no per-sequence window. Intersected with tenant business hours and the TCPA 8am-9pm window, never replacing them.';

COMMENT ON COLUMN sequences.calling_window_end IS
    'Latest time-of-day (tenant timezone) this sequence may place voice calls. NULL = no per-sequence window. Must be later than calling_window_start.';

-- Guard rails (idempotent via drop-first). daily_call_cap = 0 would read as
-- falsy in the scheduler gate and mean UNCAPPED — the exact inverse of the
-- "pause dialing" an operator writing 0 via SQL intends. Force NULL or >= 1.
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_daily_call_cap_positive;
ALTER TABLE sequences ADD CONSTRAINT sequences_daily_call_cap_positive
    CHECK (daily_call_cap IS NULL OR daily_call_cap >= 1);

ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_calling_window_valid;
ALTER TABLE sequences ADD CONSTRAINT sequences_calling_window_valid
    CHECK (
        (calling_window_start IS NULL AND calling_window_end IS NULL)
        OR (calling_window_start IS NOT NULL AND calling_window_end IS NOT NULL
            AND calling_window_start < calling_window_end)
    );
