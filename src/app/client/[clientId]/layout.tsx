import { auth, currentUser } from "@clerk/nextjs/server";
import { canAccessClient, linkClerkIdToMember } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

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
                    <a href="/" className="mt-6 inline-block text-violet-600 hover:underline">
                        &larr; Go back home
                    </a>
                </div>
            </div>
        );
    }

    // Check if UMBRELLA client needs onboarding banner
    let showOnboardingBanner = false;
    const { data: clientRecord } = await supabase
        .from("clients")
        .select("account_type")
        .eq("id", clientId)
        .single();

    if (clientRecord?.account_type === "UMBRELLA") {
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("onboarding_completed")
            .eq("client_id", clientId)
            .single();

        if (!profile?.onboarding_completed) {
            showOnboardingBanner = true;
        }
    }

    return (
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
    );
}
