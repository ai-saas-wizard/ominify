-- Migration: Add handoff_rules support for Goal-First Wizard sequences
-- The handoff_rules are stored inside the existing metadata JSONB column on sequences.
-- This migration adds a dedicated handoff_rules JSONB column for direct query access
-- and creates an index for efficient querying of sequences with handoff rules.

-- Add handoff_rules JSONB column to sequences table
ALTER TABLE sequences
ADD COLUMN IF NOT EXISTS handoff_rules JSONB DEFAULT NULL;

-- Comment documenting the expected shape
COMMENT ON COLUMN sequences.handoff_rules IS '
JSON structure for owner-defined handoff rules (Goal-First Wizard):
{
  "success_conditions": ["appointment_booked", "interest_expressed", "pricing_requested", "next_steps_agreed"],
  "handoff_triggers": [
    { "type": "preset", "id": "in_person_estimate", "label": "..." },
    { "type": "custom", "label": "If they ask about financing options" }
  ],
  "no_response": {
    "max_touchpoints": 6,
    "after_sequence": "mark_cold" | "reengage_weeks" | "notify_personal",
    "reengage_weeks": 2
  },
  "notification": {
    "sms": "+15551234567",
    "email": "owner@business.com",
    "push": true,
    "urgent_call": false
  }
}
';

-- Index for finding sequences that have handoff rules configured
CREATE INDEX IF NOT EXISTS idx_sequences_handoff_rules
ON sequences USING gin (handoff_rules)
WHERE handoff_rules IS NOT NULL;

-- Index for wizard-created sequences
CREATE INDEX IF NOT EXISTS idx_sequences_wizard_created
ON sequences USING btree ((metadata->>'wizard_created'))
WHERE metadata->>'wizard_created' = 'true';
