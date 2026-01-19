-- Migration script for existing calls table
-- Adds missing columns needed for full call tracking

-- Add missing columns
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'inboundPhoneCall';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS structured_data JSONB DEFAULT '{}';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_calls_client_id ON calls(client_id);
CREATE INDEX IF NOT EXISTS idx_calls_agent_id ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_call_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_customer_number ON calls(customer_number);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_ended_reason ON calls(ended_reason);

-- Composite index for client + date range queries (common in analytics)
CREATE INDEX IF NOT EXISTS idx_calls_client_started ON calls(client_id, started_at DESC);
