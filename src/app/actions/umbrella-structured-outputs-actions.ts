"use server";

import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption-helpers";
import { createStructuredOutput, getStructuredOutput } from "@/lib/vapi";
import {
    RE_STRUCTURED_OUTPUT_NAME,
    RE_STRUCTURED_OUTPUT_DESCRIPTION,
    RE_STRUCTURED_OUTPUT_SCHEMA,
} from "@/lib/verticals/real-estate-investor/structured-output";

// ═══════════════════════════════════════════════════════════
// UMBRELLA-SCOPED REUSABLE VAPI STRUCTURED OUTPUTS
//
// The RE Investor structured output is byte-identical across every UMBRELLA
// tenant. We register it ONCE per umbrella in VAPI, store its ID on
// `vapi_umbrellas.re_structured_output_id`, and every new UMBRELLA RE
// assistant references it via `artifactPlan.structuredOutputIds` instead
// of inlining the analysisPlan.structuredDataSchema (~100 lines).
//
// Idempotent. To force a recreate (e.g. after a schema bump), set the
// column to NULL and the next ensure call will POST a fresh one.
//
// Same posture as `ensureUmbrellaCalendarTools` — see
// umbrella-tools-actions.ts for the precedent.
// ═══════════════════════════════════════════════════════════

interface EnsureResult {
    success: boolean;
    structuredOutputId?: string;
    error?: string;
}

/**
 * Ensures the RE structured output exists on the umbrella's VAPI account.
 * - Reads any existing ID from `vapi_umbrellas.re_structured_output_id`.
 * - If null, POSTs a fresh structured output to VAPI's /structured-output API.
 * - Persists the returned ID back to the umbrellas row.
 *
 * Safe to call repeatedly. Re-running with an ID present is a single DB
 * read with no VAPI calls.
 */
export async function ensureUmbrellaREStructuredOutput(
    umbrellaId: string
): Promise<EnsureResult> {
    const { data: umbrella, error: readErr } = await supabase
        .from("vapi_umbrellas")
        .select("id, vapi_api_key_encrypted, re_structured_output_id")
        .eq("id", umbrellaId)
        .single();

    if (readErr) {
        // PostgREST 42703 = column does not exist. Means migration
        // 20260502-umbrella-re-structured-output-id.sql hasn't run on this
        // database yet. Treat as success-with-no-id so the caller falls back
        // to inline analysisPlan (current pre-globalization behavior).
        if ((readErr as any).code === "42703") {
            console.warn(
                "[UMBRELLA STRUCTURED OUTPUT] Column re_structured_output_id missing — run migration 20260502-umbrella-re-structured-output-id.sql. Falling back to inline analysisPlan."
            );
            return { success: true };
        }
        return {
            success: false,
            error: `Umbrella read failed: ${readErr.message}`,
        };
    }

    if (!umbrella) {
        return { success: false, error: "Umbrella not found" };
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

    // Preflight: if a stored ID exists, verify VAPI still recognizes it.
    // Catches stale IDs left behind by manual key rotation in VAPI's
    // dashboard (the Omnify update path clears the column automatically).
    if (umbrella.re_structured_output_id) {
        const existing = await getStructuredOutput(
            umbrella.re_structured_output_id,
            apiKey
        );
        if (existing?.id) {
            return {
                success: true,
                structuredOutputId: umbrella.re_structured_output_id,
            };
        }
        console.warn(
            `[UMBRELLA STRUCTURED OUTPUT] Stored ID ${umbrella.re_structured_output_id} not found in VAPI; recreating.`
        );
        await supabase
            .from("vapi_umbrellas")
            .update({ re_structured_output_id: null })
            .eq("id", umbrellaId);
    }

    const created = await createStructuredOutput(
        {
            name: RE_STRUCTURED_OUTPUT_NAME,
            description: RE_STRUCTURED_OUTPUT_DESCRIPTION,
            schema: RE_STRUCTURED_OUTPUT_SCHEMA,
            type: "ai",
        },
        apiKey
    );

    if (
        !created?.id ||
        typeof created.id !== "string" ||
        !/^[a-f0-9-]{8,}$/i.test(created.id)
    ) {
        console.error(
            "[UMBRELLA STRUCTURED OUTPUT] Malformed VAPI response:",
            created
        );
        return {
            success: false,
            error: "VAPI returned malformed structured output response",
        };
    }

    const { error: writeErr } = await supabase
        .from("vapi_umbrellas")
        .update({ re_structured_output_id: created.id })
        .eq("id", umbrellaId);

    if (writeErr) {
        return {
            success: false,
            error: `Structured output created in VAPI (id=${created.id}) but DB write failed: ${writeErr.message}`,
            structuredOutputId: created.id,
        };
    }

    return { success: true, structuredOutputId: created.id };
}

/**
 * Convenience wrapper: ensure exists, then return the ID. Use this from
 * agent-deployment actions so callers don't have to do the two-step.
 *
 * Returns null on failure — the caller falls back to inlining
 * analysisPlan.structuredDataSchema (current pre-globalization behavior)
 * so deployments don't fail catastrophically just because the bootstrap
 * didn't run.
 */
export async function getUmbrellaREStructuredOutputId(
    umbrellaId: string
): Promise<string | null> {
    const result = await ensureUmbrellaREStructuredOutput(umbrellaId);
    if (result.error) {
        console.warn(
            "[UMBRELLA STRUCTURED OUTPUT] Failed to ensure RE structured output, falling back to inline:",
            result.error
        );
    }
    return result.structuredOutputId ?? null;
}

/**
 * Resolve the RE structured output ID for a given client. Returns null for
 * CUSTOM accounts (they keep the inline analysisPlan), or for UMBRELLA
 * clients where the bootstrap hasn't completed (caller falls back to inline).
 *
 * One round-trip per call. Cheap to invoke from agent-deployment actions.
 */
export async function getREStructuredOutputIdForClient(
    clientId: string
): Promise<string | null> {
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

    return await getUmbrellaREStructuredOutputId(assignment.umbrella_id);
}
