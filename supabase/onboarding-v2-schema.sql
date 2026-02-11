-- ═══════════════════════════════════════════════════════════
-- ONBOARDING V2: AI Agent Fleet Builder
-- Adds columns for multi-agent onboarding, agent catalog
-- type tracking, and assistant override variables.
-- All ALTER statements are backward-compatible (IF NOT EXISTS + defaults).
-- ═══════════════════════════════════════════════════════════

-- ─── AGENTS TABLE ───
-- agent_type_id: maps to the agent catalog (e.g. 'inbound_receptionist', 'lead_follow_up')
-- agent_config: full agent configuration snapshot from onboarding
-- override_variables: list of variable names that can be injected at call time via assistantOverrides

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type_id TEXT;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_config JSONB DEFAULT '{}';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS override_variables TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_agents_type_id ON agents(agent_type_id);

-- ─── SEQUENCES TABLE ───
-- agent_id: links a sequence to the agent it was auto-created for
-- auto_created: flag to distinguish AI-generated sequences from manually created ones

ALTER TABLE sequences ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

ALTER TABLE sequences ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;

-- Adaptive mutation settings for auto-created sequences
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS enable_adaptive_mutation BOOLEAN DEFAULT false;

ALTER TABLE sequences ADD COLUMN IF NOT EXISTS mutation_aggressiveness TEXT DEFAULT 'moderate'
    CHECK (mutation_aggressiveness IN ('conservative', 'moderate', 'aggressive'));

CREATE INDEX IF NOT EXISTS idx_sequences_agent ON sequences(agent_id) WHERE agent_id IS NOT NULL;

-- ─── TENANT PROFILES TABLE ───
-- onboarding_version: 'v1' or 'v2' to track which flow was used
-- ai_agent_suggestions: snapshot of AI-suggested agents from analysis
-- onboarding_chat_history: chat messages from the agent customization phase

ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS onboarding_version TEXT DEFAULT 'v1';

ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS ai_agent_suggestions JSONB;

ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS onboarding_chat_history JSONB;
