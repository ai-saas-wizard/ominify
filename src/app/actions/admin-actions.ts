"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export interface AgentPricing {
    id: string;
    name: string;
    vapi_id: string;
    price_per_minute: number | null;
    cost_per_minute: number | null;
}

export async function getAgentsForClient(clientId: string): Promise<AgentPricing[]> {
    const { data, error } = await supabase
        .from('agents')
        .select('id, name, vapi_id, price_per_minute, cost_per_minute')
        .eq('client_id', clientId)
        .order('name');

    if (error) {
        console.error("Error fetching agents:", error);
        return [];
    }

    return data || [];
}

export async function updateAgentPricing(agentId: string, price: number | null, cost: number | null) {
    const { error } = await supabase
        .from('agents')
        .update({
            price_per_minute: price,
            cost_per_minute: cost,
            updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

    if (error) {
        throw new Error(`Failed to update agent pricing: ${error.message}`);
    }

    revalidatePath("/admin/billing");
}
