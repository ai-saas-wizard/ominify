-- Agent Blueprint: stores full VAPI agent config in our DB
-- so the sequencer can build inline/transient agents at dispatch time
-- without calling VAPI's GET assistant API.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_blueprint JSONB;

-- Index for efficient lookup by sequencer (joins on agent id already fast,
-- but this helps if we ever query blueprints directly)
CREATE INDEX IF NOT EXISTS idx_agents_blueprint_not_null
  ON agents (id) WHERE agent_blueprint IS NOT NULL;

COMMENT ON COLUMN agents.agent_blueprint IS 'Full VAPI agent config (voice, model, prompt sections, tools, settings) used by sequencer to build inline transient agents at call dispatch time. Source of truth for what the agent sounds and behaves like.';
