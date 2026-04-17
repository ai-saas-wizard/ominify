import { listPhoneNumbers, VapiCall } from "@/lib/vapi";
import { LogsPageClient } from "@/components/logs/logs-page-client";
import { supabase } from "@/lib/supabase";
import { getClientVapiKey } from "@/lib/client-secrets";
import { syncVapiCallsForClient, backfillMissingCallTimestamps } from "@/app/actions/vapi-sync-actions";

// Agent record from Supabase (scoped to client)
export interface ClientAgent {
    id: string;        // internal UUID
    vapi_id: string;   // VAPI assistant ID
    name: string;
    agent_type: string;
}

// Supabase call record with agent join
interface SupabaseCallWithAgent {
    id: string;
    vapi_call_id: string;
    agent_id: string | null;
    customer_number: string | null;
    status: string;
    ended_reason: string | null;
    transcript: string | null;
    recording_url: string | null;
    summary: string | null;
    structured_data: Record<string, any>;
    started_at: string | null;
    ended_at: string | null;
    cost: number;
    type: string;
    duration_seconds: number;
    agents: {
        vapi_id: string;
        name: string;
    } | null;
}

function transformToVapiCall(call: SupabaseCallWithAgent): VapiCall {
    let messages: Array<{ role: string; message: string }> | undefined;
    if (call.transcript) {
        messages = call.transcript
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const role = line.slice(0, colonIndex).trim().toLowerCase();
                    const message = line.slice(colonIndex + 1).trim();
                    return {
                        role: role === 'user' ? 'user' : (role === 'ai' || role === 'bot' || role === 'assistant') ? 'bot' : role,
                        message
                    };
                }
                return { role: 'bot', message: line };
            });
    }

    return {
        id: call.vapi_call_id,
        assistantId: call.agents?.vapi_id || '',
        customer: call.customer_number ? { number: call.customer_number } : undefined,
        status: call.status,
        endedReason: call.ended_reason || undefined,
        transcript: call.transcript || undefined,
        recordingUrl: call.recording_url || undefined,
        analysis: {
            summary: call.summary || undefined,
            structuredData: call.structured_data || undefined
        },
        messages,
        startedAt: call.started_at || undefined,
        endedAt: call.ended_at || undefined,
        cost: call.cost,
        type: call.type,
        durationSeconds: call.duration_seconds
    };
}


async function fetchCallsFromSupabase(
    clientId: string,
    assistantId?: string
): Promise<VapiCall[]> {
    let query = supabase
        .from('calls')
        .select(`
            *,
            agents (
                vapi_id,
                name
            )
        `)
        .eq('client_id', clientId)
        .eq('is_hidden', false)
        .order('started_at', { ascending: false })
        .limit(500);

    if (assistantId) {
        const { data: agent } = await supabase
            .from('agents')
            .select('id')
            .eq('vapi_id', assistantId)
            .eq('client_id', clientId)
            .single();

        if (agent) {
            query = query.eq('agent_id', agent.id);
        }
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching calls from Supabase:', error);
        return [];
    }

    return ((data || []) as SupabaseCallWithAgent[]).map(transformToVapiCall);
}

// Fetch agents from Supabase scoped to this client only
async function fetchClientAgents(clientId: string): Promise<ClientAgent[]> {
    const { data, error } = await supabase
        .from('agents')
        .select('id, vapi_id, name, agent_type')
        .eq('client_id', clientId)
        .order('name');

    if (error) {
        console.error('Error fetching client agents:', error);
        return [];
    }

    return (data || []) as ClientAgent[];
}

// Sync logic lives in src/app/actions/vapi-sync-actions.ts so the raw VAPI key
// is resolved server-action-internally and never threaded through this file.

export default async function LogsPage({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ assistantId?: string }>;
}) {
    const { clientId } = await params;
    const { assistantId } = await searchParams;

    let vapiKey: string | undefined = undefined;
    let accountType: string | undefined = undefined;

    if (clientId) {
        const { data } = await supabase.from('clients').select('account_type').eq('id', clientId).single();
        if (data) {
            accountType = data.account_type;
        }
        vapiKey = (await getClientVapiKey(clientId)) || undefined;
    }

    // Fetch agents first (needed for both sync and display)
    const clientAgents = await fetchClientAgents(clientId);

    // For CUSTOM clients, sync calls from VAPI API before reading from Supabase.
    // The server action resolves the decrypted VAPI key internally — we never
    // pass it through this page component.
    if (accountType === 'CUSTOM') {
        await syncVapiCallsForClient(clientId, clientAgents);
    }

    // Self-heal any rows with missing started_at by re-fetching from VAPI.
    // Runs for both UMBRELLA and CUSTOM clients.
    await backfillMissingCallTimestamps(clientId);

    // Fetch calls from Supabase (now includes any synced VAPI calls) + phone numbers from Vapi
    const [calls, phoneNumbers] = await Promise.all([
        fetchCallsFromSupabase(clientId, assistantId),
        listPhoneNumbers(vapiKey)
    ]);

    // Filter phone numbers to only those matching this client's agent vapi_ids
    const clientVapiIds = new Set(clientAgents.map(a => a.vapi_id));
    const filteredPhoneNumbers = phoneNumbers.filter(
        pn => pn.assistantId && clientVapiIds.has(pn.assistantId)
    );

    return (
        <div className="h-[calc(100vh-64px)] overflow-hidden">
            <LogsPageClient
                calls={calls}
                agents={clientAgents}
                phoneNumbers={filteredPhoneNumbers}
                clientId={clientId}
            />
        </div>
    );
}
