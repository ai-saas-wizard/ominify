-- Contacts CRM System
-- Run this to enable contact management with custom fields

-- Client custom field definitions
CREATE TABLE IF NOT EXISTS contact_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,           -- Display name e.g. "Company"
  field_key TEXT NOT NULL,      -- JSON key e.g. "company"
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'email', 'url', 'date', 'checkbox', 'address')),
  is_required BOOLEAN DEFAULT FALSE,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contacts (auto-created on inbound calls)
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  phone TEXT NOT NULL,                    -- Primary identifier
  name TEXT,
  email TEXT,
  custom_fields JSONB DEFAULT '{}',       -- Dynamic custom properties
  conversation_summary TEXT,              -- AI-updated rolling summary
  total_calls INT DEFAULT 0,
  last_call_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, phone)
);

-- Call history per contact
CREATE TABLE IF NOT EXISTS contact_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  vapi_call_id TEXT,
  summary TEXT,                          -- Per-call summary
  transcript TEXT,
  outcome TEXT,                          -- ended reason
  duration_seconds INT,
  called_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE contact_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_calls ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_client ON contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_client_phone ON contacts(client_id, phone);
CREATE INDEX IF NOT EXISTS idx_contact_calls_contact ON contact_calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_fields_client ON contact_fields(client_id);
