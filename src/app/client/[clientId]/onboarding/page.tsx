import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { getTenantProfile } from "@/app/actions/tenant-profile-actions";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { OnboardingV2Wizard } from "@/components/onboarding-v2/onboarding-v2-wizard";

// Feature flag — set to true to enable V2 AI Agent Fleet Builder
const USE_ONBOARDING_V2 = true;

export default async function OnboardingPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    // Fetch client to verify account type
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

    // Gate: Only UMBRELLA (Type B) clients can access onboarding
    if (client.account_type !== "UMBRELLA") {
        redirect(`/client/${clientId}`);
    }

    // Fetch existing tenant profile (may be partially filled)
    const profile = await getTenantProfile(clientId);

    if (USE_ONBOARDING_V2) {
        return (
            <OnboardingV2Wizard
                clientId={clientId}
                clientName={client.name}
                initialProfile={profile}
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
