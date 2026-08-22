import { supabase } from './db.js';
import { redis } from './redis.js';

/**
 * Outbound caller-ID / from-number resolution.
 *
 * Two layers:
 *   1. Rotation (sequences.rotate_phone_numbers): the sequence spreads its
 *      calls AND texts across a hand-picked pool of the tenant's numbers,
 *      sticky per enrollment — the lead hears from ONE number for the whole
 *      campaign. Picked round-robin on the first outbound touch and stored on
 *      sequence_enrollments.outbound_phone_id.
 *   2. Legacy single-number resolution (voice only), moved verbatim from the
 *      scheduler: tenant default → agent's number → any VAPI-synced number.
 *
 * SMS has no legacy layer here: sms-worker keeps its Messaging Service /
 * 'sequencer'-number logic and only asks for the rotation pick.
 */

export interface RotationPhone {
    /** tenant_phone_numbers.id — the sticky value stored on the enrollment. */
    id: string;
    /** E.164 — Twilio `from`. */
    phone_number: string;
    /** VAPI phone-number id — outbound `phoneNumberId`. */
    vapi_phone_number_id: string;
}

export type CallerIdSource = 'rotation' | 'tenant_default' | 'agent' | 'fallback' | 'none';

// Long enough to outlive any campaign; expiry just restarts the cursor at slot 0.
const CURSOR_TTL_SECONDS = 30 * 24 * 60 * 60;

export function rotationCursorKey(sequenceId: string): string {
    return `seq:phone-rotation:${sequenceId}`;
}

/**
 * The picked numbers that can actually be used right now, in the saved
 * rotation order. Released numbers are hard-deleted rows and unsynced ones
 * can't dial, so both simply drop out. `purpose` is deliberately ignored —
 * the operator picked these numbers explicitly.
 */
async function loadRotationPool(tenantId: string, ids: string[]): Promise<RotationPhone[]> {
    const { data, error } = await supabase
        .from('tenant_phone_numbers')
        .select('id, phone_number, vapi_phone_number_id')
        .eq('client_id', tenantId)
        .in('id', ids)
        .eq('status', 'active')
        .not('vapi_phone_number_id', 'is', null);
    if (error) throw new Error(`tenant_phone_numbers query failed: ${error.message}`);

    const byId = new Map<string, RotationPhone>();
    for (const row of data ?? []) byId.set(row.id as string, row as RotationPhone);
    return ids.map((id) => byId.get(id)).filter((row): row is RotationPhone => !!row);
}

/**
 * Rotation branch only. Returns the enrollment's sticky number, assigning one
 * on the first touch. null ⇒ rotation is off, the pool is unusable, or the
 * lookup failed — the caller then uses its legacy path. Never throws.
 */
export async function resolveRotationPhone(params: {
    enrollmentId: string;
    tenantId: string;
    sequenceId: string;
}): Promise<RotationPhone | null> {
    const { enrollmentId, tenantId, sequenceId } = params;
    try {
        const { data: sequence, error: seqError } = await supabase
            .from('sequences')
            .select('rotate_phone_numbers, rotation_phone_number_ids')
            .eq('id', sequenceId)
            .maybeSingle();
        if (seqError) throw new Error(`sequences query failed: ${seqError.message}`);

        const ids: string[] = Array.isArray(sequence?.rotation_phone_number_ids)
            ? sequence.rotation_phone_number_ids
            : [];
        // OFF is byte-identical to the legacy path: outbound_phone_id is never read.
        if (!sequence?.rotate_phone_numbers || ids.length === 0) return null;

        const pool = await loadRotationPool(tenantId, ids);
        if (pool.length === 0) {
            console.warn(
                `[OUTBOUND-PHONE] Sequence ${sequenceId} rotates numbers but none of its ${ids.length} picked numbers are active + VAPI-synced — falling back to legacy caller ID`
            );
            return null;
        }

        const { data: enrollment, error: enrError } = await supabase
            .from('sequence_enrollments')
            .select('outbound_phone_id')
            .eq('id', enrollmentId)
            .maybeSingle();
        if (enrError) throw new Error(`sequence_enrollments query failed: ${enrError.message}`);

        const current: string | null = enrollment?.outbound_phone_id ?? null;
        const sticky = current ? pool.find((p) => p.id === current) : undefined;
        if (sticky) return sticky;

        // First touch (or the sticky number left the pool): take the next slot.
        const key = rotationCursorKey(sequenceId);
        const n = await redis.incr(key);
        await redis.expire(key, CURSOR_TTL_SECONDS);
        const pick = pool[(n - 1) % pool.length];

        // CAS: a concurrent voice job and chatbot SMS for the same enrollment
        // must not land on different numbers. Match exactly the value we read
        // (NULL on first touch, the stale id when re-picking).
        let cas = supabase
            .from('sequence_enrollments')
            .update({ outbound_phone_id: pick.id })
            .eq('id', enrollmentId);
        cas = current ? cas.eq('outbound_phone_id', current) : cas.is('outbound_phone_id', null);
        const { data: won, error: casError } = await cas.select('outbound_phone_id').maybeSingle();
        if (casError) throw new Error(`sticky assignment failed: ${casError.message}`);

        if (won) {
            console.log(
                `[OUTBOUND-PHONE] Enrollment ${enrollmentId} → ${pick.phone_number} (slot ${n} of ${pool.length}${current ? ', re-picked: previous number left the pool' : ''})`
            );
            return pick;
        }

        // Lost the race — adopt the winner's number. One wasted cursor slot.
        const { data: after } = await supabase
            .from('sequence_enrollments')
            .select('outbound_phone_id')
            .eq('id', enrollmentId)
            .maybeSingle();
        const winner = after?.outbound_phone_id
            ? pool.find((p) => p.id === after.outbound_phone_id)
            : undefined;
        if (winner) return winner;

        console.warn(
            `[OUTBOUND-PHONE] Enrollment ${enrollmentId}: sticky assignment raced and the stored number is not in the pool — using ${pick.phone_number} for this send only`
        );
        return pick;
    } catch (err) {
        console.error(
            `[OUTBOUND-PHONE] Rotation lookup failed for enrollment ${enrollmentId} — falling back to legacy caller ID:`,
            err
        );
        return null;
    }
}

/**
 * Legacy single-number caller ID (moved verbatim from scheduler-worker.ts).
 * Priority order:
 *   1. tenant_profiles.default_outbound_phone_id (operator's explicit choice
 *      from /settings/outbound-caller-id)
 *   2. Phone assigned to this specific agent (legacy per-agent assignment,
 *      mostly used for inbound routing)
 *   3. Any active phone for this tenant registered with VAPI (last-resort
 *      fallback so test_now works before configuration)
 * VAPI rejects /call/phone without phoneNumberId, so we MUST land on
 * something here.
 */
async function resolveLegacyVoiceCallerId(
    tenantId: string,
    voiceAgentId: string | null | undefined
): Promise<{ phoneNumberId: string | null; source: CallerIdSource }> {
    const { data: tenantDefault } = await supabase
        .from('tenant_profiles')
        .select('default_outbound_phone_id')
        .eq('client_id', tenantId)
        .single();

    if (tenantDefault?.default_outbound_phone_id) {
        const { data: defaultPhone } = await supabase
            .from('tenant_phone_numbers')
            .select('vapi_phone_number_id, status')
            .eq('id', tenantDefault.default_outbound_phone_id)
            .single();
        if (defaultPhone?.status === 'active' && defaultPhone.vapi_phone_number_id) {
            return { phoneNumberId: defaultPhone.vapi_phone_number_id, source: 'tenant_default' };
        }
    }

    if (voiceAgentId) {
        const { data: phoneRow } = await supabase
            .from('tenant_phone_numbers')
            .select('vapi_phone_number_id')
            .eq('agent_id', voiceAgentId)
            .eq('status', 'active')
            .single();
        if (phoneRow?.vapi_phone_number_id) {
            return { phoneNumberId: phoneRow.vapi_phone_number_id, source: 'agent' };
        }
    }

    const { data: fallbackPhone } = await supabase
        .from('tenant_phone_numbers')
        .select('vapi_phone_number_id')
        .eq('client_id', tenantId)
        .eq('status', 'active')
        .not('vapi_phone_number_id', 'is', null)
        .limit(1)
        .maybeSingle();
    if (fallbackPhone?.vapi_phone_number_id) {
        console.log(
            `[OUTBOUND-PHONE] No tenant-default or agent-level phone for ${voiceAgentId || '<no agent>'}, falling back to tenant phone ${fallbackPhone.vapi_phone_number_id}`
        );
        return { phoneNumberId: fallbackPhone.vapi_phone_number_id, source: 'fallback' };
    }

    return { phoneNumberId: null, source: 'none' };
}

/**
 * Voice caller ID for one dial: rotation first (when the sequence is known),
 * then the legacy tiers. Used by the scheduler at enqueue time and by the
 * VAPI worker at dial time for jobs that carry no phoneNumberId (self-healer
 * re-queues, pre-upgrade jobs).
 */
export async function resolveVoiceCallerId(params: {
    enrollmentId: string;
    tenantId: string;
    sequenceId?: string | null;
    voiceAgentId?: string | null;
}): Promise<{ phoneNumberId: string | null; source: CallerIdSource }> {
    if (params.sequenceId) {
        const rotated = await resolveRotationPhone({
            enrollmentId: params.enrollmentId,
            tenantId: params.tenantId,
            sequenceId: params.sequenceId,
        });
        if (rotated) return { phoneNumberId: rotated.vapi_phone_number_id, source: 'rotation' };
    }
    return resolveLegacyVoiceCallerId(params.tenantId, params.voiceAgentId);
}
