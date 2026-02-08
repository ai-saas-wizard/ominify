-- ═══════════════════════════════════════════════════════════════════
-- TYPE B (UMBRELLA) INFRASTRUCTURE SCHEMA
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. VAPI Umbrellas (Agency VAPI Accounts)
CREATE TABLE IF NOT EXISTS vapi_umbrellas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    umbrella_type VARCHAR(20) NOT NULL CHECK (umbrella_type IN ('shared', 'dedicated')),
    vapi_api_key_encrypted TEXT NOT NULL,
    vapi_org_id VARCHAR(100),
    concurrency_limit INTEGER DEFAULT 10 NOT NULL,
    current_concurrency INTEGER DEFAULT 0,
    max_tenants INTEGER,  -- NULL = unlimited for shared
    is_active BOOLEAN DEFAULT true,
    last_webhook_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vapi_umbrellas_org_id ON vapi_umbrellas(vapi_org_id);
CREATE INDEX idx_vapi_umbrellas_active ON vapi_umbrellas(is_active);

-- 2. Tenant VAPI Assignments (Client ↔ Umbrella mapping)
CREATE TABLE IF NOT EXISTS tenant_vapi_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by VARCHAR(100),
    tenant_concurrency_cap INTEGER,  -- Optional soft cap for this tenant
    priority_weight DECIMAL(3,2) DEFAULT 1.0,  -- For fair sharing
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id)  -- One active umbrella per tenant
);

CREATE INDEX idx_tenant_vapi_umbrella ON tenant_vapi_assignments(umbrella_id);
CREATE INDEX idx_tenant_vapi_active ON tenant_vapi_assignments(is_active);

-- 3. Umbrella Migration Audit Log
CREATE TABLE IF NOT EXISTS vapi_umbrella_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    from_umbrella_id UUID REFERENCES vapi_umbrellas(id),
    to_umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id),
    reason TEXT,
    migrated_by VARCHAR(100),
    migrated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tenant Profiles (Business Context for TYPE B)
CREATE TABLE IF NOT EXISTS tenant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
    
    -- Business Info
    industry VARCHAR(100),
    sub_industry VARCHAR(100),
    service_area JSONB,  -- { cities: [], zip_codes: [], radius_miles: 50 }
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    
    -- Job Types
    job_types JSONB DEFAULT '[]'::JSONB,  -- [{ name, urgency_tier, avg_ticket, keywords }]
    
    -- Brand Voice
    brand_voice VARCHAR(50) DEFAULT 'professional',  -- casual, professional, friendly
    custom_phrases JSONB,  -- { always_mention: [], never_say: [] }
    
    -- Business Hours
    business_hours JSONB,  -- { weekdays: { start, end }, saturday: {...}, emergency_24_7: false }
    
    -- Goals & Sources
    primary_goal TEXT,
    lead_sources JSONB,  -- [{ source: 'google_ads', urgency_multiplier: 1.5, connected: true }]
    
    -- AI Onboarding
    onboarding_transcript JSONB,  -- Raw transcript from 30-min onboarding
    onboarding_completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tenant Twilio Accounts
CREATE TABLE IF NOT EXISTS tenant_twilio_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('type_a_byoa', 'type_b_subaccount')),
    
    -- Type B: Subaccount under main
    subaccount_sid VARCHAR(50),
    auth_token_encrypted TEXT,
    
    -- Type A: External BYOA
    external_account_sid VARCHAR(50),
    
    messaging_service_sid VARCHAR(50),
    friendly_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tenant Phone Numbers
CREATE TABLE IF NOT EXISTS tenant_phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    phone_sid VARCHAR(50),
    capabilities JSONB,  -- { voice: true, sms: true, mms: false }
    purpose VARCHAR(20) DEFAULT 'sequencer' CHECK (purpose IN ('sequencer', 'vapi', 'general')),
    is_active BOOLEAN DEFAULT true,
    purchased_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_phone_numbers_tenant ON tenant_phone_numbers(tenant_id);
CREATE INDEX idx_phone_numbers_number ON tenant_phone_numbers(phone_number);

-- 7. A2P 10DLC Registration Tracking
CREATE TABLE IF NOT EXISTS tenant_a2p_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
    
    -- Brand Registration
    brand_sid VARCHAR(50),
    brand_status VARCHAR(30),  -- pending, approved, failed
    brand_failure_reason TEXT,
    brand_submitted_at TIMESTAMPTZ,
    brand_approved_at TIMESTAMPTZ,
    
    -- Campaign Registration
    campaign_sid VARCHAR(50),
    campaign_status VARCHAR(30),  -- pending, approved, failed
    campaign_failure_reason TEXT,
    campaign_use_case VARCHAR(50),
    campaign_submitted_at TIMESTAMPTZ,
    campaign_approved_at TIMESTAMPTZ,
    
    -- Retry tracking
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Sequences
CREATE TABLE IF NOT EXISTS sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Trigger Conditions
    trigger_conditions JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- { lead_source: ['google_ads'], job_type_keywords: ['emergency', 'water'], urgency_tier: 'critical' }
    
    urgency_tier VARCHAR(20) NOT NULL CHECK (urgency_tier IN ('critical', 'high', 'medium', 'low')),
    
    -- Sequence Settings
    max_attempts INTEGER DEFAULT 10,
    sequence_timeout_hours INTEGER DEFAULT 168,  -- 7 days
    respect_business_hours BOOLEAN DEFAULT true,
    
    -- AI Generation
    generated_by_ai BOOLEAN DEFAULT false,
    generation_prompt JSONB,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sequences_tenant ON sequences(tenant_id);
CREATE INDEX idx_sequences_active ON sequences(is_active);
CREATE INDEX idx_sequences_urgency ON sequences(urgency_tier);

-- 9. Sequence Steps
CREATE TABLE IF NOT EXISTS sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
    
    -- Timing
    delay_seconds INTEGER DEFAULT 0,
    delay_type VARCHAR(20) DEFAULT 'after_previous' CHECK (delay_type IN ('after_previous', 'after_enrollment', 'specific_time')),
    specific_time TIME,  -- For delay_type = 'specific_time'
    
    -- Content (depends on channel)
    content JSONB NOT NULL,
    -- SMS: { body: "..." }
    -- Email: { subject: "...", body_html: "...", body_text: "..." }
    -- Voice: { vapi_assistant_id, first_message, system_prompt, transfer_number }
    
    -- Branching Logic
    skip_conditions JSONB,  -- { skip_if: ['contact_replied', 'appointment_booked'], only_if: ['voicemail_left'] }
    on_success JSONB,  -- { action: 'continue' | 'jump_to_step' | 'end_sequence', target_step: 5 }
    on_failure JSONB,  -- { action: 'retry_after_seconds' | 'skip' | 'end_sequence', retry_delay: 300 }
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(sequence_id, step_order)
);

CREATE INDEX idx_steps_sequence ON sequence_steps(sequence_id);

-- 10. Sequence Enrollments
CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'replied', 'booked', 'failed', 'manual_stop')),
    
    current_step_order INTEGER DEFAULT 0,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    next_step_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Metrics
    total_attempts INTEGER DEFAULT 0,
    calls_made INTEGER DEFAULT 0,
    sms_sent INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    
    -- Outcome flags
    contact_replied BOOLEAN DEFAULT false,
    contact_answered_call BOOLEAN DEFAULT false,
    appointment_booked BOOLEAN DEFAULT false,
    
    -- Context
    enrollment_source VARCHAR(50),  -- google_ads, facebook, csv_upload, manual
    custom_variables JSONB DEFAULT '{}'::JSONB,  -- Template variables from lead data
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(sequence_id, contact_id)  -- Prevent double enrollment
);

-- CRITICAL: Index for scheduler polling
CREATE INDEX idx_sequence_enrollments_next_action 
    ON sequence_enrollments(status, next_step_at) 
    WHERE status = 'active';

CREATE INDEX idx_enrollments_tenant ON sequence_enrollments(tenant_id);
CREATE INDEX idx_enrollments_contact ON sequence_enrollments(contact_id);

-- 11. Sequence Execution Log
CREATE TABLE IF NOT EXISTS sequence_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
    step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,
    
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
    action VARCHAR(50) NOT NULL,  -- sent, delivered, failed, skipped, call_initiated, call_answered, etc.
    
    -- Provider details
    provider_id VARCHAR(100),  -- SMS SID, Call ID, Email MessageId
    provider_response JSONB,
    
    -- Channel-specific metrics
    call_duration_seconds INTEGER,
    call_transcript TEXT,
    sms_status VARCHAR(30),
    email_status VARCHAR(30),
    call_status VARCHAR(30),
    
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_execution_log_enrollment ON sequence_execution_log(enrollment_id);
CREATE INDEX idx_execution_log_time ON sequence_execution_log(executed_at);
CREATE INDEX idx_execution_log_provider ON sequence_execution_log(provider_id);

-- ═══════════════════════════════════════════════════════════════════
-- RLS POLICIES (Optional - enable as needed)
-- ═══════════════════════════════════════════════════════════════════

-- Enable RLS on tables
-- ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sequence_execution_log ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

-- Increment SMS count atomically
CREATE OR REPLACE FUNCTION increment_enrollment_sms(enrollment_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE sequence_enrollments 
    SET sms_sent = sms_sent + 1, updated_at = NOW()
    WHERE id = enrollment_id;
END;
$$ LANGUAGE plpgsql;

-- Increment calls count atomically
CREATE OR REPLACE FUNCTION increment_enrollment_calls(enrollment_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE sequence_enrollments 
    SET calls_made = calls_made + 1, updated_at = NOW()
    WHERE id = enrollment_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY SETUP
-- ═══════════════════════════════════════════════════════════════════

-- Check all tables were created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'vapi_umbrellas',
    'tenant_vapi_assignments',
    'vapi_umbrella_migrations',
    'tenant_profiles',
    'tenant_twilio_accounts',
    'tenant_phone_numbers',
    'tenant_a2p_registrations',
    'sequences',
    'sequence_steps',
    'sequence_enrollments',
    'sequence_execution_log'
);
