-- ═══════════════════════════════════════════════════════════════════
-- Sequencer review fixes (2026-06-11)
--
-- Backing DDL for the fixes from sequencer/CODE-REVIEW-2026-06-11.md:
--
--   1. Per-enrollment dynamic steps: JIT-generated steps were written to
--      the shared sequence_steps table keyed only by (sequence_id,
--      step_order); with 2+ enrollments on one dynamic sequence, the
--      UNIQUE constraint made the second insert fail silently and the
--      scheduler served enrollment A's personalized content to contact B.
--      Generated steps now carry enrollment_id; static steps keep the
--      old uniqueness via a partial index.
--
--   2. Missing RPCs the Node code already calls (supabase.rpc returns
--      {error} rather than throwing, so these failed silently):
--      increment_enrollment_sms, increment_step_attributed_conversions.
--      Plus new counters that previously used lossy read-modify-write
--      or were never written at all: calls/emails/attempts, variant
--      replies/conversions.
--
--   3. claim_due_enrollments: FOR UPDATE SKIP LOCKED claim so the
--      scheduler's batch claim is safe under concurrent instances
--      (the previous PostgREST limited-update relied on unspecified
--      re-check semantics).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Per-enrollment dynamic steps ─────────────────────────────────

ALTER TABLE sequence_steps
    ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE;

COMMENT ON COLUMN sequence_steps.enrollment_id IS
    'NULL for static (template) steps shared by all enrollments. Set for JIT-generated steps, which are personalized to a single enrollment and must never be served to another.';

-- Pre-existing dynamically generated rows cannot be attributed to an
-- enrollment retroactively; they stay enrollment_id NULL and behave as
-- before. New generations are enrollment-scoped.
ALTER TABLE sequence_steps
    DROP CONSTRAINT IF EXISTS sequence_steps_sequence_id_step_order_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sequence_steps_static_order
    ON sequence_steps(sequence_id, step_order)
    WHERE enrollment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sequence_steps_dynamic_order
    ON sequence_steps(sequence_id, enrollment_id, step_order)
    WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_steps_enrollment
    ON sequence_steps(enrollment_id)
    WHERE enrollment_id IS NOT NULL;

-- ── 2. Enrollment counters (single-statement, race-free) ────────────
-- Param name is `enrollment_id` (no p_ prefix) to match the existing
-- call sites in the Node workers.

CREATE OR REPLACE FUNCTION increment_enrollment_sms(enrollment_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sequence_enrollments e
    SET sms_sent = COALESCE(e.sms_sent, 0) + 1, updated_at = now()
    WHERE e.id = increment_enrollment_sms.enrollment_id;
END;
$$;

CREATE OR REPLACE FUNCTION increment_enrollment_calls(enrollment_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sequence_enrollments e
    SET calls_made = COALESCE(e.calls_made, 0) + 1, updated_at = now()
    WHERE e.id = increment_enrollment_calls.enrollment_id;
END;
$$;

CREATE OR REPLACE FUNCTION increment_enrollment_emails(enrollment_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sequence_enrollments e
    SET emails_sent = COALESCE(e.emails_sent, 0) + 1, updated_at = now()
    WHERE e.id = increment_enrollment_emails.enrollment_id;
END;
$$;

CREATE OR REPLACE FUNCTION increment_enrollment_attempts(enrollment_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sequence_enrollments e
    SET total_attempts = COALESCE(e.total_attempts, 0) + 1, updated_at = now()
    WHERE e.id = increment_enrollment_attempts.enrollment_id;
END;
$$;

-- ── 3. Variant outcome counters (closes the A/B learning loop) ──────

CREATE OR REPLACE FUNCTION increment_variant_replies(p_variant_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE step_variants
    SET total_replies = COALESCE(total_replies, 0) + 1,
        reply_rate = COALESCE((COALESCE(total_replies, 0) + 1)::numeric / NULLIF(total_sent, 0), 0),
        updated_at = now()
    WHERE id = p_variant_id;
END;
$$;

CREATE OR REPLACE FUNCTION increment_variant_conversions(p_variant_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE step_variants
    SET total_conversions = COALESCE(total_conversions, 0) + 1,
        conversion_rate = COALESCE((COALESCE(total_conversions, 0) + 1)::numeric / NULLIF(total_sent, 0), 0),
        updated_at = now()
    WHERE id = p_variant_id;
END;
$$;

-- ── 4. Multi-touch attribution sink (was called, never defined) ─────
-- Adds the fractional attribution to the step's most recent analytics
-- row, creating today's bucket if none exists yet.

CREATE OR REPLACE FUNCTION increment_step_attributed_conversions(p_step_id UUID, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_row_id UUID;
BEGIN
    SELECT id INTO v_row_id
    FROM step_analytics
    WHERE step_id = p_step_id
    ORDER BY period_end DESC
    LIMIT 1;

    IF v_row_id IS NOT NULL THEN
        UPDATE step_analytics
        SET attributed_conversions = COALESCE(attributed_conversions, 0) + p_amount
        WHERE id = v_row_id;
    ELSE
        INSERT INTO step_analytics (step_id, sequence_id, client_id, period_start, period_end, attributed_conversions)
        SELECT ss.id, ss.sequence_id, s.client_id,
               date_trunc('day', now()), date_trunc('day', now()) + interval '1 day',
               p_amount
        FROM sequence_steps ss
        JOIN sequences s ON s.id = ss.sequence_id
        WHERE ss.id = p_step_id;
    END IF;
END;
$$;

-- ── 5. Safe batch claim for the scheduler ────────────────────────────

CREATE OR REPLACE FUNCTION claim_due_enrollments(p_lease_until TIMESTAMPTZ, p_limit INT)
RETURNS SETOF UUID LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    UPDATE sequence_enrollments e
    SET next_step_at = p_lease_until, updated_at = now()
    WHERE e.id IN (
        SELECT id FROM sequence_enrollments
        WHERE status = 'active' AND next_step_at <= now()
        ORDER BY next_step_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING e.id;
END;
$$;
