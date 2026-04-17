"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt, secretLastChars } from "@/lib/encryption-helpers";
import { auditLog } from "@/lib/audit";
import { requireRateLimit, RATE_POLICIES, userActionKey } from "@/lib/rate-limit";

// ─── READ OPERATIONS ───

/**
 * Server-internal fetch of the active umbrella including its raw (encrypted)
 * VAPI key. ONLY callable from server code that actually needs the key
 * (assistant creation, agent deployment, etc). Never pass the result to a
 * Client Component — the plaintext key would ship to the browser.
 */
export async function getActiveUmbrellaWithRawKey() {
    const { data, error } = await supabase
        .from("vapi_umbrellas")
        .select("id, name, umbrella_type, vapi_api_key_encrypted, vapi_org_id, concurrency_limit, current_concurrency, max_tenants, is_active, notes, created_at")
        .eq("is_active", true)
        .limit(1)
        .single();

    if (error) {
        console.error("getActiveUmbrellaWithRawKey error:", error);
        return null;
    }
    return data;
}

/**
 * Get the active umbrella's decrypted VAPI API key.
 * Returns null if no umbrella exists or has no key set.
 */
export async function getActiveUmbrellaDecryptedKey(): Promise<string | null> {
    const umbrella = await getActiveUmbrellaWithRawKey();
    if (!umbrella?.vapi_api_key_encrypted) return null;
    return safeDecrypt(umbrella.vapi_api_key_encrypted);
}

/**
 * Default fetch of the active umbrella WITHOUT the raw key.
 * Safe to pass through to pages / Client Components.
 * Use getActiveUmbrellaWithRawKey() in server code that actually needs to call VAPI.
 */
export async function getActiveUmbrella() {
    const { data, error } = await supabase
        .from("vapi_umbrellas")
        .select("id, name, umbrella_type, vapi_org_id, concurrency_limit, current_concurrency, max_tenants, is_active, notes, created_at")
        .eq("is_active", true)
        .limit(1)
        .single();

    if (error) {
        console.error("getActiveUmbrella error:", error);
        return null;
    }
    return data;
}

export async function getActiveUmbrellaWithStats() {
    const umbrella = await getActiveUmbrella();
    if (!umbrella) return null;

    const { count } = await supabase
        .from("tenant_vapi_assignments")
        .select("*", { count: "exact", head: true })
        .eq("umbrella_id", umbrella.id)
        .eq("is_active", true);

    return {
        ...umbrella,
        tenant_count: count || 0,
    };
}

/**
 * Sanitized umbrella view for admin pages / Client Components.
 * Includes tenant count and masked key preview — never the raw or encrypted key.
 */
export async function getActiveUmbrellaForAdminView() {
    const umbrella = await getActiveUmbrellaWithRawKey();
    if (!umbrella) return null;

    const { count } = await supabase
        .from("tenant_vapi_assignments")
        .select("*", { count: "exact", head: true })
        .eq("umbrella_id", umbrella.id)
        .eq("is_active", true);

    // Strip the raw encrypted key and replace with a masked preview.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vapi_api_key_encrypted, ...safe } = umbrella;
    return {
        ...safe,
        tenant_count: count || 0,
        key_last_four: secretLastChars(vapi_api_key_encrypted, 4),
        has_key: !!vapi_api_key_encrypted,
    };
}

// ─── WRITE OPERATIONS ───

export async function createUmbrella(formData: FormData) {
    const { userId } = await auth();
    try {
        requireRateLimit(userActionKey(userId, "createUmbrella"), RATE_POLICIES.keyRotation);
    } catch (err: any) {
        return { success: false, error: err.message };
    }

    // Guard: only one active umbrella allowed
    const existing = await getActiveUmbrella();
    if (existing) {
        return { success: false, error: "An umbrella already exists. Update it in Settings instead." };
    }

    const name = formData.get("name") as string;
    const vapiApiKey = formData.get("vapi_api_key") as string;
    const umbrellaType = (formData.get("umbrella_type") as string) || "shared";
    const concurrencyLimit = parseInt(formData.get("concurrency_limit") as string) || 10;
    const notes = formData.get("notes") as string;

    if (!name || !vapiApiKey) {
        return { success: false, error: "Name and Vapi API Key are required" };
    }

    // Try to extract org ID from the key by making a test API call
    let vapiOrgId = null;
    try {
        const res = await fetch("https://api.vapi.ai/assistant", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${vapiApiKey}`,
            },
        });
        if (res.ok) {
            const agents = await res.json();
            if (Array.isArray(agents) && agents.length > 0 && agents[0].orgId) {
                vapiOrgId = agents[0].orgId;
            }
        }
    } catch {
        // Non-fatal — org ID can be populated later
    }

    const { error } = await supabase.from("vapi_umbrellas").insert({
        name,
        umbrella_type: umbrellaType,
        vapi_api_key_encrypted: encrypt(vapiApiKey),
        vapi_org_id: vapiOrgId,
        concurrency_limit: concurrencyLimit,
        notes,
    });

    if (error) {
        console.error("createUmbrella error:", error);
        return { success: false, error: error.message };
    }

    await auditLog(
        "create_umbrella",
        { type: "umbrella", id: name },
        { umbrellaType, concurrencyLimit }
    );

    revalidatePath("/admin/settings");
    return { success: true };
}

export async function updateUmbrella(umbrellaId: string, formData: FormData) {
    const { userId } = await auth();
    const vapiApiKeyRaw = formData.get("vapi_api_key") as string;
    // If this update rotates a key, apply the strict keyRotation limit;
    // otherwise fall back to the general adminWrite limit.
    const policy = vapiApiKeyRaw ? RATE_POLICIES.keyRotation : RATE_POLICIES.adminWrite;
    try {
        requireRateLimit(userActionKey(userId, "updateUmbrella"), policy);
    } catch (err: any) {
        return { success: false, error: err.message };
    }

    const name = formData.get("name") as string;
    const concurrencyLimit = parseInt(formData.get("concurrency_limit") as string);
    const notes = formData.get("notes") as string;
    const vapiApiKey = vapiApiKeyRaw;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name;
    if (concurrencyLimit) updateData.concurrency_limit = concurrencyLimit;
    if (notes !== undefined) updateData.notes = notes;

    // Encrypt the new VAPI key before storing it.
    const encryptedVapiKey = vapiApiKey ? encrypt(vapiApiKey) : null;
    if (encryptedVapiKey) updateData.vapi_api_key_encrypted = encryptedVapiKey;

    const { error } = await supabase
        .from("vapi_umbrellas")
        .update(updateData)
        .eq("id", umbrellaId);

    if (error) {
        return { success: false, error: error.message };
    }

    // If VAPI key changed, propagate the (already encrypted) value to all
    // UMBRELLA clients using this umbrella. Storing ciphertext here matches
    // the new storage format in clients.vapi_key.
    let propagatedClientCount = 0;
    if (encryptedVapiKey) {
        const { data: assignments } = await supabase
            .from("tenant_vapi_assignments")
            .select("client_id")
            .eq("umbrella_id", umbrellaId)
            .eq("is_active", true);

        if (assignments && assignments.length > 0) {
            const clientIds = assignments.map((a) => a.client_id);
            await supabase
                .from("clients")
                .update({ vapi_key: encryptedVapiKey })
                .in("id", clientIds);
            propagatedClientCount = clientIds.length;
        }
    }

    // Audit: record the fact that the umbrella was updated. Never log the
    // raw key — just which fields changed.
    await auditLog(
        "update_umbrella",
        { type: "umbrella", id: umbrellaId },
        {
            changedFields: Object.keys(updateData).filter(k => k !== "updated_at"),
            keyRotated: !!encryptedVapiKey,
            propagatedClientCount,
        }
    );

    revalidatePath("/admin/settings");
    return { success: true };
}
