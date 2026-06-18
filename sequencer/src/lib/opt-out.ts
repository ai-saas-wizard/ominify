import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deterministic opt-out handling (review C3/C5).
 *
 * Keyword detection MUST run before any LLM classification: TCPA/carrier
 * compliance cannot depend on GPT availability or accuracy. When a stop
 * is detected (by keyword OR by the LLM), optOutContact persists it at
 * the CONTACT level so every sequence stops — not just the enrollment
 * that received the reply — and re-ingestion cannot re-enroll the lead.
 */

// Twilio-reserved stop keywords plus common natural variants. Anchored:
// the whole message must be the keyword (so "please don't stop calling"
// does not opt out — that goes through the LLM path).
const STOP_RE = /^\s*(stop|stopall|stop\s+all|unsubscribe|cancel|end|quit|revoke|optout|opt\s*[- ]?out|remove\s+me)\s*[.!]*\s*$/i;
const START_RE = /^\s*(start|unstop|subscribe|resume)\s*[.!]*\s*$/i;
const HELP_RE = /^\s*(help|info)\s*[.!]*\s*$/i;

export function isStopMessage(text: string | null | undefined): boolean {
    return typeof text === 'string' && STOP_RE.test(text);
}

export function isStartMessage(text: string | null | undefined): boolean {
    return typeof text === 'string' && START_RE.test(text);
}

export function isHelpMessage(text: string | null | undefined): boolean {
    return typeof text === 'string' && HELP_RE.test(text);
}

/**
 * STOP detection for email bodies. Real email replies carry quoted text
 * and signatures below the actual reply, so whole-body matching almost
 * never fires — test the first non-quoted, non-empty line instead.
 */
export function isStopEmailBody(body: string | null | undefined): boolean {
    if (typeof body !== 'string') return false;
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('>') || line.startsWith('On ')) break; // quoted reply begins
        return STOP_RE.test(line);
    }
    return false;
}

export function isContactOptedOut(contact: { opted_out_at?: string | null } | null | undefined): boolean {
    return Boolean(contact?.opted_out_at);
}

/** Enrollment statuses that still produce outreach and must be stopped on opt-out. */
const STOPPABLE_STATUSES = ['active', 'paused', 'awaiting_outcome', 'generating_next_step'];

/**
 * Persist a contact-level opt-out and stop every in-flight enrollment
 * for that contact. Idempotent; keeps the earliest opted_out_at.
 */
export async function optOutContact(
    supabase: SupabaseClient,
    contactId: string,
    channel: 'sms' | 'voice' | 'email',
    source: string
): Promise<void> {
    const nowIso = new Date().toISOString();

    const { error: contactErr } = await supabase
        .from('contacts')
        .update({ opted_out_at: nowIso, opted_out_channel: channel })
        .eq('id', contactId)
        .is('opted_out_at', null);

    if (contactErr) {
        console.error(`[OPT-OUT] Failed to set contact-level opt-out for ${contactId}:`, contactErr);
    }

    const { error: enrollErr } = await supabase
        .from('sequence_enrollments')
        .update({
            status: 'manual_stop',
            completed_at: nowIso,
            completed_reason: `opted_out_via_${channel}`,
            updated_at: nowIso,
        })
        .eq('contact_id', contactId)
        .in('status', STOPPABLE_STATUSES);

    if (enrollErr) {
        console.error(`[OPT-OUT] Failed to stop enrollments for contact ${contactId}:`, enrollErr);
    }

    console.log(`[OPT-OUT] Contact ${contactId} opted out via ${channel} (${source})`);
}

/** Clear a contact's opt-out after an explicit START/UNSTOP re-opt-in. */
export async function reoptInContact(supabase: SupabaseClient, contactId: string): Promise<void> {
    const { error } = await supabase
        .from('contacts')
        .update({ opted_out_at: null, opted_out_channel: null })
        .eq('id', contactId);

    if (error) {
        console.error(`[OPT-OUT] Failed to clear opt-out for contact ${contactId}:`, error);
    } else {
        console.log(`[OPT-OUT] Contact ${contactId} re-opted in`);
    }
}
