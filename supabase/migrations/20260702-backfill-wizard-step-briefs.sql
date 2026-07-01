-- Backfill step_brief for wizard-created sequence steps
--
-- createSequenceFromWizard used to store literal "[AI-generated at dispatch]"
-- placeholder content WITHOUT writing step_brief, so the scheduler's
-- intent-guided generation path never fired and the placeholder was sent to
-- leads verbatim as their first touch. The wizard now persists step_brief at
-- creation time; this migration repairs the rows created before that fix
-- (two ACTIVE production sequences as of 2026-07-02).
--
-- intent/cta are recovered from the wizard's deterministic
-- mutation_instructions format:
--   "Goal: <intent>. CTA: <cta>. Generate fresh content at dispatch time
--    using real conversation context."
-- JIT-generated dynamic steps are naturally excluded — they never contain
-- the placeholder marker. Until this runs, the scheduler's placeholder guard
-- (7c) withholds these sends instead of dispatching the marker.
--
-- NOTE: no auto-apply pipeline exists for this directory — run manually
-- against prod at deploy time.

UPDATE sequence_steps
SET step_brief = jsonb_build_object(
    -- NULLIF: substring() returns '' (not NULL) when the capture group
    -- matches zero characters (wizard rows built from a simulation entry
    -- with no intent produce "Goal: . CTA: ..."), so bare COALESCE would
    -- never reach the fallbacks.
    'intent',      COALESCE(
                       NULLIF(substring(mutation_instructions FROM '^Goal: (.*)\. CTA: '), ''),
                       NULLIF(mutation_instructions, ''),
                       'Follow up with the lead'
                   ),
    'key_points',  '[]'::jsonb,
    'cta',         COALESCE(
                       substring(mutation_instructions FROM '\. CTA: (.*)\. Generate fresh content'),
                       ''
                   ),
    'constraints', '[]'::jsonb
)
WHERE step_brief IS NULL
  AND content::text LIKE '%[AI-generated at dispatch]%';
