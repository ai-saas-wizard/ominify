-- ============================================
-- CONTACT INTERACTIONS (Cross-Channel Memory)
-- Unified interaction timeline for all channels
-- ============================================

CREATE TABLE IF NOT EXISTS contact_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,

    -- Channel & direction
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
    direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),

    -- Content
    content_body TEXT,              -- SMS body, email text, or call transcript
    content_subject TEXT,           -- Email subject line
    content_summary TEXT,           -- AI-generated 1-2 sentence summary

    -- Outcome
    outcome TEXT,                   -- 'delivered', 'replied', 'answered', 'voicemail', 'no_answer', 'bounced', 'opened', 'clicked', 'failed'
    sentiment TEXT,                 -- 'positive', 'negative', 'neutral', 'objection', 'interested', 'confused'
    intent TEXT,                    -- 'interested', 'not_interested', 'stop', 'reschedule', 'question', 'unknown'

    -- Voice-specific
    call_duration_seconds INT,
    call_disposition TEXT,          -- 'answered', 'voicemail', 'no_answer', 'busy', 'failed'
    appointment_booked BOOLEAN DEFAULT false,
    objections_raised JSONB,        -- ["price_concern", "timing", "competitor_mentioned"]
    key_topics JSONB,               -- ["emergency_repair", "pricing", "scheduling"]

    -- Metadata
    provider_id TEXT,               -- Twilio SID, VAPI call ID, email message ID
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

-- Primary lookup: all interactions for a contact in time order
CREATE INDEX idx_interactions_contact_time ON contact_interactions(contact_id, created_at DESC);

-- Enrollment-scoped timeline
CREATE INDEX idx_interactions_enrollment ON contact_interactions(enrollment_id, created_at DESC);

-- Channel-specific queries
CREATE INDEX idx_interactions_channel ON contact_interactions(contact_id, channel, created_at DESC);

-- Client-level queries
CREATE INDEX idx_interactions_client ON contact_interactions(client_id, created_at DESC);

-- Provider ID lookup (for updating interactions from webhooks)
CREATE INDEX idx_interactions_provider ON contact_interactions(provider_id) WHERE provider_id IS NOT NULL;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_contact_interactions" ON contact_interactions FOR ALL TO service_role USING (true);
