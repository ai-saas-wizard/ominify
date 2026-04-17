"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";

/**
 * Toggle the subscription_grandfathered flag on a client. Grandfathered
 * clients bypass the subscription paywall (but still obey the zero-minute
 * call block). Used for comp'd accounts and existing clients from before
 * the paywall rollout.
 */
export async function toggleClientGrandfather(clientId: string, value: boolean) {
    const { error } = await supabase
        .from("clients")
        .update({ subscription_grandfathered: value })
        .eq("id", clientId);

    if (error) {
        throw new Error(`Failed to update grandfather flag: ${error.message}`);
    }

    await auditLog(
        "toggle_subscription_grandfather",
        { type: "client", id: clientId },
        { value }
    );

    revalidatePath("/admin/clients");
}

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
