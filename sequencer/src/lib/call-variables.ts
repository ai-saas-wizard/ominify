/**
 * Call-time variable resolver (sequencer copy).
 *
 * Mirrors src/lib/call-variables.ts in the webapp. We keep a local copy here
 * because the sequencer runs as its own Node process with its own Supabase
 * client — it can't import from the Next.js app.
 *
 * VAPI interpolates `{{varname}}` placeholders from
 * `assistantOverrides.variableValues` at call start. For outbound calls this
 * is passed alongside the inline assistant in the call-create payload.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from './db.js';

const DEFAULT_TIMEZONE = 'America/New_York';

export interface CallTimeVariables {
    currentDate: string;
    tenantTimezone: string;
}

/**
 * Resolve currentDate + tenantTimezone for a given tenant.
 * Safe to call on any path — falls back to DEFAULT_TIMEZONE on any error.
 */
export async function getCallTimeVariables(tenantId: string): Promise<CallTimeVariables> {
    let tz = DEFAULT_TIMEZONE;
    try {
        const { data } = await supabase
            .from('tenant_profiles')
            .select('timezone')
            .eq('client_id', tenantId)
            .single();
        const candidate = (data as { timezone?: string } | null)?.timezone;
        if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
            tz = candidate;
        }
    } catch (err) {
        console.warn('[CALL VARIABLES] Failed to read tenant timezone, falling back to default:', err);
    }

    let currentDate: string;
    try {
        currentDate = formatInTimeZone(new Date(), tz, 'EEEE, MMMM d, yyyy');
    } catch (err) {
        console.warn('[CALL VARIABLES] Bad timezone, falling back to default:', tz, err);
        tz = DEFAULT_TIMEZONE;
        currentDate = formatInTimeZone(new Date(), tz, 'EEEE, MMMM d, yyyy');
    }

    return { currentDate, tenantTimezone: tz };
}
