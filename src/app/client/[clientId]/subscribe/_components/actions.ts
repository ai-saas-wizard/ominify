"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { canAccessClient } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Post-signup tier pick. Customer arrived on /client/<id>/subscribe in
 * "picker mode" (signup_offer_id set, pricing_tier_id null). Submitting a
 * tier card runs this action: validates auth + ownership + tier eligibility,
 * commits `clients.pricing_tier_id`, and redirects back to the subscribe
 * page which will now render the single-tier subscribe view → Stripe
 * Checkout.
 *
 * Defense-in-depth: we re-check that the selected tier belongs to the
 * client's signup_offer_id (prevents tier injection from a tampered form).
 */
export async function selectClientTierAction(formData: FormData): Promise<void> {
    const { userId } = await auth();
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress;
    if (!userId || !email) redirect("/sign-in");

    const clientId = String(formData.get("client_id") ?? "").trim();
    const tierId = String(formData.get("tier_id") ?? "").trim();
    if (!clientId || !tierId) {
        console.warn(`[selectClientTierAction] missing form fields client=${clientId} tier=${tierId}`);
        redirect("/");
    }

    const ok =
        (await canAccessClient(email, clientId)) ||
        (await canAccessClient(userId, clientId));
    if (!ok) {
        console.warn(`[selectClientTierAction] access denied: user=${userId} client=${clientId}`);
        redirect("/");
    }

    const { data: client } = await supabase
        .from("clients")
        .select("signup_offer_id, pricing_tier_id")
        .eq("id", clientId)
        .maybeSingle();

    if (!client?.signup_offer_id) {
        // Either the customer is already on a tier or they were never on a
        // multi-tier offer flow. Bounce them back to the subscribe page to
        // get re-routed correctly.
        redirect(`/client/${clientId}/subscribe`);
    }

    const { data: tier } = await supabase
        .from("pricing_tiers")
        .select("id, is_active, offer_id")
        .eq("id", tierId)
        .maybeSingle();

    if (!tier || !tier.is_active || tier.offer_id !== client.signup_offer_id) {
        // Tier doesn't exist, is inactive, or belongs to a different offer —
        // silent reject (no enumeration leak). Customer ends up back on the
        // picker.
        console.warn(
            `[selectClientTierAction] rejected tier=${tierId} for client=${clientId} (active=${tier?.is_active}, tier.offer=${tier?.offer_id}, client.offer=${client.signup_offer_id})`
        );
        redirect(`/client/${clientId}/subscribe`);
    }

    const { error } = await supabase
        .from("clients")
        .update({
            pricing_tier_id: tierId,
            updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);

    if (error) {
        console.error(`[selectClientTierAction] failed to update client tier`, error);
        redirect(`/client/${clientId}/subscribe`);
    }

    console.log(
        `[selectClientTierAction] client=${clientId} picked tier=${tierId} (offer=${client.signup_offer_id})`
    );

    redirect(`/client/${clientId}/subscribe`);
}
