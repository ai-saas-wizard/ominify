import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { getTenantProfile } from "@/app/actions/tenant-profile-actions";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

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

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-4xl mx-auto px-4 py-8 lg:py-12">
                {/* Page Header */}
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold text-gray-900">
                        Welcome, {client.name}
                    </h1>
                    <p className="mt-2 text-gray-600">
                        Let&apos;s set up your business profile so we can configure your AI agents perfectly.
                    </p>
                </div>

                {/* Wizard */}
                <OnboardingWizard
                    clientId={clientId}
                    initialProfile={profile}
                />
            </div>
        </div>
    );
}
