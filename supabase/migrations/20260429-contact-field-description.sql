-- Add a human-friendly description to custom contact fields.
-- This description is fed to outbound voice agents at call time as part of
-- the {{contact_field_legend}} variable, so the agent understands what each
-- key in {{contact_data}} means.

ALTER TABLE contact_fields
    ADD COLUMN IF NOT EXISTS description TEXT;
