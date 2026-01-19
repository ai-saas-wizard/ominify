import { listAgents, listPhoneNumbers, VapiCall } from "@/lib/vapi";
import { LogsPageClient } from "@/components/logs/logs-page-client";
import { supabase } from "@/lib/supabase";

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
    // Parse transcript into messages array (component expects messages, not raw transcript)
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
        startedAt: call.started_at || new Date().toISOString(),
        endedAt: call.ended_at || undefined,
        cost: call.cost
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
        .order('started_at', { ascending: false })
        .limit(500);

    // If filtering by Vapi assistantId, we need to join and filter
    if (assistantId) {
        // First get the agent UUID for this vapi_id
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

    if (clientId) {
        const { data } = await supabase.from('clients').select('vapi_key').eq('id', clientId).single();
        if (data) {
            vapiKey = data.vapi_key;
        }
    }

    // Fetch calls from Supabase, agents and phone numbers from Vapi API
    // (Agents and phone numbers are configuration data that changes rarely)
    const [calls, agents, phoneNumbers] = await Promise.all([
        fetchCallsFromSupabase(clientId, assistantId),
        listAgents(vapiKey),
        listPhoneNumbers(vapiKey)
    ]);

    return (
        <div className="h-[calc(100vh-64px)] overflow-hidden">
            <LogsPageClient
                calls={calls}
                agents={agents}
                phoneNumbers={phoneNumbers}
                clientId={clientId}
            />
        </div>
    );
}
