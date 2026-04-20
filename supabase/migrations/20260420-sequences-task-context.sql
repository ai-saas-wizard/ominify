-- Add per-task context ("current offer", special instructions) to sequences.
-- Injected into the agent's system prompt at dispatch time as a business_context
-- section override so it survives in both blueprint and legacy dispatch paths.

ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS task_context TEXT;

COMMENT ON COLUMN sequences.task_context IS
  'Free-form operator instructions for this campaign (e.g., "Current offer: $500 referral bonus; walkthroughs Mon-Fri afternoons only"). Injected at dispatch as business_context prompt-section override.';
