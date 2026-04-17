import "server-only";
import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption-helpers";

/**
 * Single choke point for resolving a client's VAPI API key.
 *
 * - Looks up the client row.
 * - Decrypts the stored ciphertext (tolerates legacy plaintext via safeDecrypt).
 * - Returns null if the client doesn't exist or has no key set.
 *
 * Every server action, page, and API route that needs to call VAPI on behalf
 * of a tenant MUST go through this helper. Do not call
 * `supabase.from("clients").select("vapi_key")` directly — that bypasses the
 * decryption + audit path and makes future key-storage changes a grep-the-codebase
 * exercise.
 */
export async function getClientVapiKey(clientId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from("clients")
        .select("vapi_key")
        .eq("id", clientId)
        .single();

    if (error || !data?.vapi_key) return null;
    return safeDecrypt(data.vapi_key);
}

/**
 * Fetch a client's VAPI key alongside other client fields in a single query.
 * Returns the client row with `vapi_key` replaced by the decrypted value
 * (or null if no key). Use this when you already need other client columns —
 * avoids a second round-trip.
 */
export async function getClientWithVapiKey<T extends Record<string, unknown>>(
    clientId: string,
    additionalColumns: string[] = []
): Promise<(T & { vapi_key: string | null }) | null> {
    const columns = ["vapi_key", ...additionalColumns].join(", ");
    const { data, error } = await supabase
        .from("clients")
        .select(columns)
        .eq("id", clientId)
        .single();

    if (error || !data) return null;
    const row = data as unknown as T & { vapi_key: string | null };
    return {
        ...row,
        vapi_key: row.vapi_key ? safeDecrypt(row.vapi_key) : null,
    };
}
