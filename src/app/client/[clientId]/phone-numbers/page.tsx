import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { getTwilioAccount, getPhoneNumbers, checkA2PStatus } from "@/app/actions/twilio-actions";
import { getTenantProfile } from "@/app/actions/tenant-profile-actions";
import { PhoneNumbersManager } from "@/components/phone-numbers/phone-numbers-manager";

export default async function PhoneNumbersPage(props: {
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

    // Gate: Only UMBRELLA (Type B) clients can access phone numbers
    if (client.account_type !== "UMBRELLA") {
        redirect(`/client/${clientId}`);
    }

    // Fetch data
    const twilioAccount = await getTwilioAccount(clientId);
    const phoneNumbers = await getPhoneNumbers(clientId);
    const a2pResult = await checkA2PStatus(clientId);
    const tenantProfile = await getTenantProfile(clientId);

    // Fetch agent names for phone numbers that have agent_id
    const agentIds = phoneNumbers.filter((n: any) => n.agent_id).map((n: any) => n.agent_id);
    let agentMap: Record<string, string> = {};
    if (agentIds.length > 0) {
        const { data: agents } = await supabase
            .from("agents")
            .select("id, name")
            .in("id", agentIds);
        if (agents) {
            agentMap = Object.fromEntries(agents.map((a: any) => [a.id, a.name]));
        }
    }

    return (
        <div className="p-4 lg:p-8">
            <PhoneNumbersManager
                clientId={clientId}
                clientName={client.name}
                twilioAccount={twilioAccount}
                initialPhoneNumbers={phoneNumbers}
                a2pRegistration={a2pResult?.data || null}
                tenantProfile={tenantProfile}
                agentMap={agentMap}
            />
        </div>
    );
}
