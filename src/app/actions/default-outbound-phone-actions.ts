"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export interface OutboundPhoneOption {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    vapi_phone_number_id: string | null;
}

export interface OutboundCallerIdState {
    defaultPhoneId: string | null;
    available: OutboundPhoneOption[];
}

export async function getOutboundCallerIdState(
    clientId: string
): Promise<OutboundCallerIdState> {
    const [{ data: profile }, { data: phones }] = await Promise.all([
        supabase
            .from("tenant_profiles")
            .select("default_outbound_phone_id")
            .eq("client_id", clientId)
            .single(),
        supabase
            .from("tenant_phone_numbers")
            .select("id, phone_number, friendly_name, vapi_phone_number_id")
            .eq("client_id", clientId)
            .eq("status", "active")
            .order("created_at", { ascending: true }),
    ]);

    return {
        defaultPhoneId: (profile?.default_outbound_phone_id as string | null) ?? null,
        available: (phones ?? []) as OutboundPhoneOption[],
    };
}

export async function setDefaultOutboundPhone(
    clientId: string,
    phoneNumberId: string | null
): Promise<{ success: boolean; error?: string }> {
    if (phoneNumberId) {
        const { data: phone } = await supabase
            .from("tenant_phone_numbers")
            .select("id, status, vapi_phone_number_id")
            .eq("id", phoneNumberId)
            .eq("client_id", clientId)
            .single();

        if (!phone) {
            return { success: false, error: "Phone number not found for this client" };
        }
        if (phone.status !== "active") {
            return { success: false, error: "Phone number is not active" };
        }
        if (!phone.vapi_phone_number_id) {
            return {
                success: false,
                error: "Phone number is not registered with VAPI yet — sync it from the Phone Numbers page first",
            };
        }
    }

    const { error } = await supabase
        .from("tenant_profiles")
        .update({ default_outbound_phone_id: phoneNumberId })
        .eq("client_id", clientId);

    if (error) {
        console.error("setDefaultOutboundPhone error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/settings/outbound-caller-id`);
    revalidatePath(`/client/${clientId}/settings`);
    return { success: true };
}
