-- ============================================
-- SELF-HEALING SEQUENCES (Phase 4)
-- Intelligent failure recovery: channel switching,
-- contact enrichment, progressive fallback
-- ============================================

-- ============================================
-- 1. New columns on sequence_enrollments
-- ============================================

-- Track healing actions taken for this enrollment
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS healing_actions_taken JSONB DEFAULT '[]';

-- Track which channels have consistently failed
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS failed_channels JSONB DEFAULT '[]';

-- Channel overrides: for this enrollment, route SMS steps to email, etc.
-- e.g., { "sms": "email" } means "send SMS steps as email instead"
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS channel_overrides JSONB DEFAULT '{}';

-- ============================================
-- 2. New columns on contacts
-- ============================================

-- Phone type detection (via Twilio Lookup API)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_type TEXT
    CHECK (phone_type IN ('mobile', 'landline', 'voip', 'unknown'));

-- Validity flags — set to false when hard bounces / invalid numbers detected
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_valid BOOLEAN DEFAULT true;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_valid BOOLEAN DEFAULT true;

-- Alternative contact methods (discovered via enrichment or user input)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alternative_email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alternative_phone TEXT;

-- ============================================
-- 3. Healing audit log table
-- ============================================

CREATE TABLE IF NOT EXISTS healing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE NOT NULL,
    step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- What failed
    failure_type TEXT NOT NULL CHECK (failure_type IN (
        'sms_undelivered', 'sms_failed', 'email_bounced', 'email_spam',
        'call_no_answer', 'call_busy', 'call_failed', 'capacity_exhausted',
        'invalid_number', 'landline_detected', 'invalid_email', 'no_contact_method'
    )),
    failure_details JSONB,

    -- What was done to heal
    healing_action TEXT NOT NULL CHECK (healing_action IN (
        'switch_channel', 'retry_alternative', 'skip_and_advance',
        'inject_fallback_sms', 'extend_delay', 'end_sequence',
        'mark_invalid', 'override_channel', 'use_alternative_contact'
    )),
    healing_details JSONB,        -- { new_channel: 'email', reason: 'Phone is landline' }

    -- Outcome
    healing_succeeded BOOLEAN DEFAULT null,  -- Updated later when outcome is known

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_healing_enrollment
    ON healing_log(enrollment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_healing_client
    ON healing_log(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_healing_failure_type
    ON healing_log(failure_type, created_at DESC);

-- Contact phone type for scheduler checks
CREATE INDEX IF NOT EXISTS idx_contacts_phone_type
    ON contacts(phone_type) WHERE phone_type = 'landline';

-- Contact validity flags
CREATE INDEX IF NOT EXISTS idx_contacts_email_valid
    ON contacts(email_valid) WHERE email_valid = false;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_valid
    ON contacts(phone_valid) WHERE phone_valid = false;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE healing_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_healing_log" ON healing_log FOR ALL TO service_role USING (true);
