-- Recording-layer column drift fix (2026-07-22)
--
-- The sequencer's post-send recording writes two columns that were never added
-- to the production schema (they exist only in the TypeScript types + insert
-- code):
--   * recordInteraction  (sequencer/src/lib/conversation-memory.ts)  writes `metadata`
--   * logExecution        (sequencer/src/workers/scheduler-worker.ts,
--                          sequencer/src/workers/vapi-worker.ts)       writes `call_status`
--
-- Both inserts fail with PostgREST PGRST204 ("Could not find the 'X' column …")
-- and the error is swallowed (console.error, no throw). Effect confirmed in prod:
--   * `contact_interactions` was NEVER populated → cross-channel memory
--     (`{{conversation_history}}`, which reads `contact_interactions`) has no data.
--   * voice / blocked execution-log rows (which set `call_status`) never persisted
--     → the observability "journey" view is blank for those actions.
--
-- Missing columns confirmed via live column probe 2026-07-22
-- (`sms_status`, `variant_id`, `emotional_analysis`, etc. already exist).
-- Idempotent — safe to re-run.

ALTER TABLE contact_interactions
    ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE sequence_execution_log
    ADD COLUMN IF NOT EXISTS call_status TEXT;
