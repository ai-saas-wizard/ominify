-- Persist the umbrella-scoped VAPI Structured Output ID for RE Investor calls.
-- Created once via VAPI's /structured-output API and referenced by every
-- UMBRELLA RE assistant's payload via `artifactPlan.structuredOutputIds`,
-- so we no longer inline the analysisPlan.structuredDataSchema on every
-- assistant.
--
-- NULL until the bootstrap runs. To force a recreate (e.g. after a schema
-- bump), set this column back to NULL and the next ensure call will POST
-- a fresh one.
ALTER TABLE vapi_umbrellas
  ADD COLUMN IF NOT EXISTS re_structured_output_id TEXT;
