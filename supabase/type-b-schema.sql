-- ============================================
-- OMINIFY TYPE B (Umbrella) Schema
-- Run this after all existing schema files
-- ============================================

-- ============================================
-- 1. VAPI UMBRELLA MANAGEMENT
-- ============================================

-- VAPI umbrella accounts managed by the agency
CREATE TABLE IF NOT EXISTS vapi_umbrellas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    umbrella_type TEXT NOT NULL DEFAULT 'shared'
        CHECK (umbrella_type IN ('shared', 'dedicated')),

    -- VAPI account credentials
    vapi_api_key_encrypted TEXT NOT NULL,
    vapi_org_id TEXT,

    -- Concurrency limits (from VAPI account)
    concurrency_limit INT NOT NULL DEFAULT 10,
    current_concurrency INT DEFAULT 0,

    -- Capacity planning
    max_tenants INT,                     -- NULL = unlimited

    -- Health
    is_active BOOLEAN DEFAULT true,
    last_webhook_at TIMESTAMPTZ,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tenant (TYPE B client) ↔ Umbrella mapping
CREATE TABLE IF NOT EXISTS tenant_vapi_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id) ON DELETE RESTRICT,

    -- Assignment metadata
    assigned_at TIMESTAMPTZ DEFAULT now(),
    assigned_by TEXT,

    -- Per-tenant soft limits WITHIN the umbrella
    tenant_concurrency_cap INT,
    priority_weight NUMERIC(3,1) DEFAULT 1.0,

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)  -- A tenant can only be in ONE umbrella at a time
);

-- Migration history (audit trail for umbrella moves)
CREATE TABLE IF NOT EXISTS vapi_umbrella_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    from_umbrella_id UUID REFERENCES vapi_umbrellas(id),
    to_umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id),
    reason TEXT,
    migrated_by TEXT,
    migrated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. TENANT PROFILES (Business Context)
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE UNIQUE NOT NULL,

    -- Business context
    industry TEXT,                        -- 'home_services', 'real_estate', etc.
    sub_industry TEXT,                    -- 'hvac', 'plumbing', 'roofing'
    business_description TEXT,
    website TEXT,
    service_area JSONB,                   -- {cities: [], zip_codes: [], radius_miles: 25}
    timezone TEXT DEFAULT 'America/New_York',

    -- Job types & urgency tiers
    job_types JSONB DEFAULT '[]',         -- [{name, urgency_tier, avg_ticket, keywords}]

    -- Communication DNA
    brand_voice TEXT DEFAULT 'professional',  -- 'casual', 'professional', 'friendly'
    custom_phrases JSONB,                 -- {always_mention: ["family-owned"], never_say: ["cheap"]}
    greeting_style TEXT,
    business_hours JSONB DEFAULT '{}',    -- {mon: {open: "08:00", close: "17:00"}, ...}
    after_hours_behavior TEXT DEFAULT 'voicemail',
    emergency_phone TEXT,

    -- Sequence goals
    primary_goal TEXT,                    -- 'book_appointment', 'phone_qualification', 'direct_schedule'

    -- Lead source configs
    lead_sources JSONB DEFAULT '[]',      -- [{source: "google_ads", urgency_multiplier: 1.5}]
    qualification_criteria JSONB DEFAULT '{}',

    -- External CRM integration
    external_crm TEXT,                    -- 'jobber', 'servicetitan', 'housecall_pro'
    crm_webhook_url TEXT,

    -- A2P 10DLC business info (for registration)
    legal_business_name TEXT,
    ein_tax_id TEXT,
    business_address JSONB,              -- {street, city, state, zip, country}
    business_type TEXT,                  -- 'LLC', 'Corporation', 'Sole Proprietor'

    -- AI generation metadata
    onboarding_transcript JSONB,
    onboarding_completed BOOLEAN DEFAULT false,
    onboarding_completed_at TIMESTAMPTZ,
    onboarding_notes TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. TWILIO INFRASTRUCTURE
-- ============================================

-- Twilio subaccount per TYPE B tenant
CREATE TABLE IF NOT EXISTS tenant_twilio_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    account_type TEXT NOT NULL DEFAULT 'type_b_subaccount'
        CHECK (account_type IN ('type_a_byoa', 'type_b_subaccount')),

    -- For TYPE B: subaccount under OMINIFY's main
    subaccount_sid TEXT,
    auth_token_encrypted TEXT,

    -- For TYPE A: customer's own account (reference only)
    external_account_sid TEXT,

    -- Provisioned resources
    messaging_service_sid TEXT,

    friendly_name TEXT,
    status TEXT CHECK (status IN ('active', 'suspended', 'closed')) DEFAULT 'active',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

-- Phone numbers per tenant
CREATE TABLE IF NOT EXISTS tenant_phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    twilio_account_id UUID REFERENCES tenant_twilio_accounts(id),

    phone_number TEXT NOT NULL,           -- E.164 format
    phone_number_sid TEXT,                -- PN...
    friendly_name TEXT,

    capabilities JSONB DEFAULT '{"sms": true, "voice": true, "mms": false}',
    purpose TEXT DEFAULT 'sequencer',     -- 'sequencer', 'inbound', 'dedicated'
    is_primary BOOLEAN DEFAULT false,

    -- Vapi integration
    vapi_phone_number_id TEXT,            -- If registered with Vapi

    status TEXT CHECK (status IN ('active', 'released', 'pending')) DEFAULT 'active',

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(phone_number)
);

-- A2P 10DLC registration tracking
CREATE TABLE IF NOT EXISTS tenant_a2p_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- Brand (business entity)
    customer_profile_sid TEXT,            -- BU...
    brand_sid TEXT,                       -- BN...
    brand_status TEXT DEFAULT 'pending'
        CHECK (brand_status IN ('pending', 'approved', 'failed', 'in_review', 'suspended')),
    brand_score INT,                      -- TCR trust score (1-100)
    brand_approved_at TIMESTAMPTZ,

    -- Campaign (use case)
    campaign_sid TEXT,                    -- QE...
    campaign_status TEXT DEFAULT 'awaiting_brand'
        CHECK (campaign_status IN ('awaiting_brand', 'pending_approval', 'approved', 'failed', 'expired', 'suspended')),
    campaign_use_case TEXT DEFAULT 'mixed',
    campaign_approved_at TIMESTAMPTZ,

    -- Throughput
    messages_per_second NUMERIC(5,2) DEFAULT 1,

    -- Compliance metrics
    last_compliance_check TIMESTAMPTZ,
    spam_complaint_rate NUMERIC(5,4),

    -- Metadata
    rejection_reason TEXT,
    registration_data JSONB,              -- Business info snapshot (what was submitted)

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id)
);

-- ============================================
-- 4. SEQUENCE ENGINE
-- ============================================

-- Sequences (AI-generated from onboarding, editable by tenant)
CREATE TABLE IF NOT EXISTS sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    name TEXT NOT NULL,                   -- "Google Ads - Emergency Lead"
    description TEXT,

    -- Trigger conditions
    trigger_type TEXT CHECK (trigger_type IN (
        'new_lead', 'missed_call', 'form_submission',
        'manual', 'tag_added', 'status_change', 'schedule'
    )) NOT NULL DEFAULT 'manual',
    trigger_conditions JSONB DEFAULT '{}',
    -- {
    --   lead_source: ["google_ads"],
    --   job_type_keywords: ["emergency","repair"],
    --   urgency_tier: "critical",
    --   custom_field_matches: {}
    -- }

    urgency_tier TEXT DEFAULT 'medium'
        CHECK (urgency_tier IN ('critical', 'high', 'medium', 'low')),

    -- Sequence configuration
    max_attempts INT DEFAULT 8,
    sequence_timeout_hours INT DEFAULT 168,  -- 7 days default
    respect_business_hours BOOLEAN DEFAULT true,

    -- AI metadata
    ai_generated BOOLEAN DEFAULT false,
    ai_generation_prompt JSONB,

    is_active BOOLEAN DEFAULT false,
    priority INT DEFAULT 5,
    max_enrollments INT,                  -- NULL = unlimited

    -- Stats (denormalized for performance)
    total_enrolled INT DEFAULT 0,
    total_completed INT DEFAULT 0,
    total_converted INT DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sequence steps (the individual actions in order)
CREATE TABLE IF NOT EXISTS sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,

    step_order INT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice', 'wait', 'condition', 'webhook', 'notify_team')),

    -- Timing
    delay_minutes INT DEFAULT 0,
    delay_type TEXT DEFAULT 'fixed_delay'
        CHECK (delay_type IN ('immediate', 'fixed_delay', 'business_hours_only', 'specific_time', 'after_previous')),
    specific_time TIME,                   -- if delay_type = 'specific_time'

    -- Content templates (with {{variable}} placeholders)
    content JSONB NOT NULL DEFAULT '{}',
    -- SMS:   {body: "Hey {{first_name}}, ..."}
    -- Email: {subject: "...", body_html: "...", body_text: "..."}
    -- Voice: {vapi_assistant_id: "...", first_message: "...", system_prompt: "...", transfer_number: "..."}

    subject_template TEXT,                -- Email subject (convenience field)
    voice_agent_id UUID REFERENCES agents(id),
    voice_context TEXT,                   -- Additional context for AI voice call

    -- Conditions (skip this step if...)
    skip_conditions JSONB,
    -- {
    --   skip_if: ["contact_replied", "contact_answered_call", "appointment_booked"],
    --   only_if: ["voicemail_left"],
    --   time_window: {not_before: "08:00", not_after: "21:00"}
    -- }

    -- Branching
    on_success JSONB,                     -- {action: "continue" | "jump_to_step" | "end_sequence", target_step: 5}
    on_failure JSONB,                     -- {action: "retry_after_seconds" | "skip" | "end_sequence", retry_delay: 300}
    condition_type TEXT,                  -- "response_received", "call_answered", "time_elapsed"
    condition_value JSONB,

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(sequence_id, step_order)
);

-- Contact enrollment in sequences
CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,

    -- State machine
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'replied', 'booked', 'failed', 'manual_stop', 'unenrolled', 'converted')),

    current_step_order INT DEFAULT 0,

    -- Execution tracking
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    next_step_at TIMESTAMPTZ,             -- when the next step should fire
    completed_at TIMESTAMPTZ,
    completed_reason TEXT,

    -- Outcome tracking
    total_attempts INT DEFAULT 0,
    calls_made INT DEFAULT 0,
    sms_sent INT DEFAULT 0,
    emails_sent INT DEFAULT 0,

    -- Contact responded?
    contact_replied BOOLEAN DEFAULT false,
    contact_answered_call BOOLEAN DEFAULT false,
    appointment_booked BOOLEAN DEFAULT false,

    -- Metadata
    enrollment_source TEXT,               -- 'google_ads', 'facebook', 'webhook', 'csv_upload', 'manual', 'auto_trigger', 'api'
    enrollment_data JSONB DEFAULT '{}',
    custom_variables JSONB,               -- per-contact overrides

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(sequence_id, contact_id)       -- prevent double-enrollment
);

-- Execution log (every action taken)
CREATE TABLE IF NOT EXISTS sequence_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE NOT NULL,
    step_id UUID REFERENCES sequence_steps(id),

    channel TEXT NOT NULL,
    action TEXT NOT NULL,                  -- 'sent', 'delivered', 'failed', 'skipped', 'call_completed'
    status TEXT CHECK (status IN (
        'pending', 'executing', 'completed', 'failed', 'skipped'
    )) DEFAULT 'pending',

    -- Channel-specific results
    provider_id TEXT,                     -- Twilio SID, VAPI call ID, email message ID
    provider_response JSONB,
    result_data JSONB DEFAULT '{}',

    -- Voice-specific
    call_duration_seconds INT,
    call_disposition TEXT,                -- 'answered', 'voicemail', 'no_answer', 'busy', 'failed'
    call_transcript TEXT,
    vapi_concurrency_used INT,

    -- SMS-specific
    sms_status TEXT,

    -- Email-specific
    email_status TEXT,

    -- Error tracking
    error_message TEXT,

    -- Cost tracking
    cost NUMERIC(10,4) DEFAULT 0,

    -- Timing
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 5. INDEXES
-- ============================================

-- Vapi Umbrellas
CREATE INDEX IF NOT EXISTS idx_vapi_umbrellas_active ON vapi_umbrellas(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tenant_vapi_assignments_client ON tenant_vapi_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_tenant_vapi_assignments_umbrella ON tenant_vapi_assignments(umbrella_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vapi_umbrella_migrations_client ON vapi_umbrella_migrations(client_id);

-- Tenant Profiles
CREATE INDEX IF NOT EXISTS idx_tenant_profiles_client ON tenant_profiles(client_id);

-- Twilio
CREATE INDEX IF NOT EXISTS idx_tenant_twilio_client ON tenant_twilio_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_tenant_phones_client ON tenant_phone_numbers(client_id);
CREATE INDEX IF NOT EXISTS idx_tenant_phones_number ON tenant_phone_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_tenant_a2p_client ON tenant_a2p_registrations(client_id);
CREATE INDEX IF NOT EXISTS idx_a2p_pending ON tenant_a2p_registrations(brand_status)
    WHERE brand_status = 'pending' OR campaign_status IN ('awaiting_brand', 'pending_approval');

-- Sequences
CREATE INDEX IF NOT EXISTS idx_sequences_client ON sequences(client_id);
CREATE INDEX IF NOT EXISTS idx_sequences_active ON sequences(client_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence ON sequence_steps(sequence_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_order ON sequence_steps(sequence_id, step_order);

-- Enrollments (critical for scheduler performance)
CREATE INDEX IF NOT EXISTS idx_enrollments_next_step ON sequence_enrollments(next_step_at)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_status ON sequence_enrollments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_sequence ON sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_contact ON sequence_enrollments(contact_id);

-- Execution Log
CREATE INDEX IF NOT EXISTS idx_execution_log_enrollment ON sequence_execution_log(enrollment_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_log_step ON sequence_execution_log(step_id);

-- ============================================
-- 6. RLS (enable but rely on service role bypass)
-- ============================================

ALTER TABLE vapi_umbrellas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_vapi_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vapi_umbrella_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_twilio_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_a2p_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_execution_log ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (matches existing pattern)
CREATE POLICY "service_role_all_vapi_umbrellas" ON vapi_umbrellas FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_vapi_assignments" ON tenant_vapi_assignments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_vapi_umbrella_migrations" ON vapi_umbrella_migrations FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_profiles" ON tenant_profiles FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_twilio_accounts" ON tenant_twilio_accounts FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_phone_numbers" ON tenant_phone_numbers FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_tenant_a2p_registrations" ON tenant_a2p_registrations FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_sequences" ON sequences FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_sequence_steps" ON sequence_steps FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_sequence_enrollments" ON sequence_enrollments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_sequence_execution_log" ON sequence_execution_log FOR ALL TO service_role USING (true);
