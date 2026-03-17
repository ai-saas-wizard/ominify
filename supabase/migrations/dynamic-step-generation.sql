-- ═══════════════════════════════════════════════════════════════════
-- Dynamic (JIT) Step Generation Migration
-- Adds support for reactive sequencing: generate one step at a time,
-- wait for the outcome, then decide the next move.
-- ═══════════════════════════════════════════════════════════════════

-- Sequence-level: dynamic mode + strategy
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'static';
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS sequence_strategy JSONB DEFAULT NULL;

-- Enrollment-level: track outcome waiting
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS outcome_timeout_at TIMESTAMPTZ DEFAULT NULL;

-- Step-level: mark JIT-generated steps
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS generated_dynamically BOOLEAN NOT NULL DEFAULT false;

-- Index for the timeout polling query in scheduler-worker
CREATE INDEX IF NOT EXISTS idx_enrollments_awaiting_outcome
    ON sequence_enrollments (status, outcome_timeout_at)
    WHERE status = 'awaiting_outcome';
