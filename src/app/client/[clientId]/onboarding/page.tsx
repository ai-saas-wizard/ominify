import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getTenantProfile } from "@/app/actions/tenant-profile-actions";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { OnboardingV2Wizard } from "@/components/onboarding-v2/onboarding-v2-wizard";
import { ScheduleCallScreen } from "@/components/onboarding-v2/components/schedule-call-screen";

const USE_ONBOARDING_V2 = true;

export default async function OnboardingPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    const [{ userId }, user] = await Promise.all([auth(), currentUser()]);
    if (!userId || !user) {
        redirect("/sign-in");
    }
    const userEmail = user.emailAddresses[0]?.emailAddress ?? null;

    const { data: client } = await supabase
        .from("clients")
        .select("id, name, account_type")
        .eq("id", clientId)
        .single();

    if (!client) {
        return (
            <div className="p-8 text-center text-red-600">
                Client not found
            </div>
        );
    }

    if (client.account_type !== "UMBRELLA") {
        redirect(`/client/${clientId}?notice=custom_no_onboarding`);
    }

    const adminCheck = userEmail
        ? await isAdmin(userEmail).catch(() => false)
        : false;
    const isUserAdmin =
        adminCheck || (await isAdmin(userId).catch(() => false));

    const profile = await getTenantProfile(clientId);

    const profileRecord = profile as Record<string, unknown> | null;
    const onboardingPath =
        (profileRecord?.onboarding_path as string | null | undefined) ?? null;

    if (
        !isUserAdmin &&
        onboardingPath === "manual_call_booked" &&
        profileRecord
    ) {
        const booking = {
            scheduledAt:
                (profileRecord.onboarding_call_scheduled_at as
                    | string
                    | null
                    | undefined) ?? "",
            inviteeEmail:
                (profileRecord.onboarding_call_invitee_email as
                    | string
                    | null) ?? null,
            inviteeName:
                (profileRecord.onboarding_call_invitee_name as
                    | string
                    | null) ?? null,
            rescheduleUrl:
                (profileRecord.onboarding_call_reschedule_url as
                    | string
                    | null) ?? null,
            cancelUrl:
                (profileRecord.onboarding_call_cancel_url as
                    | string
                    | null) ?? null,
            eventUri:
                (profileRecord.onboarding_call_event_uri as string | null) ??
                null,
        };
        // Prefer the user's actual first name for the "You're all set, X" greeting.
        // legal_business_name is the company name (e.g. "Acme Capital Homes"),
        // not the user's name — using it would greet the user as "Acme."
        const clerkFirstName = user.firstName?.trim() || null;
        const clerkFullName = [user.firstName, user.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || null;
        const userName =
            clerkFullName ??
            clerkFirstName ??
            client.name ??
            "";
        const industry =
            (profileRecord.industry as string | null | undefined) ?? null;

        return (
            <ScheduleCallScreen
                mode="booked-confirmation"
                clientId={clientId}
                userEmail={userEmail}
                userName={userName}
                industry={industry}
                booking={booking}
            />
        );
    }

    if (USE_ONBOARDING_V2) {
        return (
            <OnboardingV2Wizard
                clientId={clientId}
                clientName={client.name}
                initialProfile={profile}
                userEmail={userEmail}
                isAdmin={isUserAdmin}
            />
        );
    }

    return (
        <div className="h-screen">
            <OnboardingWizard
                clientId={clientId}
                clientName={client.name}
                initialProfile={profile}
            />
        </div>
    );
}
