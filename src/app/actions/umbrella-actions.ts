"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

// ─── READ OPERATIONS ───

export async function getActiveUmbrella() {
    const { data, error } = await supabase
        .from("vapi_umbrellas")
        .select("id, name, umbrella_type, vapi_api_key_encrypted, vapi_org_id, concurrency_limit, current_concurrency, max_tenants, is_active, notes, created_at")
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

// ─── WRITE OPERATIONS ───

export async function createUmbrella(formData: FormData) {
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
        vapi_api_key_encrypted: vapiApiKey, // TODO: encrypt before storing
        vapi_org_id: vapiOrgId,
        concurrency_limit: concurrencyLimit,
        notes,
    });

    if (error) {
        console.error("createUmbrella error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/settings");
    return { success: true };
}

export async function updateUmbrella(umbrellaId: string, formData: FormData) {
    const name = formData.get("name") as string;
    const concurrencyLimit = parseInt(formData.get("concurrency_limit") as string);
    const notes = formData.get("notes") as string;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name;
    if (concurrencyLimit) updateData.concurrency_limit = concurrencyLimit;
    if (notes !== undefined) updateData.notes = notes;

    const { error } = await supabase
        .from("vapi_umbrellas")
        .update(updateData)
        .eq("id", umbrellaId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/settings");
    return { success: true };
}
