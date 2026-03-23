import { supabase } from "@/lib/supabase";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { revalidatePath } from "next/cache";
import { getClientMembers } from "@/lib/auth";
import { SettingsHub } from "@/components/settings/settings-hub";


export default async function ClientSettingsPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    // Fetch client data
    const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

    if (!client) {
        return <div className="p-8 text-center text-red-600">Client not found</div>;
    }

    // Fetch business name from tenant_profiles (stored as legal_business_name)
    const { data: tenantProfile } = await supabase
        .from('tenant_profiles')
        .select('legal_business_name')
        .eq('client_id', clientId)
        .single();

    // Get Clerk user info
    const clerkUser = await currentUser();

    // Get team member count
    const members = await getClientMembers(clientId);

    // Get webhook count
    const { count: webhookCount } = await supabase
        .from('webhooks')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

    async function updateProfile(formData: FormData) {
        "use server";
        const name = formData.get("name") as string;
        const email = formData.get("email") as string;
        const businessName = formData.get("business_name") as string;

        await supabase
            .from('clients')
            .update({ name, email })
            .eq('id', clientId);

        // Save business name to tenant_profiles.legal_business_name
        await supabase
            .from('tenant_profiles')
            .update({ legal_business_name: businessName || null })
            .eq('client_id', clientId);

        revalidatePath(`/client/${clientId}/settings`);
    }

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <Link
                    href={`/client/${clientId}`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                <p className="mt-1 text-gray-600">Manage your account settings and preferences</p>
            </div>

            <SettingsHub
                clientId={clientId}
                client={{ id: client.id, created_at: client.created_at }}
                clerkUser={clerkUser ? {
                    imageUrl: clerkUser.imageUrl,
                    firstName: clerkUser.firstName,
                    lastName: clerkUser.lastName,
                    email: clerkUser.emailAddresses[0]?.emailAddress,
                } : null}
                memberCount={members.length}
                webhookCount={webhookCount || 0}
                updateProfile={updateProfile}
                currentName={client.name || ""}
                currentEmail={client.email || ""}
                currentBusinessName={tenantProfile?.legal_business_name || ""}
            />
        </div>
    );
}
