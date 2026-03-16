-- Phone Number ↔ Agent Assignment
-- Links a phone number to an agent for inbound routing + outbound caller ID

ALTER TABLE tenant_phone_numbers
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- Fast lookup: find the phone number for a given agent
CREATE INDEX IF NOT EXISTS idx_tenant_phones_agent
  ON tenant_phone_numbers(agent_id) WHERE agent_id IS NOT NULL;

-- One number per agent constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_phones_agent_unique
  ON tenant_phone_numbers(agent_id) WHERE agent_id IS NOT NULL;
