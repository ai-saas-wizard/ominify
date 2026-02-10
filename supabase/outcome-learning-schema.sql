-- ============================================
-- OUTCOME-BASED SEQUENCE LEARNING (Phase 5)
-- Step-level attribution, A/B testing,
-- optimization suggestions, industry benchmarks
-- ============================================

-- ============================================
-- 1. Step Analytics — per-step performance metrics
-- ============================================

CREATE TABLE IF NOT EXISTS step_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID REFERENCES sequence_steps(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Volume
    total_executions INT DEFAULT 0,
    total_delivered INT DEFAULT 0,
    total_failed INT DEFAULT 0,
    total_replies INT DEFAULT 0,
    total_conversions INT DEFAULT 0,  -- booked / replied with intent

    -- Computed rates
    reply_rate NUMERIC(5,4) DEFAULT 0,           -- total_replies / total_delivered
    conversion_rate NUMERIC(5,4) DEFAULT 0,      -- total_conversions / total_delivered
    delivery_rate NUMERIC(5,4) DEFAULT 0,        -- total_delivered / total_executions
    avg_response_time_seconds INT DEFAULT 0,

    -- Attribution
    attributed_conversions NUMERIC(7,2) DEFAULT 0,  -- fractional via multi-touch
    attribution_score NUMERIC(5,4) DEFAULT 0,        -- 0-1, how much this step drives conversions

    -- Timing optimization
    optimal_send_hour INT,       -- 0-23
    optimal_send_day INT,        -- 0=Sun, 6=Sat
    hourly_response_rates JSONB DEFAULT '{}',   -- { "8": 0.12, "9": 0.15, ... }

    -- Mutation tracking
    mutated_executions INT DEFAULT 0,
    mutated_conversions INT DEFAULT 0,
    mutated_conversion_rate NUMERIC(5,4) DEFAULT 0,

    -- Cost efficiency
    total_cost NUMERIC(10,4) DEFAULT 0,
    cost_per_conversion NUMERIC(10,4) DEFAULT 0,

    -- Period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. Sequence Analytics — sequence-level performance
-- ============================================

CREATE TABLE IF NOT EXISTS sequence_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Volume
    total_enrollments INT DEFAULT 0,
    total_completions INT DEFAULT 0,
    total_conversions INT DEFAULT 0,    -- booked + replied positively
    total_opt_outs INT DEFAULT 0,

    -- Rates
    completion_rate NUMERIC(5,4) DEFAULT 0,
    conversion_rate NUMERIC(5,4) DEFAULT 0,
    reply_rate NUMERIC(5,4) DEFAULT 0,
    opt_out_rate NUMERIC(5,4) DEFAULT 0,

    -- Timing
    avg_time_to_conversion_hours NUMERIC(8,2) DEFAULT 0,
    avg_steps_to_conversion NUMERIC(5,2) DEFAULT 0,

    -- Cost
    total_cost NUMERIC(10,4) DEFAULT 0,
    cost_per_conversion NUMERIC(10,4) DEFAULT 0,
    cost_per_enrollment NUMERIC(10,4) DEFAULT 0,

    -- Channel effectiveness breakdown
    channel_effectiveness JSONB DEFAULT '{}',
    -- e.g. { "sms": { "sent": 100, "replied": 15, "rate": 0.15 }, "voice": { ... } }

    -- Healing effectiveness
    total_healed INT DEFAULT 0,
    healing_success_rate NUMERIC(5,4) DEFAULT 0,

    -- Period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. Optimization Suggestions — AI-generated recommendations
-- ============================================

CREATE TABLE IF NOT EXISTS optimization_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- What kind of optimization
    suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
        'remove_step', 'add_step', 'change_channel', 'change_timing',
        'change_content', 'reorder_steps', 'split_test', 'merge_sequences',
        'enable_mutation', 'adjust_aggressiveness'
    )),

    -- Details
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    expected_improvement NUMERIC(5,2),  -- e.g., 15 = "+15%"
    confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')) DEFAULT 'medium',

    -- The suggested change (machine-readable)
    suggested_change JSONB NOT NULL,
    -- e.g., { "step_id": "...", "new_channel": "email" }
    -- e.g., { "step_id": "...", "new_delay_minutes": 30 }

    -- Target step (optional)
    target_step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,

    -- Evidence / reasoning
    evidence JSONB DEFAULT '{}',
    -- e.g., { "current_rate": 0.05, "benchmark_rate": 0.12, "sample_size": 150 }

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'accepted', 'dismissed', 'auto_applied', 'expired'
    )),
    accepted_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    applied_result JSONB,  -- { actual_improvement: 0.12, measured_after_days: 7 }

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 4. Step Variants — A/B testing infrastructure
-- ============================================

CREATE TABLE IF NOT EXISTS step_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID REFERENCES sequence_steps(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Variant info
    variant_name TEXT NOT NULL,       -- "A (Control)", "B (Shorter SMS)", etc.
    content JSONB NOT NULL,           -- The variant content template (same structure as step.content)
    traffic_weight NUMERIC(3,2) DEFAULT 0.50,  -- 0.0-1.0, weights must sum to 1.0

    -- Performance
    total_sent INT DEFAULT 0,
    total_replies INT DEFAULT 0,
    total_conversions INT DEFAULT 0,
    reply_rate NUMERIC(5,4) DEFAULT 0,
    conversion_rate NUMERIC(5,4) DEFAULT 0,

    -- Statistical significance
    is_winner BOOLEAN DEFAULT false,
    p_value NUMERIC(6,5),          -- null until enough data
    confidence_interval JSONB,     -- { "lower": 0.08, "upper": 0.15 }

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 5. Industry Benchmarks — anonymized cross-tenant data
-- ============================================

CREATE TABLE IF NOT EXISTS industry_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    industry TEXT NOT NULL,

    -- Aggregate metrics
    avg_conversion_rate NUMERIC(5,4) DEFAULT 0,
    avg_reply_rate NUMERIC(5,4) DEFAULT 0,
    avg_opt_out_rate NUMERIC(5,4) DEFAULT 0,
    avg_time_to_conversion_hours NUMERIC(8,2) DEFAULT 0,
    avg_steps_to_conversion NUMERIC(5,2) DEFAULT 0,
    avg_cost_per_conversion NUMERIC(10,4) DEFAULT 0,

    -- Channel effectiveness
    channel_benchmarks JSONB DEFAULT '{}',
    -- e.g., { "sms": { "reply_rate": 0.12 }, "email": { "reply_rate": 0.05 } }

    -- Best practices
    optimal_step_count INT,
    optimal_sequence_duration_hours INT,
    top_channel_order JSONB DEFAULT '[]',  -- ["sms", "voice", "email"]

    -- Meta
    sample_size INT DEFAULT 0,      -- number of sequences in this benchmark
    tenant_count INT DEFAULT 0,     -- number of tenants contributing

    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (industry, period_start, period_end)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_step_analytics_step
    ON step_analytics(step_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_step_analytics_sequence
    ON step_analytics(sequence_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_sequence_analytics_sequence
    ON sequence_analytics(sequence_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_sequence_analytics_client
    ON sequence_analytics(client_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_optimization_suggestions_client
    ON optimization_suggestions(client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_optimization_suggestions_sequence
    ON optimization_suggestions(sequence_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_step_variants_step
    ON step_variants(step_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_industry
    ON industry_benchmarks(industry, period_start DESC);

-- ============================================
-- New columns on sequence_execution_log
-- ============================================

-- Track which variant was used in each execution
ALTER TABLE sequence_execution_log ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES step_variants(id) ON DELETE SET NULL;

-- Track cost of each execution (SMS segment cost, email cost, call minutes cost)
ALTER TABLE sequence_execution_log ADD COLUMN IF NOT EXISTS execution_cost NUMERIC(8,4) DEFAULT 0;

-- ============================================
-- New columns on sequence_enrollments
-- ============================================

-- Attribution: which step triggered the conversion
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS converting_step_id UUID REFERENCES sequence_steps(id) ON DELETE SET NULL;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS conversion_type TEXT CHECK (conversion_type IN ('booked', 'replied', 'answered', 'clicked'));
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS time_to_conversion_seconds INT;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE step_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_step_analytics" ON step_analytics FOR ALL TO service_role USING (true);

ALTER TABLE sequence_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_sequence_analytics" ON sequence_analytics FOR ALL TO service_role USING (true);

ALTER TABLE optimization_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_optimization_suggestions" ON optimization_suggestions FOR ALL TO service_role USING (true);

ALTER TABLE step_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_step_variants" ON step_variants FOR ALL TO service_role USING (true);

ALTER TABLE industry_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_industry_benchmarks" ON industry_benchmarks FOR ALL TO service_role USING (true);
