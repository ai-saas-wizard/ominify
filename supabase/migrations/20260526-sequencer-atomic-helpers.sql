-- ═══════════════════════════════════════════════════════════════════
-- Atomic helpers for the sequencer
--
-- The Node sequencer had three read-modify-write races that lost writes
-- under concurrent execution:
--
--   1. step_variants.total_sent — undercounted, skewing A/B stats
--   2. sequence_enrollments.healing_actions_taken (JSONB[]) — lost entries
--   3. sequence_enrollments.objections_detected (JSONB[]) — lost objections
--
-- Postgres can do each of these atomically in a single statement; the
-- functions below expose that to supabase-js via rpc().
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_variant_sent(p_variant_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE step_variants
    SET total_sent = COALESCE(total_sent, 0) + 1,
        updated_at = now()
    WHERE id = p_variant_id;
END;
$$;

CREATE OR REPLACE FUNCTION append_healing_to_enrollment(
    p_enrollment_id UUID,
    p_healing jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE sequence_enrollments
    SET healing_actions_taken = COALESCE(healing_actions_taken, '[]'::jsonb)
                                || jsonb_build_array(p_healing),
        updated_at = now()
    WHERE id = p_enrollment_id;
END;
$$;

-- Merge new objections into objections_detected, deduplicating on
-- (type, detail). Other emotional-intelligence fields are still written
-- by the caller in a separate UPDATE, because those are last-write-wins
-- by design (engagement_score, sentiment_trend, etc.).
CREATE OR REPLACE FUNCTION merge_objections(
    p_enrollment_id UUID,
    p_new_objections jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing jsonb;
    v_obj jsonb;
    v_merged jsonb;
BEGIN
    SELECT COALESCE(objections_detected, '[]'::jsonb)
    INTO v_existing
    FROM sequence_enrollments
    WHERE id = p_enrollment_id
    FOR UPDATE;

    v_merged := v_existing;
    FOR v_obj IN SELECT jsonb_array_elements(COALESCE(p_new_objections, '[]'::jsonb)) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_merged) e
            WHERE e->>'type' = v_obj->>'type'
              AND e->>'detail' = v_obj->>'detail'
        ) THEN
            v_merged := v_merged || jsonb_build_array(v_obj);
        END IF;
    END LOOP;

    UPDATE sequence_enrollments
    SET objections_detected = v_merged,
        updated_at = now()
    WHERE id = p_enrollment_id;
END;
$$;
