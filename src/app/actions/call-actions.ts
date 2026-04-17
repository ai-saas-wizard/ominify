"use server";

import { supabase } from "@/lib/supabase";
import { endCall } from "@/lib/vapi";
import { getClientVapiKey } from "@/lib/client-secrets";

export async function endActiveCall(clientId: string, vapiCallId: string) {
    try {
        // Resolve the client's Vapi API key (decrypted)
        const vapiKey = await getClientVapiKey(clientId);
        if (!vapiKey) {
            return { success: false, error: "Client not found or missing Vapi API key" };
        }

        // End the call via Vapi API
        const success = await endCall(vapiCallId, vapiKey);

        if (!success) {
            return { success: false, error: "Failed to end call via Vapi API" };
        }

        // Remove from active_calls table
        await supabase
            .from("active_calls")
            .delete()
            .eq("vapi_call_id", vapiCallId);

        return { success: true };
    } catch (error) {
        console.error("Error ending call:", error);
        return { success: false, error: "Internal error" };
    }
}
