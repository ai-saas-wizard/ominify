"use server";

import { supabase } from "@/lib/supabase";
import { listCalls, getCall } from "@/lib/vapi";
import { getClientVapiKey } from "@/lib/client-secrets";

// Agent record from Supabase (scoped to client). Mirrors ClientAgent in logs/page.
export interface ClientAgent {
    id: string;
    vapi_id: string;
    name: string;
    agent_type: string;
}

/**
 * Server action: sync calls from VAPI API into Supabase for CUSTOM clients.
 * Acts as a fallback for missed webhooks. The caller does NOT need to pass the
 * VAPI key — this action resolves it via getClientVapiKey() internally, which
 * keeps the decrypted key off any render path.
 *
 * Mutates the `agents` array in place when new agents are auto-created from
 * VAPI assistants that don't yet have a local row.
 */
export async function syncVapiCallsForClient(
    clientId: string,
    agents: ClientAgent[]
): Promise<void> {
    try {
        const vapiKey = await getClientVapiKey(clientId);
        if (!vapiKey) return;

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

            // VAPI API doesn't always return durationSeconds — calculate from timestamps
            let durationSeconds = call.durationSeconds || 0;
            if (!durationSeconds && call.startedAt && call.endedAt) {
                durationSeconds = Math.round(
                    (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
                );
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
                duration_seconds: durationSeconds,
                started_at: call.startedAt || null,
                ended_at: call.endedAt || null,
            };
        });

        // Upsert in batches of 50 — updates existing rows so VAPI data stays fresh
        for (let i = 0; i < callRows.length; i += 50) {
            const batch = callRows.slice(i, i + 50);
            const { error } = await supabase
                .from('calls')
                .upsert(batch, { onConflict: 'vapi_call_id', ignoreDuplicates: false });

            if (error) {
                console.error('[VAPI SYNC] Batch upsert error:', error.message);
            }
        }

        // Link all unlinked calls for this client to the correct agent.
        // For single-agent clients, assign all orphaned calls to that agent.
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

/**
 * Repair rows in `calls` where `started_at` is null by fetching the real
 * timestamp from VAPI. Runs opportunistically on page load — capped at 50
 * rows per invocation so a long tail of missing data can't tank render time.
 *
 * Works for both UMBRELLA and CUSTOM clients because `getClientVapiKey`
 * returns the umbrella key for UMBRELLA tenants (credentials copied on
 * client creation).
 */
export async function backfillMissingCallTimestamps(clientId: string): Promise<number> {
    try {
        const vapiKey = await getClientVapiKey(clientId);
        if (!vapiKey) return 0;

        const { data: rows, error } = await supabase
            .from('calls')
            .select('id, vapi_call_id')
            .eq('client_id', clientId)
            .is('started_at', null)
            .limit(25);

        if (error) {
            console.error('[VAPI BACKFILL] Error selecting null-timestamp rows:', error.message);
            return 0;
        }
        if (!rows?.length) return 0;

        let repaired = 0;
        for (const row of rows) {
            try {
                const call = await getCall(row.vapi_call_id, vapiKey);
                if (!call?.startedAt) continue;

                let durationSeconds = call.durationSeconds || 0;
                if (!durationSeconds && call.startedAt && call.endedAt) {
                    durationSeconds = Math.round(
                        (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
                    );
                }

                const { error: updateError } = await supabase
                    .from('calls')
                    .update({
                        started_at: call.startedAt,
                        ended_at: call.endedAt || null,
                        duration_seconds: durationSeconds,
                    })
                    .eq('id', row.id);

                if (updateError) {
                    console.error(`[VAPI BACKFILL] Update failed for ${row.vapi_call_id}:`, updateError.message);
                } else {
                    repaired++;
                }
            } catch (err) {
                console.error(`[VAPI BACKFILL] Error backfilling ${row.vapi_call_id}:`, err);
            }
        }

        if (repaired > 0) {
            console.log(`[VAPI BACKFILL] Repaired ${repaired}/${rows.length} rows for client ${clientId}`);
        }
        return repaired;
    } catch (error) {
        console.error('[VAPI BACKFILL] Error:', error);
        return 0;
    }
}
