-- Add pricing columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS price_per_minute numeric(10,4);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS cost_per_minute numeric(10,4);
