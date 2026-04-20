/**
 * Call-time variable resolver.
 *
 * VAPI assistants accept `{{varname}}` placeholders inside system prompts which
 * are interpolated at call start from `assistantOverrides.variableValues`.
 *
 * This helper computes the two variables every call needs regardless of vertical:
 *   - currentDate   — today's date formatted in the tenant's timezone
 *                     (e.g. "Tuesday, April 21, 2026"), so the LLM can resolve
 *                     relative dates like "tomorrow" or "next Tuesday"
 *   - tenantTimezone — the tenant's IANA timezone (e.g. "America/Chicago")
 *
 * Used by:
 *   - Inbound webhook (assistant-request) in src/app/api/webhooks/vapi/route.ts
 *   - Outbound sequencer in sequencer/src/workers/vapi-worker.ts (which imports
 *     its own copy — see sequencer/src/lib/call-variables.ts)
 */

import { formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/lib/supabase";

const DEFAULT_TIMEZONE = "America/New_York";

export interface CallTimeVariables {
    currentDate: string;
    tenantTimezone: string;
}

/**
 * Resolve currentDate + tenantTimezone for a given client.
 * Safe to call on any path — falls back to DEFAULT_TIMEZONE on any error.
 */
export async function getCallTimeVariables(clientId: string): Promise<CallTimeVariables> {
    let tz = DEFAULT_TIMEZONE;
    try {
        const { data } = await supabase
            .from("tenant_profiles")
            .select("timezone")
            .eq("client_id", clientId)
            .single();
        const candidate = (data as { timezone?: string } | null)?.timezone;
        if (candidate && typeof candidate === "string" && candidate.trim().length > 0) {
            tz = candidate;
        }
    } catch (err) {
        console.warn("[CALL VARIABLES] Failed to read tenant timezone, falling back to default:", err);
    }

    let currentDate: string;
    try {
        currentDate = formatInTimeZone(new Date(), tz, "EEEE, MMMM d, yyyy");
    } catch (err) {
        console.warn("[CALL VARIABLES] Bad timezone, falling back to default:", tz, err);
        tz = DEFAULT_TIMEZONE;
        currentDate = formatInTimeZone(new Date(), tz, "EEEE, MMMM d, yyyy");
    }

    return { currentDate, tenantTimezone: tz };
}
