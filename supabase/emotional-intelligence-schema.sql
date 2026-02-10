-- ============================================
-- EMOTIONAL INTELLIGENCE LAYER (Phase 2)
-- Adds deep sentiment analysis, engagement scoring,
-- human intervention flags, and notification system
-- ============================================

-- ============================================
-- 1. New columns on contact_interactions
-- ============================================

-- Full emotional analysis result from GPT-4o (stored as JSONB)
ALTER TABLE contact_interactions ADD COLUMN IF NOT EXISTS emotional_analysis JSONB;

-- Engagement score at time of this interaction (0-100)
ALTER TABLE contact_interactions ADD COLUMN IF NOT EXISTS engagement_score INT;

-- ============================================
-- 2. New columns on sequence_enrollments
-- ============================================

-- Current engagement score (updated after each interaction)
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS engagement_score INT DEFAULT 50;

-- Sentiment trend across recent interactions
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS sentiment_trend TEXT DEFAULT 'stable'
    CHECK (sentiment_trend IN ('warming', 'stable', 'cooling', 'hot', 'cold'));

-- Flag: needs human intervention (set by EI layer)
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS needs_human_intervention BOOLEAN DEFAULT false;

-- Last detected primary emotion
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS last_emotion TEXT;

-- Accumulated objections detected across all interactions
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS objections_detected JSONB DEFAULT '[]';

-- Recommended tone for next outreach
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS recommended_tone TEXT DEFAULT 'professional'
    CHECK (recommended_tone IN ('empathetic', 'urgent', 'casual', 'professional', 'reassuring'));

-- Is this a hot lead? (buying signals detected)
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS is_hot_lead BOOLEAN DEFAULT false;

-- Is this contact at risk of disengaging?
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS is_at_risk BOOLEAN DEFAULT false;

-- ============================================
-- 3. New columns on contacts
-- ============================================

-- Global engagement score (across all enrollments)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_score INT DEFAULT 50;

-- Global sentiment trend
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sentiment_trend TEXT DEFAULT 'stable';

-- ============================================
-- 4. Tenant Notifications table
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

    -- Notification type
    type TEXT NOT NULL CHECK (type IN (
        'hot_lead',
        'needs_human',
        'objection_detected',
        'sentiment_drop',
        'appointment_booked',
        'sequence_completed',
        'escalation',
        'at_risk'
    )),

    -- Content
    title TEXT NOT NULL,
    body TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    -- Status
    read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    dismissed BOOLEAN DEFAULT false,

    -- Extra context
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

-- Unread notifications for a client (primary query)
CREATE INDEX IF NOT EXISTS idx_notifications_client_unread
    ON tenant_notifications(client_id, created_at DESC) WHERE read = false;

-- Notifications by contact
CREATE INDEX IF NOT EXISTS idx_notifications_contact
    ON tenant_notifications(contact_id, created_at DESC);

-- Notifications by enrollment
CREATE INDEX IF NOT EXISTS idx_notifications_enrollment
    ON tenant_notifications(enrollment_id, created_at DESC);

-- Priority-based queries
CREATE INDEX IF NOT EXISTS idx_notifications_priority
    ON tenant_notifications(client_id, priority, created_at DESC) WHERE read = false;

-- ============================================
-- Enrollment-level EI indexes
-- ============================================

-- Find hot leads
CREATE INDEX IF NOT EXISTS idx_enrollments_hot_leads
    ON sequence_enrollments(tenant_id) WHERE is_hot_lead = true AND status = 'active';

-- Find at-risk enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_at_risk
    ON sequence_enrollments(tenant_id) WHERE is_at_risk = true AND status = 'active';

-- Find enrollments needing human intervention
CREATE INDEX IF NOT EXISTS idx_enrollments_needs_human
    ON sequence_enrollments(tenant_id) WHERE needs_human_intervention = true AND status = 'active';

-- ============================================
-- RLS
-- ============================================

ALTER TABLE tenant_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_tenant_notifications" ON tenant_notifications FOR ALL TO service_role USING (true);
