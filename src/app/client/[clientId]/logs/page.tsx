import { listCalls, listAgents, listPhoneNumbers } from "@/lib/vapi";
import { LogViewer } from "@/components/logs/log-viewer";
import { supabase } from "@/lib/supabase";

export default async function LogsPage({
    searchParams,
}: {
    searchParams: { clientId?: string, assistantId?: string };
}) {
    let vapiKey: string | undefined = undefined;

    if (searchParams?.clientId) {
        const { data } = await supabase.from('clients').select('vapi_key').eq('id', searchParams.clientId).single();
        if (data) {
            vapiKey = data.vapi_key;
        }
    }

    // Fetch calls, agents, and phone numbers
    const [calls, agents, phoneNumbers] = await Promise.all([
        listCalls(vapiKey, searchParams?.assistantId),
        listAgents(vapiKey),
        listPhoneNumbers(vapiKey)
    ]);

    return (
        <div className="h-[calc(100vh-64px)] overflow-hidden">
            <LogViewer calls={calls} agents={agents} phoneNumbers={phoneNumbers} />
        </div>
    );
}
