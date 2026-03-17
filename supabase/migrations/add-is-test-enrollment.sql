-- Add is_test flag to sequence_enrollments for "Test on Myself" mode
-- Test enrollments get compressed delays (30s) and are excluded from analytics

ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;

-- Index for analytics exclusion queries
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_is_test
    ON sequence_enrollments(is_test) WHERE is_test = true;
