import { auth, currentUser } from "@clerk/nextjs/server";
import { canAccessClient, isAdmin, linkClerkIdToMember } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Sidebar } from "@/components/layout/sidebar";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { WalkthroughProvider } from "@/components/walkthrough/walkthrough-provider";

export default async function ClientLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
        redirect("/sign-in");
    }

    const userEmail = user.emailAddresses[0]?.emailAddress;

    if (!userEmail) {
        redirect("/sign-in");
    }

    // Link clerk_id to any matching member entries
    await linkClerkIdToMember(userEmail, userId);

    // Check if user can access this client
    const hasAccess = await canAccessClient(userEmail, clientId) || await canAccessClient(userId, clientId);

    if (!hasAccess) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto p-8">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
                    <p className="text-gray-600 mb-6">
                        You don&apos;t have permission to access this client account.
                    </p>
                    <p className="text-sm text-gray-500">
                        Signed in as: <span className="font-medium">{userEmail}</span>
                    </p>
                    <a href="/" className="mt-6 inline-block text-emerald-600 hover:underline">
                        &larr; Go back home
                    </a>
                </div>
            </div>
        );
    }

    // Check if client is disabled (admins can still access)
    const { data: clientRecord } = await supabase
        .from("clients")
        .select("account_type, disabled")
        .eq("id", clientId)
        .single();

    if (clientRecord?.disabled) {
        const userIsAdmin = await isAdmin(userEmail) || await isAdmin(userId);
        if (!userIsAdmin) {
            return (
                <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                    <div className="text-center max-w-md mx-auto p-8">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Disabled</h1>
                        <p className="text-gray-600 mb-6">
                            This client account has been disabled by an administrator. Please contact support if you believe this is an error.
                        </p>
                        <p className="text-sm text-gray-500">
                            Signed in as: <span className="font-medium">{userEmail}</span>
                        </p>
                        <a href="/" className="mt-6 inline-block text-emerald-600 hover:underline">
                            &larr; Go back home
                        </a>
                    </div>
                </div>
            );
        }
    }

    // Paywall gate — redirect unsubscribed UMBRELLA clients away from
    // everything except the subscribe page(s) and billing (so they can
    // re-subscribe). Admins bypass so they can still support accounts.
    {
        const userIsAdmin = (await isAdmin(userEmail)) || (await isAdmin(userId));
        if (!userIsAdmin) {
            const h = await headers();
            const currentPath =
                h.get("x-invoke-path") ||
                h.get("x-pathname") ||
                h.get("next-url") ||
                "";
            const allowlist = [
                `/client/${clientId}/subscribe`,
                `/client/${clientId}/billing`,
            ];
            const onAllowedRoute = allowlist.some((p) => currentPath.startsWith(p));
            if (!onAllowedRoute) {
                const access = await hasActiveSubscription(clientId);
                if (!access.allowed) {
                    redirect(`/client/${clientId}/subscribe`);
                }
            }
        }
    }

    // Check if UMBRELLA client needs onboarding banner or walkthrough
    let showOnboardingBanner = false;
    let showWalkthrough = false;
    if (clientRecord?.account_type === "UMBRELLA") {
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("onboarding_completed, walkthrough_completed")
            .eq("client_id", clientId)
            .single();

        if (!profile?.onboarding_completed) {
            showOnboardingBanner = true;
        } else if (!profile?.walkthrough_completed) {
            showWalkthrough = true;
        }
    }

    return (
        <WalkthroughProvider clientId={clientId} shouldShowWalkthrough={showWalkthrough}>
            <div className="flex h-screen bg-gray-50">
                {/* Sidebar */}
                <div className="w-56 flex-shrink-0">
                    <Sidebar />
                </div>

                {/* Main Content */}
                <main className="flex-1 overflow-auto">
                    {/* Onboarding Incomplete Banner */}
                    {showOnboardingBanner && (
                        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0">
                                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <p className="text-sm text-amber-800">
                                        <span className="font-semibold">Onboarding incomplete.</span>{" "}
                                        Complete your business profile to set up AI agents and start using sequences.
                                    </p>
                                </div>
                                <Link
                                    href={`/client/${clientId}/onboarding`}
                                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                                >
                                    Continue Onboarding
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </Link>
                            </div>
                        </div>
                    )}
                    {children}
                </main>
            </div>
        </WalkthroughProvider>
    );
}
