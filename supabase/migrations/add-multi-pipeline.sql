-- Multi-Pipeline Support Migration
-- Adds pipelines, pipeline_contacts, stage rules, assignment rules, API keys,
-- contact history, and cross-pipeline automations

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. PIPELINES table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipelines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT NOT NULL DEFAULT '#059669',
    is_default  BOOLEAN DEFAULT false,
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_client ON pipelines(client_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_default ON pipelines(client_id) WHERE is_default = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Add pipeline_id to pipeline_stages
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE pipeline_stages
    ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PIPELINE_CONTACTS junction table (contact ↔ pipeline, each with own stage)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    stage_id    UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    moved_at    TIMESTAMPTZ DEFAULT now(),
    moved_by    TEXT DEFAULT 'auto',  -- 'auto' | 'user'
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(pipeline_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_contacts_pipeline_stage ON pipeline_contacts(pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_contacts_contact ON pipeline_contacts(contact_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. PIPELINE_STAGE_RULES — per-stage sequence enrollment triggers
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_stage_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id    UUID REFERENCES pipeline_stages(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    conditions  JSONB DEFAULT '{}',
    priority    INT DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_rules_stage ON pipeline_stage_rules(stage_id, priority DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. PIPELINE_ASSIGNMENT_RULES — auto-route contacts to pipelines
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_assignment_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    conditions  JSONB DEFAULT '{}',
    priority    INT DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_rules_pipeline ON pipeline_assignment_rules(pipeline_id, priority DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. CLIENT_API_KEYS — for Lead Creation API authentication
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    key_hash    TEXT NOT NULL,
    key_prefix  TEXT NOT NULL,
    name        TEXT,
    is_active   BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_client ON client_api_keys(client_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON client_api_keys(key_hash) WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. PIPELINE_CONTACT_HISTORY — track stage transitions for analytics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_contact_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_contact_id UUID REFERENCES pipeline_contacts(id) ON DELETE CASCADE NOT NULL,
    from_stage_id       UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    to_stage_id         UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL NOT NULL,
    moved_by            TEXT DEFAULT 'auto',
    moved_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_history_pc ON pipeline_contact_history(pipeline_contact_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_history_stage ON pipeline_contact_history(to_stage_id, moved_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. PIPELINE_AUTOMATIONS — cross-pipeline automation triggers
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_automations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    trigger_pipeline_id  UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    trigger_stage_id     UUID REFERENCES pipeline_stages(id) ON DELETE CASCADE NOT NULL,
    target_pipeline_id   UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    target_stage_id      UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    is_active            BOOLEAN DEFAULT true,
    created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_trigger ON pipeline_automations(trigger_stage_id) WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. DATA MIGRATION — move existing single-pipeline data into multi-pipeline
-- ═══════════════════════════════════════════════════════════════════════════════

-- 9a. Create a default pipeline for each client that already has pipeline_stages
INSERT INTO pipelines (client_id, name, color, is_default, position)
SELECT DISTINCT ps.client_id, 'Sales Pipeline', '#059669', true, 0
FROM pipeline_stages ps
WHERE NOT EXISTS (
    SELECT 1 FROM pipelines p WHERE p.client_id = ps.client_id
);

-- 9b. Link existing pipeline_stages to their client's default pipeline
UPDATE pipeline_stages ps
SET pipeline_id = p.id
FROM pipelines p
WHERE p.client_id = ps.client_id
  AND p.is_default = true
  AND ps.pipeline_id IS NULL;

-- 9c. Backfill pipeline_contacts from contacts.pipeline_stage_id
INSERT INTO pipeline_contacts (pipeline_id, contact_id, stage_id, moved_at, moved_by)
SELECT
    p.id,
    c.id,
    c.pipeline_stage_id,
    COALESCE(c.pipeline_stage_moved_at, now()),
    COALESCE(c.pipeline_stage_moved_by, 'auto')
FROM contacts c
JOIN pipeline_stages ps ON ps.id = c.pipeline_stage_id
JOIN pipelines p ON p.id = ps.pipeline_id
WHERE c.pipeline_stage_id IS NOT NULL
ON CONFLICT (pipeline_id, contact_id) DO NOTHING;

-- 9d. Also insert contacts WITHOUT a stage into their client's default pipeline
INSERT INTO pipeline_contacts (pipeline_id, contact_id, stage_id, moved_at, moved_by)
SELECT
    p.id,
    c.id,
    (SELECT ps2.id FROM pipeline_stages ps2 WHERE ps2.pipeline_id = p.id AND ps2.is_default = true LIMIT 1),
    now(),
    'auto'
FROM contacts c
JOIN pipelines p ON p.client_id = c.client_id AND p.is_default = true
WHERE c.pipeline_stage_id IS NULL
  AND EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = p.id)
ON CONFLICT (pipeline_id, contact_id) DO NOTHING;

-- 9e. Make pipeline_id NOT NULL after backfill
ALTER TABLE pipeline_stages ALTER COLUMN pipeline_id SET NOT NULL;

-- 9f. Add index on pipeline_stages(pipeline_id, position)
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id, position);
