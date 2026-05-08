"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { canAccessClient } from "@/lib/auth";

export async function recordOnboardingCallIntent(
    clientId: string
): Promise<{ success: boolean; error?: string }> {
    const { userId } = await auth();
    if (!userId) {
        return { success: false, error: "Not authenticated" };
    }

    const user = await currentUser();
    const userEmail = user?.emailAddresses[0]?.emailAddress;
    const lookupKey = userEmail || userId;

    const allowed = await canAccessClient(lookupKey, clientId);
    if (!allowed) {
        return { success: false, error: "Forbidden" };
    }

    const { data: existing } = await supabase
        .from("tenant_profiles")
        .select("onboarding_path")
        .eq("client_id", clientId)
        .maybeSingle();

    if (existing?.onboarding_path === "manual_call_booked") {
        return { success: true };
    }

    const { error } = await supabase
        .from("tenant_profiles")
        .upsert(
            {
                client_id: clientId,
                onboarding_path: "manual_call_pending",
                onboarding_call_requested_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            { onConflict: "client_id" }
        );

    if (error) {
        console.error("[onboarding-call] failed to record intent:", error);
        return { success: false, error: error.message };
    }

    return { success: true };
}
