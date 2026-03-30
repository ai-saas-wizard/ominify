import { listCalls, listPhoneNumbers, VapiCall } from "@/lib/vapi";
import { LogsPageClient } from "@/components/logs/logs-page-client";
import { supabase } from "@/lib/supabase";

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
        startedAt: call.started_at || new Date().toISOString(),
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

// Sync calls from VAPI API into Supabase for CUSTOM clients (fallback for missed webhooks)
async function syncVapiCallsForCustomClient(
    clientId: string,
    vapiKey: string,
    agents: ClientAgent[]
) {
    try {
        const vapiCalls = await listCalls(vapiKey);
        if (!vapiCalls.length) return;

        // Auto-create missing agents from VAPI assistants
        const existingVapiIds = new Set(agents.map(a => a.vapi_id));
        const missingAssistantIds = [...new Set(
            vapiCalls.map(c => c.assistantId).filter(id => id && !existingVapiIds.has(id))
        )];

        for (const assistantId of missingAssistantIds) {
            try {
                // Fetch assistant name from VAPI
                const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
                    headers: { Authorization: `Bearer ${vapiKey}` }
                });
                const assistantName = res.ok ? (await res.json()).name : `Agent ${assistantId.slice(0, 8)}`;

                const { data: newAgent } = await supabase
                    .from('agents')
                    .insert({
                        client_id: clientId,
                        vapi_id: assistantId,
                        name: assistantName,
                        agent_type: 'custom',
                    })
                    .select('id, vapi_id, name, agent_type')
                    .single();

                if (newAgent) {
                    agents.push(newAgent as ClientAgent);
                    console.log(`[VAPI SYNC] Auto-created agent: ${assistantName} (${assistantId})`);
                }
            } catch (err) {
                console.error(`[VAPI SYNC] Failed to create agent for ${assistantId}:`, err);
            }
        }

        // Build assistantId → internal agent UUID map (includes newly created agents)
        const agentMap = new Map(agents.map(a => [a.vapi_id, a.id]));

        const callRows = vapiCalls.map(call => {
            // Build transcript from messages if no flat transcript
            let transcript = call.transcript || '';
            if (!transcript && call.messages?.length) {
                transcript = call.messages
                    .filter(m => m.role === 'user' || m.role === 'bot' || m.role === 'assistant')
                    .map(m => `${m.role}: ${m.message}`)
                    .join('\n');
            }

            return {
                client_id: clientId,
                vapi_call_id: call.id,
                agent_id: agentMap.get(call.assistantId) || null,
                status: call.status || 'ended',
                type: call.type || 'inboundPhoneCall',
                ended_reason: call.endedReason || null,
                transcript: transcript || null,
                summary: call.analysis?.summary || null,
                structured_data: call.analysis?.structuredData || {},
                recording_url: call.recordingUrl || null,
                customer_number: call.customer?.number || null,
                cost: call.cost || 0,
                duration_seconds: call.durationSeconds || 0,
                started_at: call.startedAt || null,
                ended_at: call.endedAt || null,
            };
        });

        // Upsert in batches of 50, ignoreDuplicates to preserve richer webhook data
        for (let i = 0; i < callRows.length; i += 50) {
            const batch = callRows.slice(i, i + 50);
            const { error } = await supabase
                .from('calls')
                .upsert(batch, { onConflict: 'vapi_call_id', ignoreDuplicates: true });

            if (error) {
                console.error('[VAPI SYNC] Batch upsert error:', error.message);
            }
        }

        // Link all unlinked calls for this client to the correct agent
        // For single-agent clients, assign all orphaned calls to that agent
        if (agents.length === 1) {
            await supabase
                .from('calls')
                .update({ agent_id: agents[0].id })
                .eq('client_id', clientId)
                .is('agent_id', null);
        }

        console.log(`[VAPI SYNC] Synced ${callRows.length} calls for client ${clientId}`);
    } catch (error) {
        console.error('[VAPI SYNC] Error syncing calls:', error);
    }
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
    let accountType: string | undefined = undefined;

    if (clientId) {
        const { data } = await supabase.from('clients').select('vapi_key, account_type').eq('id', clientId).single();
        if (data) {
            vapiKey = data.vapi_key;
            accountType = data.account_type;
        }
    }

    // Fetch agents first (needed for both sync and display)
    const clientAgents = await fetchClientAgents(clientId);

    // For CUSTOM clients, sync calls from VAPI API before reading from Supabase
    if (accountType === 'CUSTOM' && vapiKey) {
        await syncVapiCallsForCustomClient(clientId, vapiKey, clientAgents);
    }

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
