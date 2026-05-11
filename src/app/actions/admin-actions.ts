"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";
import { isAdmin } from "@/lib/auth";

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

export type AssignPlanResult =
    | { ok: true }
    | { ok: false; error: string };

/**
 * Admin retag: assign a specific tier, an offer (picker mode), or clear both
 * for a client. Used for support cases where a customer signed up directly
 * without an offer cookie, or wants to switch between offers/tiers
 * post-signup.
 *
 * Safety:
 * - If the client already has an active Stripe subscription, this updates
 *   only our DB. Stripe billing is unchanged — admin must coordinate a
 *   cancel + resubscribe to truly switch what the customer is charged.
 * - `kind=tier` clears signup_offer_id; `kind=offer` clears pricing_tier_id;
 *   `kind=clear` clears both. The two columns are kept mutually exclusive.
 * - Audit row captures previous + next state for debugging.
 */
export async function assignClientPlanAction(
    formData: FormData
): Promise<AssignPlanResult> {
    const { userId } = await auth();
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress;
    if (!userId || !email) return { ok: false, error: "unauthorized" };
    const adminOk = (await isAdmin(email)) || (await isAdmin(userId));
    if (!adminOk) return { ok: false, error: "forbidden" };

    const clientId = String(formData.get("client_id") ?? "").trim();
    const kind = String(formData.get("kind") ?? "").trim();
    if (!clientId || !["tier", "offer", "clear"].includes(kind)) {
        return { ok: false, error: "missing or invalid fields" };
    }

    const { data: client } = await supabase
        .from("clients")
        .select("id, pricing_tier_id, signup_offer_id")
        .eq("id", clientId)
        .maybeSingle();
    if (!client) return { ok: false, error: "client not found" };

    let update: { pricing_tier_id: string | null; signup_offer_id: string | null };

    if (kind === "tier") {
        const tierId = String(formData.get("tier_id") ?? "").trim();
        if (!tierId) return { ok: false, error: "missing tier_id" };
        const { data: tier } = await supabase
            .from("pricing_tiers")
            .select("id, is_active")
            .eq("id", tierId)
            .maybeSingle();
        if (!tier || !tier.is_active) {
            return { ok: false, error: "tier not found or inactive" };
        }
        update = { pricing_tier_id: tierId, signup_offer_id: null };
    } else if (kind === "offer") {
        const offerId = String(formData.get("offer_id") ?? "").trim();
        if (!offerId) return { ok: false, error: "missing offer_id" };
        const { data: offer } = await supabase
            .from("offers")
            .select("id, is_active")
            .eq("id", offerId)
            .maybeSingle();
        if (!offer || !offer.is_active) {
            return { ok: false, error: "offer not found or inactive" };
        }
        const { count } = await supabase
            .from("pricing_tiers")
            .select("id", { count: "exact", head: true })
            .eq("offer_id", offerId)
            .eq("is_active", true);
        if (!count || count === 0) {
            return { ok: false, error: "offer has no active tiers" };
        }
        update = { pricing_tier_id: null, signup_offer_id: offerId };
    } else {
        update = { pricing_tier_id: null, signup_offer_id: null };
    }

    const { error } = await supabase
        .from("clients")
        .update({ ...update, updated_at: new Date().toISOString() })
        .eq("id", clientId);
    if (error) return { ok: false, error: error.message };

    await auditLog(
        "admin.assign_client_plan",
        { type: "client", id: clientId },
        {
            kind,
            previous: {
                pricing_tier_id: client.pricing_tier_id,
                signup_offer_id: client.signup_offer_id,
            },
            next: update,
        }
    );

    revalidatePath("/admin/clients");
    return { ok: true };
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
