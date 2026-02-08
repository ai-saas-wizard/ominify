"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function createClientAction(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const type = formData.get("type") as string;
    const vapi_key = formData.get("vapi_key") as string;

    // ─── TYPE A (CUSTOM): Requires Vapi Key ───
    if (type === "CUSTOM") {
        if (!name || !vapi_key) {
            return { success: false, error: "Name and Vapi Key are required" };
        }

        const placeholderClerkId = `pending_${crypto.randomUUID()}`;

        const { data: newClient, error } = await supabase.from("clients").insert({
            name,
            email,
            account_type: type,
            vapi_key,
            clerk_id: placeholderClerkId,
        }).select("id").single();

        if (error) {
            console.error("Create Client Error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath("/admin/clients");
        return { success: true, clientId: newClient?.id };
    }

    // ─── TYPE B (UMBRELLA): Uses agency credentials via umbrella ───
    if (type === "UMBRELLA") {
        const umbrellaId = formData.get("umbrella_id") as string;
        const tenantConcurrencyCap = parseInt(formData.get("tenant_concurrency_cap") as string) || 2;

        if (!name) {
            return { success: false, error: "Client name is required" };
        }
        if (!umbrellaId) {
            return { success: false, error: "Please select an umbrella" };
        }

        // Fetch umbrella's VAPI credentials
        const { data: umbrella, error: umbrellaError } = await supabase
            .from("vapi_umbrellas")
            .select("vapi_api_key_encrypted, vapi_org_id")
            .eq("id", umbrellaId)
            .single();

        if (umbrellaError || !umbrella) {
            return { success: false, error: "Selected umbrella not found" };
        }

        const placeholderClerkId = `pending_${crypto.randomUUID()}`;

        // Create the client record with umbrella's VAPI credentials
        const { data: newClient, error: clientError } = await supabase.from("clients").insert({
            name,
            email,
            account_type: "UMBRELLA",
            vapi_key: umbrella.vapi_api_key_encrypted,   // Use umbrella's VAPI key
            vapi_org_id: umbrella.vapi_org_id,
            clerk_id: placeholderClerkId,
        }).select("id").single();

        if (clientError || !newClient) {
            console.error("Create UMBRELLA Client Error:", clientError);
            return { success: false, error: clientError?.message || "Failed to create client" };
        }

        const clientId = newClient.id;

        // Create umbrella assignment
        const { error: assignError } = await supabase.from("tenant_vapi_assignments").insert({
            client_id: clientId,
            umbrella_id: umbrellaId,
            tenant_concurrency_cap: tenantConcurrencyCap,
            priority_weight: 1.0,
            assigned_by: "admin",
        });

        if (assignError) {
            console.error("Umbrella Assignment Error:", assignError);
            // Don't fail — client is created, assignment can be retried
        }

        // Create empty tenant profile (to be filled during onboarding)
        const { error: profileError } = await supabase.from("tenant_profiles").insert({
            client_id: clientId,
        });

        if (profileError) {
            console.error("Tenant Profile Error:", profileError);
            // Non-fatal — profile can be created during onboarding
        }

        // Create billing record (same as Type A)
        await supabase.from("client_billing").insert({
            client_id: clientId,
        });

        // Create minute balance (starts at 0)
        await supabase.from("minute_balances").insert({
            client_id: clientId,
            balance_minutes: 0,
            total_purchased_minutes: 0,
            total_used_minutes: 0,
        });

        revalidatePath("/admin/clients");
        return { success: true, clientId };
    }

    return { success: false, error: "Invalid account type" };
}
