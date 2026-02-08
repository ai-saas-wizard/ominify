"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

// ─── READ OPERATIONS ───

export async function getUmbrellas() {
    const { data, error } = await supabase
        .from("vapi_umbrellas")
        .select("id, name, umbrella_type, concurrency_limit, current_concurrency, max_tenants, is_active, notes, created_at")
        .eq("is_active", true)
        .order("name");

    if (error) {
        console.error("getUmbrellas error:", error);
        return [];
    }
    return data || [];
}

export async function getUmbrellaWithTenants(umbrellaId: string) {
    const { data: umbrella, error: umbrellaError } = await supabase
        .from("vapi_umbrellas")
        .select("*")
        .eq("id", umbrellaId)
        .single();

    if (umbrellaError || !umbrella) {
        return { umbrella: null, tenants: [] };
    }

    const { data: assignments } = await supabase
        .from("tenant_vapi_assignments")
        .select(`
            id,
            client_id,
            tenant_concurrency_cap,
            priority_weight,
            assigned_at,
            assigned_by,
            is_active,
            clients (id, name, email, account_type)
        `)
        .eq("umbrella_id", umbrellaId)
        .eq("is_active", true)
        .order("assigned_at", { ascending: false });

    return { umbrella, tenants: assignments || [] };
}

export async function getUmbrellasWithStats() {
    const { data: umbrellas } = await supabase
        .from("vapi_umbrellas")
        .select("*")
        .eq("is_active", true)
        .order("name");

    if (!umbrellas) return [];

    // Get tenant counts per umbrella
    const result = [];
    for (const umbrella of umbrellas) {
        const { count } = await supabase
            .from("tenant_vapi_assignments")
            .select("*", { count: "exact", head: true })
            .eq("umbrella_id", umbrella.id)
            .eq("is_active", true);

        result.push({
            ...umbrella,
            tenant_count: count || 0,
        });
    }

    return result;
}

// ─── WRITE OPERATIONS ───

export async function createUmbrella(formData: FormData) {
    const name = formData.get("name") as string;
    const vapiApiKey = formData.get("vapi_api_key") as string;
    const umbrellaType = (formData.get("umbrella_type") as string) || "shared";
    const concurrencyLimit = parseInt(formData.get("concurrency_limit") as string) || 10;
    const maxTenants = formData.get("max_tenants") ? parseInt(formData.get("max_tenants") as string) : null;
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
        max_tenants: maxTenants,
        notes,
    });

    if (error) {
        console.error("createUmbrella error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/umbrellas");
    return { success: true };
}

export async function updateUmbrella(umbrellaId: string, formData: FormData) {
    const name = formData.get("name") as string;
    const concurrencyLimit = parseInt(formData.get("concurrency_limit") as string);
    const maxTenants = formData.get("max_tenants") ? parseInt(formData.get("max_tenants") as string) : null;
    const notes = formData.get("notes") as string;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name;
    if (concurrencyLimit) updateData.concurrency_limit = concurrencyLimit;
    if (maxTenants !== undefined) updateData.max_tenants = maxTenants;
    if (notes !== undefined) updateData.notes = notes;

    const { error } = await supabase
        .from("vapi_umbrellas")
        .update(updateData)
        .eq("id", umbrellaId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/umbrellas");
    return { success: true };
}

export async function deactivateUmbrella(umbrellaId: string) {
    // Check if any active tenants are assigned
    const { count } = await supabase
        .from("tenant_vapi_assignments")
        .select("*", { count: "exact", head: true })
        .eq("umbrella_id", umbrellaId)
        .eq("is_active", true);

    if (count && count > 0) {
        return { success: false, error: `Cannot deactivate: ${count} active tenant(s) still assigned. Migrate them first.` };
    }

    const { error } = await supabase
        .from("vapi_umbrellas")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", umbrellaId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/umbrellas");
    return { success: true };
}

export async function migrateTenant(
    clientId: string,
    targetUmbrellaId: string,
    reason: string = "manual",
    migratedBy: string = "admin"
) {
    // Get current assignment
    const { data: current } = await supabase
        .from("tenant_vapi_assignments")
        .select("umbrella_id")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .single();

    const fromUmbrellaId = current?.umbrella_id || null;

    if (fromUmbrellaId === targetUmbrellaId) {
        return { success: false, error: "Tenant is already in this umbrella" };
    }

    // Update assignment
    const { error: updateError } = await supabase
        .from("tenant_vapi_assignments")
        .update({
            umbrella_id: targetUmbrellaId,
            assigned_at: new Date().toISOString(),
            assigned_by: migratedBy,
        })
        .eq("client_id", clientId)
        .eq("is_active", true);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    // Log migration
    await supabase.from("vapi_umbrella_migrations").insert({
        client_id: clientId,
        from_umbrella_id: fromUmbrellaId,
        to_umbrella_id: targetUmbrellaId,
        reason,
        migrated_by: migratedBy,
    });

    // Update client's vapi_key and vapi_org_id to match new umbrella
    const { data: newUmbrella } = await supabase
        .from("vapi_umbrellas")
        .select("vapi_api_key_encrypted, vapi_org_id")
        .eq("id", targetUmbrellaId)
        .single();

    if (newUmbrella) {
        await supabase
            .from("clients")
            .update({
                vapi_key: newUmbrella.vapi_api_key_encrypted,
                vapi_org_id: newUmbrella.vapi_org_id,
            })
            .eq("id", clientId);
    }

    revalidatePath("/admin/umbrellas");
    revalidatePath("/admin/clients");
    return { success: true };
}
