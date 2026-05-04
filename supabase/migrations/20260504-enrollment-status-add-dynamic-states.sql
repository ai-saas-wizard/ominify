-- Allow dynamic-mode statuses on sequence_enrollments.
--
-- The sequencer's dynamic-step flow (scheduler-worker.ts:786, 121) writes
-- status='awaiting_outcome' after a step dispatches and 'generating_next_step'
-- while the LLM is producing the next step. Both are present in the
-- TypeScript type EnrollmentStatus but were missing from the DB CHECK
-- constraint, so every dynamic update silently failed the constraint —
-- status stayed 'active', and the scheduler re-dispatched the same
-- enrollment every 5s tick (observed live: 148 failed jobs accumulated
-- from a single test enrollment).

ALTER TABLE sequence_enrollments
    DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;

ALTER TABLE sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_status_check
    CHECK (status IN (
        'active',
        'paused',
        'completed',
        'replied',
        'booked',
        'failed',
        'manual_stop',
        'unenrolled',
        'converted',
        'awaiting_outcome',
        'generating_next_step'
    ));
