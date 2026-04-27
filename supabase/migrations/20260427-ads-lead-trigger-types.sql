-- ═══════════════════════════════════════════════════════════
-- Extend sequences.trigger_type to support ad-platform leads.
-- Adds: 'meta_ads_lead', 'google_ads_lead'
-- ═══════════════════════════════════════════════════════════

ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_trigger_type_check;

ALTER TABLE sequences ADD CONSTRAINT sequences_trigger_type_check
    CHECK (trigger_type IN (
        'new_lead',
        'missed_call',
        'form_submission',
        'manual',
        'tag_added',
        'status_change',
        'schedule',
        'meta_ads_lead',
        'google_ads_lead'
    ));
