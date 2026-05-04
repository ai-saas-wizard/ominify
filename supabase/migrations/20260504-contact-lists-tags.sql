-- Contact Lists + Tags
-- Adds:
--   1) contact_lists / contact_list_members  - static segments built from CSV imports
--      or ad-hoc multi-select. Membership is explicit. source_row preserves the original
--      CSV row so re-enrolling a list yields identical custom_variables without re-upload.
--   2) contact_tags / contact_tag_assignments - per-tenant tag taxonomy + many-to-many.
--   3) sequence_enrollments.source_list_id   - lineage stamp for "ran against this list".

-- 1) Lists ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'csv' CHECK (source IN ('csv', 'manual')),
    source_filename TEXT,
    column_mapping JSONB,
    contact_count INT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_lists_client_name_active
    ON contact_lists(client_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_lists_client
    ON contact_lists(client_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS contact_list_members (
    list_id UUID REFERENCES contact_lists(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    source_row JSONB,
    added_via TEXT DEFAULT 'csv' CHECK (added_via IN ('csv', 'manual', 'api')),
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_clm_list ON contact_list_members(list_id);
CREATE INDEX IF NOT EXISTS idx_clm_contact ON contact_list_members(contact_id);

-- 2) Tags ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_tags_client_name
    ON contact_tags(client_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_contact_tags_client ON contact_tags(client_id);

CREATE TABLE IF NOT EXISTS contact_tag_assignments (
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES contact_tags(id) ON DELETE CASCADE NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_cta_tag ON contact_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_cta_contact ON contact_tag_assignments(contact_id);

-- 3) Lineage on enrollments ---------------------------------------------------

ALTER TABLE sequence_enrollments
    ADD COLUMN IF NOT EXISTS source_list_id UUID REFERENCES contact_lists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_source_list
    ON sequence_enrollments(source_list_id) WHERE source_list_id IS NOT NULL;

-- 4) RLS ----------------------------------------------------------------------

ALTER TABLE contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tag_assignments ENABLE ROW LEVEL SECURITY;
