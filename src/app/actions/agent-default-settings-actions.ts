"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export interface AgentDefaultSettings {
    id: string;
    direction: "inbound" | "outbound";
    settings: Record<string, any>;
    updated_at: string;
}

export async function getAgentDefaultSettings(
    direction: "inbound" | "outbound"
): Promise<AgentDefaultSettings | null> {
    const { data, error } = await supabase
        .from("agent_default_settings")
        .select("*")
        .eq("id", direction)
        .single();

    if (error || !data) return null;
    return data as AgentDefaultSettings;
}

export async function getAllAgentDefaultSettings(): Promise<{
    inbound: AgentDefaultSettings | null;
    outbound: AgentDefaultSettings | null;
}> {
    const { data, error } = await supabase
        .from("agent_default_settings")
        .select("*");

    if (error || !data) {
        return { inbound: null, outbound: null };
    }

    const inbound = data.find((d: any) => d.id === "inbound") as AgentDefaultSettings | undefined;
    const outbound = data.find((d: any) => d.id === "outbound") as AgentDefaultSettings | undefined;

    return {
        inbound: inbound || null,
        outbound: outbound || null,
    };
}

export async function updateAgentDefaultSettings(
    direction: "inbound" | "outbound",
    settings: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
        .from("agent_default_settings")
        .upsert(
            {
                id: direction,
                direction,
                settings,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
        );

    if (error) {
        console.error("[AGENT DEFAULTS] Failed to update:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/settings");
    return { success: true };
}
