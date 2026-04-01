"use server";

import { supabase } from "@/lib/supabase";
import { randomBytes, createHash } from "crypto";
import type { ClientApiKey } from "@/types/pipeline";

function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}

function generateKey(): string {
    return `omni_${randomBytes(24).toString("hex")}`;
}

export async function createApiKey(
    clientId: string,
    name: string
): Promise<{ success: boolean; key?: string; data?: ClientApiKey; error?: string }> {
    try {
        const plainKey = generateKey();
        const keyHash = hashKey(plainKey);
        const keyPrefix = plainKey.substring(0, 12) + "...";

        const { data, error } = await supabase
            .from("client_api_keys")
            .insert({
                client_id: clientId,
                key_hash: keyHash,
                key_prefix: keyPrefix,
                name: name || "API Key",
                is_active: true,
            })
            .select("id, client_id, key_prefix, name, is_active, last_used_at, created_at")
            .single();

        if (error) {
            console.error("createApiKey error:", error);
            return { success: false, error: error.message };
        }

        // Return the plain key only on creation — it's never stored
        return { success: true, key: plainKey, data: data as ClientApiKey };
    } catch (error: any) {
        console.error("createApiKey error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function listApiKeys(clientId: string): Promise<{
    success: boolean;
    keys: ClientApiKey[];
    error?: string;
}> {
    try {
        const { data, error } = await supabase
            .from("client_api_keys")
            .select("id, client_id, key_prefix, name, is_active, last_used_at, created_at")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("listApiKeys error:", error);
            return { success: false, keys: [], error: error.message };
        }

        return { success: true, keys: (data || []) as ClientApiKey[] };
    } catch (error: any) {
        console.error("listApiKeys error:", error);
        return { success: false, keys: [], error: error?.message || "Internal error" };
    }
}

export async function deleteApiKey(keyId: string) {
    try {
        const { error } = await supabase
            .from("client_api_keys")
            .delete()
            .eq("id", keyId);

        if (error) {
            console.error("deleteApiKey error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("deleteApiKey error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function toggleApiKey(keyId: string, isActive: boolean) {
    try {
        const { error } = await supabase
            .from("client_api_keys")
            .update({ is_active: isActive })
            .eq("id", keyId);

        if (error) {
            console.error("toggleApiKey error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("toggleApiKey error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function rotateApiKey(
    keyId: string,
    clientId: string,
    name: string
): Promise<{ success: boolean; key?: string; data?: ClientApiKey; error?: string }> {
    try {
        // Deactivate old key
        await supabase
            .from("client_api_keys")
            .update({ is_active: false })
            .eq("id", keyId);

        // Create new key
        return await createApiKey(clientId, name);
    } catch (error: any) {
        console.error("rotateApiKey error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

/**
 * Validate an API key for a client. Used by the Lead Creation API endpoint.
 * Returns the key record if valid, null if invalid.
 */
export async function validateApiKey(
    clientId: string,
    key: string
): Promise<{ valid: boolean; keyId?: string }> {
    try {
        const keyHash = hashKey(key);

        const { data, error } = await supabase
            .from("client_api_keys")
            .select("id")
            .eq("client_id", clientId)
            .eq("key_hash", keyHash)
            .eq("is_active", true)
            .single();

        if (error || !data) {
            return { valid: false };
        }

        // Update last_used_at
        await supabase
            .from("client_api_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", data.id);

        return { valid: true, keyId: data.id };
    } catch {
        return { valid: false };
    }
}
