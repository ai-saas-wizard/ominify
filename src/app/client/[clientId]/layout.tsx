import { auth, currentUser } from "@clerk/nextjs/server";
import { linkClerkIdToMember } from "@/lib/auth";
import { hasActiveSubscription } from "@/lib/access";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Sidebar, type SidebarInitialData } from "@/components/layout/sidebar";
import { NotificationCenter } from "@/components/layout/notification-center";
import { supabase } from "@/lib/supabase";
import { getOrCreateMinuteBalance } from "@/lib/billing";
import { getUnreadNotificationCount } from "@/app/actions/sequence-actions";
import Link from "next/link";
import { WalkthroughProvider } from "@/components/walkthrough/walkthrough-provider";

async function fetchAccessibleClients(userId: string) {
    const { data: clients } = await supabase
        .from("clients")
        .select("id, name")
        .eq("clerk_id", userId)
        .order("name");

    const list = clients || [];
    if (list.length === 0) return [];

    const { data: profiles } = await supabase
        .from("tenant_profiles")
        .select("client_id, legal_business_name")
        .in("client_id", list.map((c) => c.id));

    const profileMap = new Map(
        (profiles || []).map((p) => [p.client_id, p.legal_business_name as string | null])
    );

    return list.map((c) => ({
        id: c.id as string,
        name: c.name as string,
        business_name: profileMap.get(c.id as string) || null,
    }));
}

export default async function ClientLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ clientId: string }>;
}) {
    const [{ clientId }, authResult, user] = await Promise.all([
        params,
        auth(),
        currentUser(),
    ]);

    const userId = authResult.userId;
    if (!userId || !user) {
        redirect("/sign-in");
    }

    const userEmail = user.emailAddresses[0]?.emailAddress;
    if (!userEmail) {
        redirect("/sign-in");
    }

    const emailLower = userEmail.toLowerCase();

    const [
        _link,
        adminByEmail,
        adminById,
        memberByEmail,
        memberById,
        ownerCheck,
        clientRecordResult,
        profileResult,
        subscriptionAccess,
        h,
        balance,
        accessibleClients,
        unreadCountResult,
    ] = await Promise.all([
        linkClerkIdToMember(userEmail, userId),
        supabase.from("admin_users").select("id").eq("email", emailLower).maybeSingle(),
        supabase.from("admin_users").select("id").eq("clerk_id", userId).maybeSingle(),
        supabase.from("client_members").select("id").eq("client_id", clientId).eq("email", emailLower).maybeSingle(),
        supabase.from("client_members").select("id").eq("client_id", clientId).eq("clerk_id", userId).maybeSingle(),
        supabase.from("clients").select("clerk_id").eq("id", clientId).maybeSingle(),
        supabase.from("clients").select("account_type, disabled, name").eq("id", clientId).maybeSingle(),
        supabase.from("tenant_profiles").select("legal_business_name, onboarding_completed, walkthrough_completed, onboarding_path, onboarding_call_scheduled_at, onboarding_call_event_uri").eq("client_id", clientId).maybeSingle(),
        hasActiveSubscription(clientId).catch(() => ({ allowed: true as const, reason: undefined })),
        headers(),
        getOrCreateMinuteBalance(clientId).catch(() => null),
        fetchAccessibleClients(userId).catch(() => []),
        getUnreadNotificationCount(clientId).catch(() => ({ success: false as const, count: 0 })),
    ]);

    const userIsAdmin = !!adminByEmail.data || !!adminById.data;
    const isMember = !!memberByEmail.data || !!memberById.data;
    const isOwner = (ownerCheck.data as { clerk_id: string | null } | null)?.clerk_id === userId;
    const hasAccess = userIsAdmin || isMember || isOwner;
    const clientRecord = clientRecordResult.data as { account_type: string; disabled: boolean; name: string } | null;
    const profile = profileResult.data as {
        legal_business_name: string | null;
        onboarding_completed: boolean | null;
        walkthrough_completed: boolean | null;
        onboarding_path: string | null;
        onboarding_call_scheduled_at: string | null;
        onboarding_call_event_uri: string | null;
    } | null;

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

    if (clientRecord?.disabled && !userIsAdmin) {
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

    if (!userIsAdmin) {
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
        if (!onAllowedRoute && !subscriptionAccess.allowed) {
            redirect(`/client/${clientId}/subscribe`);
        }
    }

    type OnboardingBanner =
        | { kind: "none" }
        | { kind: "amber-incomplete" }
        | { kind: "emerald-call-scheduled"; scheduledAt: string }
        | {
              kind: "admin-not-started" | "admin-call-pending" | "admin-call-booked";
              scheduledAt?: string;
              eventUri?: string | null;
          };

    let onboardingBanner: OnboardingBanner = { kind: "none" };
    let showWalkthrough = false;
    if (clientRecord?.account_type === "UMBRELLA") {
        if (!profile?.onboarding_completed) {
            const path = profile?.onboarding_path ?? null;
            const scheduledAt = profile?.onboarding_call_scheduled_at ?? undefined;
            if (userIsAdmin) {
                if (path === "manual_call_booked" && scheduledAt) {
                    onboardingBanner = {
                        kind: "admin-call-booked",
                        scheduledAt,
                        eventUri: profile?.onboarding_call_event_uri ?? null,
                    };
                } else if (path === "manual_call_pending") {
                    onboardingBanner = { kind: "admin-call-pending" };
                } else {
                    onboardingBanner = { kind: "admin-not-started" };
                }
            } else if (path === "manual_call_booked" && scheduledAt) {
                onboardingBanner = {
                    kind: "emerald-call-scheduled",
                    scheduledAt,
                };
            } else {
                onboardingBanner = { kind: "amber-incomplete" };
            }
        } else if (!profile?.walkthrough_completed) {
            showWalkthrough = true;
        }
    }

    const formatScheduled = (iso: string) => {
        try {
            return new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            }).format(new Date(iso));
        } catch {
            return iso;
        }
    };

    const sidebarInitialData: SidebarInitialData = {
        clientId,
        accountType: clientRecord?.account_type ?? null,
        businessName: profile?.legal_business_name ?? null,
        clientName: clientRecord?.name ?? null,
        balance: balance?.balance_minutes ?? null,
        accessibleClients,
    };

    return (
        <WalkthroughProvider clientId={clientId} shouldShowWalkthrough={showWalkthrough}>
            <div className="flex h-screen bg-gray-50">
                <div className="w-56 flex-shrink-0">
                    <Sidebar initialData={sidebarInitialData} />
                </div>

                <main className="flex-1 overflow-auto">
                    {onboardingBanner.kind === "amber-incomplete" && (
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
                    {onboardingBanner.kind === "emerald-call-scheduled" && (
                        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0">
                                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-sm text-emerald-800">
                                        <span className="font-semibold">Onboarding call scheduled</span> for{" "}
                                        <span className="font-medium">{formatScheduled(onboardingBanner.scheduledAt)}</span>.
                                        {" "}We&apos;ll get you fully set up on the call.
                                    </p>
                                </div>
                                <Link
                                    href={`/client/${clientId}/onboarding`}
                                    className="flex-shrink-0 text-sm font-medium text-emerald-700 hover:text-emerald-800 underline"
                                >
                                    View details
                                </Link>
                            </div>
                        </div>
                    )}
                    {(onboardingBanner.kind === "admin-call-booked" ||
                        onboardingBanner.kind === "admin-call-pending" ||
                        onboardingBanner.kind === "admin-not-started") && (
                        <div className="bg-indigo-50 border-b border-indigo-200 px-6 py-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex-shrink-0 text-indigo-600">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h2.28a2 2 0 011.94 1.515l.7 2.81a2 2 0 01-.45 1.95l-1.27 1.27a16 16 0 006.59 6.59l1.27-1.27a2 2 0 011.95-.45l2.81.7A2 2 0 0121 17.72V20a1 1 0 01-1 1h-1C9.61 21 3 14.39 3 6V5z" />
                                        </svg>
                                    </div>
                                    <p className="text-sm text-indigo-800 truncate">
                                        {onboardingBanner.kind === "admin-call-booked" && (
                                            <>
                                                <span className="font-semibold">Onboarding call with this user</span>{" "}
                                                scheduled for{" "}
                                                <span className="font-medium">
                                                    {formatScheduled(onboardingBanner.scheduledAt!)}
                                                </span>
                                            </>
                                        )}
                                        {onboardingBanner.kind === "admin-call-pending" && (
                                            <>
                                                <span className="font-semibold">User clicked Schedule Call</span>{" "}
                                                but hasn&apos;t booked yet.
                                            </>
                                        )}
                                        {onboardingBanner.kind === "admin-not-started" && (
                                            <>
                                                <span className="font-semibold">User has not started onboarding.</span>
                                            </>
                                        )}
                                    </p>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-2">
                                    {onboardingBanner.kind === "admin-call-booked" && onboardingBanner.eventUri && (
                                        <a
                                            href={onboardingBanner.eventUri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-indigo-700 hover:text-indigo-800 underline"
                                        >
                                            View call
                                        </a>
                                    )}
                                    <Link
                                        href={`/client/${clientId}/onboarding`}
                                        className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                                    >
                                        Configure Now
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}
                    {children}
                </main>

                {/* Floating, so it sits above whichever page is mounted rather
                    than inside the sidebar's column. */}
                <NotificationCenter
                    clientId={clientId}
                    initialUnreadCount={unreadCountResult.success ? unreadCountResult.count : 0}
                />
            </div>
        </WalkthroughProvider>
    );
}
