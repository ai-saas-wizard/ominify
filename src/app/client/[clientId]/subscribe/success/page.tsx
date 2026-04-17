import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { canAccessClient } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { supabase } from "@/lib/supabase";

/**
 * Landing page after a successful Stripe Checkout.
 *
 * Checkout success can beat the webhook that upserts our `subscriptions` row,
 * so we poll `hasActiveSubscription` a few times before falling back to a
 * friendly "still processing" message.
 */
async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function SubscribeSuccessPage({
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

    // Poll up to 5× with 1s between tries.
    let subAccess = await hasActiveSubscription(clientId);
    for (let i = 0; i < 5 && !subAccess.allowed; i++) {
        await sleep(1000);
        subAccess = await hasActiveSubscription(clientId);
    }

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

    // Webhook still hasn't landed. Show a soft "we're almost there" state.
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
            <div className="max-w-md w-full text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                        className="w-8 h-8 text-emerald-600 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4v4m0 8v4m8-8h-4M4 12h4m10.364-5.636l-2.828 2.828M7.464 16.536l-2.828 2.828m0-13.364l2.828 2.828m9.9 9.9l2.828 2.828"
                        />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    Confirming your subscription…
                </h1>
                <p className="text-gray-600 mb-4">
                    Stripe is finalizing your payment. This normally takes a few seconds.
                </p>
                <a
                    href={`/client/${clientId}/subscribe/success`}
                    className="inline-block px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                    Refresh
                </a>
            </div>
        </div>
    );
}
