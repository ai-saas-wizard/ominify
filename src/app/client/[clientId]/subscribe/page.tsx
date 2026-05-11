import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { canAccessClient } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import { getTierForClient } from "@/lib/pricing-tiers";
import { SubscribeView } from "./_components/subscribe-view";

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

    // Pricing comes from the client's assigned tier (set at signup based on
    // /offers/[slug] cookie). The page never enumerates other tiers — each
    // client sees exactly one tier (single- or multi-phase).
    const tier = await getTierForClient(clientId);

    return <SubscribeView clientId={clientId} tier={tier} email={email} />;
}
