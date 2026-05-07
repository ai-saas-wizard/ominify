import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { canAccessClient } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import { getTierForClient } from "@/lib/pricing-tiers";
import { SubscribeButton } from "@/components/billing/subscribe-button";
import { ClearTierCookieOnMount } from "@/components/billing/clear-tier-cookie";
import { CheckCircle2 } from "lucide-react";

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
    // client sees exactly one price.
    const tier = await getTierForClient(clientId);
    const features =
        tier.landing_features.length > 0
            ? tier.landing_features
            : [
                  `${tier.monthly_minutes.toLocaleString()} voice minutes included every month`,
                  "Unused minutes — rollover for 2 months",
                  "Top up with extra minute packs anytime",
                  "Cancel, upgrade, or update your card via the Stripe portal",
              ];

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-6">
            {/* Once the user is on the subscribe page, the tier is locked into
                clients.pricing_tier_id — clear the capture cookie so it can't
                bleed into a different account on a shared browser. */}
            <ClearTierCookieOnMount />
            <div className="max-w-xl w-full">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">
                        {tier.landing_headline ?? "Unlock your voice agents"}
                    </h1>
                    <p className="mt-3 text-gray-600">
                        {tier.landing_subheadline ??
                            "Omnify runs your inbound and outbound AI voice calls. Subscribe to activate your account and start placing calls today."}
                    </p>
                </div>

                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <p className="text-sm font-medium text-emerald-700 uppercase tracking-wide">
                                {tier.display_name}
                            </p>
                            <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-4xl font-bold text-gray-900">
                                    ${tier.price_usd}
                                </span>
                                <span className="text-gray-500">/month</span>
                            </div>
                        </div>
                    </div>

                    <ul className="mt-6 space-y-3">
                        {features.map((feature, i) => (
                            <li key={i} className="flex items-start gap-2 text-gray-700">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                <span>{feature}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-8">
                        <SubscribeButton
                            clientId={clientId}
                            priceUsd={tier.price_usd}
                            ctaLabel={tier.landing_cta_label ?? undefined}
                        />
                    </div>

                    <p className="mt-4 text-xs text-center text-gray-500">
                        Secure checkout powered by Stripe. You can cancel at any time.
                    </p>
                </div>

                <div className="mt-6 text-center text-sm text-gray-500">
                    Signed in as <span className="font-medium">{email}</span>
                </div>
            </div>
        </div>
    );
}
