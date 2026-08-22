import { supabase } from './db.js';

/**
 * Contact fatigue: how recently may we message this person again?
 *
 * Lives at the WORKER layer, not just the scheduler, because five producers
 * reach the send queues directly — the self-healer (three sites), the
 * booking-link SMS and the chatbot reply — and a scheduler-only check left all
 * of them able to stack messages on a lead who had just been contacted. Every
 * send funnels through a worker, so this is the one place that sees them all.
 *
 * Keyed on the CONTACT rather than the enrollment, so it also catches one
 * person being reached by two sequences at once.
 */

function gapEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const MIN_SAME_CHANNEL_GAP_HOURS = gapEnv('MIN_SAME_CHANNEL_GAP_HOURS', 20);
export const MIN_CROSS_CHANNEL_GAP_MINUTES = gapEnv('MIN_CROSS_CHANNEL_GAP_MINUTES', 2);

export interface FatigueVerdict {
    /** true when this send should be withheld for now. */
    hold: boolean;
    /** When the gap clears. Only set when hold is true. */
    until?: Date;
    /** Human-readable cause, for logs and execution-log rows. */
    reason?: string;
}

/**
 * A REPLY to something the lead just sent is never fatigue-limited — silencing
 * our side of a live two-way conversation would be worse than the problem this
 * guards against. Proactive outbound is what gets held.
 */
export function isReactiveSend(metadataSource?: string | null): boolean {
    return metadataSource === 'chatbot';
}

export async function checkContactFatigue(params: {
    contactId: string;
    channel: 'sms' | 'voice' | 'email';
    /** metadata.source from the job payload, when there is one. */
    metadataSource?: string | null;
    isTest?: boolean;
}): Promise<FatigueVerdict> {
    if (params.isTest) return { hold: false };
    if (isReactiveSend(params.metadataSource)) return { hold: false };
    if (MIN_SAME_CHANNEL_GAP_HOURS <= 0 && MIN_CROSS_CHANNEL_GAP_MINUTES <= 0) {
        return { hold: false };
    }

    const now = Date.now();
    const lookbackFrom = new Date(
        now - Math.max(MIN_SAME_CHANNEL_GAP_HOURS, 1) * 3600_000
    ).toISOString();

    // Two targeted reads rather than one capped list: a burst on one channel
    // must not push the row that matters out of the window.
    const [sameRes, otherRes] = await Promise.all([
        supabase
            .from('contact_interactions')
            .select('channel, created_at')
            .eq('contact_id', params.contactId)
            .eq('direction', 'outbound')
            .eq('channel', params.channel)
            .gte('created_at', lookbackFrom)
            .order('created_at', { ascending: false })
            .limit(1),
        supabase
            .from('contact_interactions')
            .select('channel, created_at')
            .eq('contact_id', params.contactId)
            .eq('direction', 'outbound')
            .neq('channel', params.channel)
            .gte('created_at', lookbackFrom)
            .order('created_at', { ascending: false })
            .limit(1),
    ]);

    let holdUntil = 0;
    let reason = '';
    for (const r of [...(sameRes.data || []), ...(otherRes.data || [])]) {
        const at = new Date(r.created_at as string).getTime();
        if (!at) continue;
        const sameChannel = r.channel === params.channel;
        const requiredMs = sameChannel
            ? MIN_SAME_CHANNEL_GAP_HOURS * 3600_000
            : MIN_CROSS_CHANNEL_GAP_MINUTES * 60_000;
        if (now - at < requiredMs && at + requiredMs > holdUntil) {
            holdUntil = at + requiredMs;
            reason = `${sameChannel ? 'same-channel' : 'cross-channel'} ${params.channel} ${Math.round((now - at) / 60000)}min ago`;
        }
    }

    return holdUntil > now
        ? { hold: true, until: new Date(holdUntil), reason }
        : { hold: false };
}
