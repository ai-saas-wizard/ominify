-- Pipeline / Lightweight CRM schema
-- Adds pipeline_stages table and pipeline columns on contacts

-- New table: pipeline_stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    position   INT  NOT NULL DEFAULT 0,
    is_default BOOLEAN DEFAULT false,
    is_terminal BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_client ON pipeline_stages(client_id, position);

-- New columns on contacts
ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pipeline_stage_moved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pipeline_stage_moved_by TEXT; -- 'auto' | 'user'

CREATE INDEX IF NOT EXISTS idx_contacts_pipeline_stage ON contacts(client_id, pipeline_stage_id);
