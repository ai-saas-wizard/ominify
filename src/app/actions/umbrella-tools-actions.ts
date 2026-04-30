"use server";

import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption-helpers";
import { createTool } from "@/lib/vapi";
import {
    CALENDAR_TOOL_NAMES,
    buildCalendarToolDefinitions,
    type CalendarToolName,
    type CalendarToolIdMap,
} from "@/lib/verticals/real-estate-investor/tools";

// ═══════════════════════════════════════════════════════════
// UMBRELLA-SCOPED REUSABLE VAPI TOOLS
//
// Calendar tools are byte-identical across every UMBRELLA tenant — the only
// per-tenant data is `assistantId`, which the tool-call webhook itself
// passes back to /api/vapi/tools/calendar. So we register the 5 calendar
// tools ONCE per umbrella in VAPI, store their IDs on `vapi_umbrellas`, and
// every new UMBRELLA assistant references them via `model.toolIds` instead
// of inlining ~250 lines of identical JSON.
//
// Idempotent. Self-healing: if a single tool ID gets deleted from the JSONB
// map, the next ensure call recreates only that one.
// ═══════════════════════════════════════════════════════════

function getAppUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000")
    );
}

interface EnsureResult {
    success: boolean;
    toolIds?: CalendarToolIdMap;
    error?: string;
}

/**
 * Ensures all 5 calendar tools exist on the umbrella's VAPI account.
 * - Reads any existing IDs from `vapi_umbrellas.calendar_tool_ids`.
 * - For any tool NOT already registered, POSTs it to VAPI's /tool API.
 * - Persists the merged map back to the umbrellas row.
 *
 * Safe to call repeatedly. Re-running with a complete map is a single DB
 * read with no VAPI calls.
 */
export async function ensureUmbrellaCalendarTools(
    umbrellaId: string
): Promise<EnsureResult> {
    const { data: umbrella, error: readErr } = await supabase
        .from("vapi_umbrellas")
        .select("id, vapi_api_key_encrypted, calendar_tool_ids")
        .eq("id", umbrellaId)
        .single();

    if (readErr || !umbrella) {
        return {
            success: false,
            error: `Umbrella not found: ${readErr?.message || "unknown"}`,
        };
    }

    const existing: CalendarToolIdMap =
        (umbrella.calendar_tool_ids as CalendarToolIdMap | null) ?? {};

    const missing: CalendarToolName[] = CALENDAR_TOOL_NAMES.filter(
        (name) => !existing[name]
    );

    if (missing.length === 0) {
        return { success: true, toolIds: existing };
    }

    if (!umbrella.vapi_api_key_encrypted) {
        return {
            success: false,
            error: "Umbrella has no VAPI API key configured",
        };
    }

    const apiKey = safeDecrypt(umbrella.vapi_api_key_encrypted);
    if (!apiKey) {
        return { success: false, error: "Failed to decrypt umbrella VAPI key" };
    }

    const serverUrl = `${getAppUrl()}/api/vapi/tools/calendar`;
    const definitions = buildCalendarToolDefinitions(serverUrl);

    const next: CalendarToolIdMap = { ...existing };
    for (const name of missing) {
        const created = await createTool(
            definitions[name] as Record<string, unknown>,
            apiKey
        );
        if (!created?.id) {
            return {
                success: false,
                error: `Failed to create VAPI tool "${name}"`,
                toolIds: next,
            };
        }
        next[name] = created.id;
    }

    const { error: writeErr } = await supabase
        .from("vapi_umbrellas")
        .update({ calendar_tool_ids: next })
        .eq("id", umbrellaId);

    if (writeErr) {
        return {
            success: false,
            error: `Tools created in VAPI but DB write failed: ${writeErr.message}`,
            toolIds: next,
        };
    }

    return { success: true, toolIds: next };
}

/**
 * Convenience wrapper: ensure tools exist, then return the map. Use this from
 * agent-deployment actions so callers don't have to do the two-step.
 *
 * Returns null on failure — the caller should fall back to inlining the
 * calendar tools (current pre-globalization behavior) so deployments don't
 * fail catastrophically just because the bootstrap didn't run.
 */
export async function getUmbrellaCalendarToolIds(
    umbrellaId: string
): Promise<CalendarToolIdMap | null> {
    const result = await ensureUmbrellaCalendarTools(umbrellaId);
    if (!result.success || !result.toolIds) {
        console.warn(
            "[UMBRELLA TOOLS] Failed to ensure calendar tools, falling back to inline:",
            result.error
        );
        return null;
    }
    // Defensive: only return the map if every key is present so callers don't
    // half-reference and end up with a missing tool at runtime.
    const complete = CALENDAR_TOOL_NAMES.every((name) => result.toolIds?.[name]);
    return complete ? result.toolIds : null;
}

/**
 * Resolve calendar tool IDs for a given client. Returns null for CUSTOM
 * accounts (they keep inline calendar tools), or for UMBRELLA clients where
 * the bootstrap hasn't completed (caller falls back to inline).
 *
 * One round-trip per call. Cheap to invoke from agent-deployment actions.
 */
export async function getCalendarToolIdsForClient(
    clientId: string
): Promise<CalendarToolIdMap | null> {
    const { data: client } = await supabase
        .from("clients")
        .select("account_type")
        .eq("id", clientId)
        .single();

    if (!client || client.account_type !== "UMBRELLA") return null;

    const { data: assignment } = await supabase
        .from("tenant_vapi_assignments")
        .select("umbrella_id")
        .eq("client_id", clientId)
        .single();

    if (!assignment?.umbrella_id) return null;

    return await getUmbrellaCalendarToolIds(assignment.umbrella_id);
}
