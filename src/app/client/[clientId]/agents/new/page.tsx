import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { NewAgentWizard } from "@/components/new-agent/new-agent-wizard";

export default async function NewAgentPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await props.params;

    const { data: client } = await supabase
        .from("clients")
        .select("id, name, account_type")
        .eq("id", clientId)
        .single();

    if (!client) {
        return (
            <div className="p-8 text-center text-red-600">Client not found</div>
        );
    }

    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("onboarding_completed, timezone")
        .eq("client_id", clientId)
        .single();

    if (!profile?.onboarding_completed) {
        redirect(`/client/${clientId}/onboarding`);
    }

    return (
        <NewAgentWizard
            clientId={clientId}
            clientName={client.name}
            tenantTimezone={profile.timezone || ""}
        />
    );
}
