-- Create active_calls table for real-time tracking
CREATE TABLE IF NOT EXISTS active_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  vapi_call_id TEXT UNIQUE NOT NULL,
  assistant_id TEXT,
  customer_number TEXT,
  status TEXT, -- 'ringing', 'in-progress', 'forwarding', 'ended'
  started_at TIMESTAMP WITH TIME ZONE,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- Track last heartbeat/update
  transcript TEXT DEFAULT '', -- Live transcript from speech updates
  summary TEXT,    -- Live summary from conversation updates
  cost REAL DEFAULT 0,
  type TEXT DEFAULT 'inbound' -- 'inbound' or 'outbound'
);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE active_calls;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_active_calls_vapi_call_id ON active_calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_active_calls_client_id ON active_calls(client_id);
