import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessClient } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import {
    getPublicTier,
    getTierById,
} from "@/lib/pricing-tiers";
import { getOfferById, getTiersForOffer } from "@/lib/offers";
import { SubscribeView } from "./_components/subscribe-view";
import { TierPickerView } from "./_components/tier-picker-view";

export default async function SubscribePage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const { userId } = await auth();
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress;

    if (!userId || !user || !email) redirect("/sign-in");

    const access =
        (await canAccessClient(email, clientId)) ||
        (await canAccessClient(userId, clientId));
    if (!access) redirect("/");

    // If already subscribed / grandfathered / CUSTOM — skip the paywall.
    const subAccess = await hasActiveSubscription(clientId);
    if (subAccess.allowed) {
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("onboarding_completed")
            .eq("client_id", clientId)
            .maybeSingle();
        if (!profile?.onboarding_completed) {
            redirect(`/client/${clientId}/onboarding`);
        }
        redirect(`/client/${clientId}/agents`);
    }

    // Router: tier set → single-tier subscribe. signup_offer_id set → picker.
    // Both null / unresolvable → defensive fallback to the public tier.
    const { data: client } = await supabase
        .from("clients")
        .select("pricing_tier_id, signup_offer_id")
        .eq("id", clientId)
        .maybeSingle();

    if (client?.pricing_tier_id) {
        const tier = await getTierById(client.pricing_tier_id);
        if (tier) {
            return <SubscribeView clientId={clientId} tier={tier} email={email} />;
        }
        console.warn(
            `[subscribe] client ${clientId} has pricing_tier_id=${client.pricing_tier_id} but tier not found; falling back`
        );
    }

    if (client?.signup_offer_id) {
        const offer = await getOfferById(client.signup_offer_id);
        if (offer) {
            const tiers = await getTiersForOffer(offer.id, { onlyActive: true });
            if (tiers.length > 0) {
                const cookieStore = await cookies();
                const preferredTierSlug =
                    cookieStore.get("omnify_preferred_tier")?.value ?? null;
                return (
                    <TierPickerView
                        clientId={clientId}
                        offer={offer}
                        tiers={tiers}
                        email={email}
                        preferredTierSlug={preferredTierSlug}
                    />
                );
            }
            console.warn(
                `[subscribe] offer ${offer.id} has no active tiers; falling back to public`
            );
        } else {
            console.warn(
                `[subscribe] client ${clientId} has signup_offer_id=${client.signup_offer_id} but offer not found; falling back`
            );
        }
    }

    // Defensive fallback — render the public tier subscribe view.
    const publicTier = await getPublicTier();
    return <SubscribeView clientId={clientId} tier={publicTier} email={email} />;
}
