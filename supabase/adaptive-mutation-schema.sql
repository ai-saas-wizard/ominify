-- ============================================
-- ADAPTIVE SEQUENCE MUTATION ENGINE (Phase 3)
-- AI dynamically rewrites upcoming sequence steps
-- based on conversation history and emotional state
-- ============================================

-- ============================================
-- 1. New columns on sequences (sequence-level settings)
-- ============================================

-- Master toggle for adaptive mutation on this sequence
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS enable_adaptive_mutation BOOLEAN DEFAULT false;

-- How aggressively should the AI rewrite content?
-- conservative: only adjust tone and add context references
-- moderate: rewrite content while preserving intent and CTA
-- aggressive: completely regenerate content based on conversation history
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS mutation_aggressiveness TEXT DEFAULT 'moderate'
    CHECK (mutation_aggressiveness IN ('conservative', 'moderate', 'aggressive'));

-- ============================================
-- 2. New columns on sequence_steps (step-level settings)
-- ============================================

-- Per-step toggle (overrides sequence-level when explicitly set)
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS enable_ai_mutation BOOLEAN DEFAULT false;

-- Optional human guidance for the AI mutator
-- e.g., "Always address pricing if it was mentioned"
-- e.g., "Keep the discount offer but personalize the opening"
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS mutation_instructions TEXT;

-- ============================================
-- 3. Step Mutations table (mutation audit trail)
-- ============================================

CREATE TABLE IF NOT EXISTS step_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE NOT NULL,
    step_id UUID REFERENCES sequence_steps(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Content comparison
    original_content JSONB NOT NULL,         -- The template as written by the user
    mutated_content JSONB NOT NULL,          -- The AI-rewritten version that was sent
    mutation_reason TEXT,                     -- "Customer expressed price concern on last call"

    -- Mutation metadata
    mutation_model TEXT DEFAULT 'gpt-4o',    -- Which model was used
    confidence_score NUMERIC(3,2),           -- 0.00-1.00 — how confident the AI was
    aggressiveness TEXT,                     -- The aggressiveness level used for this mutation

    -- Performance tracking (updated later by outcome learning)
    resulted_in_reply BOOLEAN DEFAULT false,
    resulted_in_conversion BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

-- Lookup mutations for an enrollment
CREATE INDEX IF NOT EXISTS idx_mutations_enrollment
    ON step_mutations(enrollment_id, created_at DESC);

-- Lookup mutations for a step (for analytics: mutated vs original performance)
CREATE INDEX IF NOT EXISTS idx_mutations_step
    ON step_mutations(step_id, created_at DESC);

-- Client-level queries
CREATE INDEX IF NOT EXISTS idx_mutations_client
    ON step_mutations(client_id, created_at DESC);

-- Performance analysis: find successful mutations
CREATE INDEX IF NOT EXISTS idx_mutations_performance
    ON step_mutations(step_id) WHERE resulted_in_reply = true OR resulted_in_conversion = true;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE step_mutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_step_mutations" ON step_mutations FOR ALL TO service_role USING (true);
