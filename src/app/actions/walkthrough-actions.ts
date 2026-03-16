"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function completeWalkthrough(clientId: string) {
    const { error } = await supabase
        .from("tenant_profiles")
        .update({
            walkthrough_completed: true,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    if (error) {
        console.error("completeWalkthrough error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}`);
    return { success: true };
}
