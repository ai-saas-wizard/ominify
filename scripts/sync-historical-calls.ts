/**
 * Historical Call Sync Script
 * 
 * This script fetches the last 100 calls from Vapi API for each client
 * and inserts them into the Supabase `calls` table.
 * 
 * Run with: npx tsx scripts/sync-historical-calls.ts
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface VapiCall {
    id: string;
    orgId: string;
    assistantId?: string;
    status: string;
    type?: string;
    endedReason?: string;
    startedAt?: string;
    endedAt?: string;
    transcript?: string;
    customer?: {
        number?: string;
    };
    costs?: Array<{
        type: string;
        cost: number;
    }>;
    analysis?: {
        summary?: string;
        structuredData?: Record<string, any>;
    };
    artifact?: {
        recordingUrl?: string;
        transcript?: string;
        messages?: Array<{
            role: string;
            message?: string;
            content?: string;
        }>;
    };
}

async function fetchVapiCalls(apiKey: string, limit: number = 100): Promise<VapiCall[]> {
    try {
        const res = await fetch(`${VAPI_BASE_URL}/call?limit=${limit}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            console.error(`Vapi API error: ${res.status}`, await res.text());
            return [];
        }

        const data = await res.json();
        return Array.isArray(data) ? data : (data.results || []);
    } catch (error) {
        console.error('Error fetching Vapi calls:', error);
        return [];
    }
}

async function getAgentIdByVapiId(clientId: string, vapiAssistantId: string): Promise<string | null> {
    const { data } = await supabase
        .from('agents')
        .select('id')
        .eq('client_id', clientId)
        .eq('vapi_id', vapiAssistantId)
        .single();

    return data?.id || null;
}

async function syncClientCalls(clientId: string, vapiKey: string, vapiOrgId: string): Promise<{
    synced: number;
    skipped: number;
    errors: number;
}> {
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    console.log(`\nFetching calls for client ${clientId}...`);
    const calls = await fetchVapiCalls(vapiKey, 100);
    console.log(`Found ${calls.length} calls from Vapi`);

    for (const call of calls) {
        try {
            // Skip if call doesn't belong to this org
            if (call.orgId !== vapiOrgId) {
                skipped++;
                continue;
            }

            // Skip non-ended calls
            if (call.status !== 'ended') {
                skipped++;
                continue;
            }

            // Look up agent by vapi_id
            let agentId: string | null = null;
            if (call.assistantId) {
                agentId = await getAgentIdByVapiId(clientId, call.assistantId);
            }

            // Calculate duration
            const startedAt = call.startedAt ? new Date(call.startedAt) : null;
            const endedAt = call.endedAt ? new Date(call.endedAt) : null;
            const durationSeconds = startedAt && endedAt
                ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
                : 0;

            // Build transcript from artifact.messages if needed
            let transcript = call.transcript || call.artifact?.transcript || '';
            if (!transcript && call.artifact?.messages) {
                transcript = call.artifact.messages
                    .filter(m => m.role === 'user' || m.role === 'bot' || m.role === 'assistant')
                    .map(m => `${m.role}: ${m.message || m.content || ''}`)
                    .join('\n');
            }

            // Get recording URL
            const recordingUrl = call.artifact?.recordingUrl || null;

            // Calculate total cost
            const totalCost = call.costs?.reduce((sum, c) => sum + (c.cost || 0), 0) || 0;

            const callData: Record<string, any> = {
                client_id: clientId,
                vapi_call_id: call.id,
                agent_id: agentId,
                duration_seconds: durationSeconds,
                recording_url: recordingUrl,
                transcript: transcript || null,
                cost: totalCost,
                status: call.status,
                started_at: call.startedAt || null,
                ended_at: call.endedAt || null,
                // New columns (added via migration)
                customer_number: call.customer?.number || null,
                type: call.type || 'inboundPhoneCall',
                ended_reason: call.endedReason || null,
                summary: call.analysis?.summary || null,
                structured_data: call.analysis?.structuredData || {},
                raw_payload: call,
                updated_at: new Date().toISOString()
            };

            // Upsert to handle duplicates
            const { error } = await supabase
                .from('calls')
                .upsert(callData, {
                    onConflict: 'vapi_call_id',
                    ignoreDuplicates: false
                });

            if (error) {
                console.error(`Error syncing call ${call.id}:`, error.message);
                errors++;
            } else {
                synced++;
            }
        } catch (error) {
            console.error(`Error processing call:`, error);
            errors++;
        }
    }

    return { synced, skipped, errors };
}

async function main() {
    console.log('=== Historical Call Sync Script ===\n');

    // Get all clients with Vapi keys
    const { data: clients, error } = await supabase
        .from('clients')
        .select('id, name, vapi_key, vapi_org_id')
        .not('vapi_key', 'is', null)
        .not('vapi_org_id', 'is', null);

    if (error) {
        console.error('Error fetching clients:', error);
        process.exit(1);
    }

    if (!clients || clients.length === 0) {
        console.log('No clients found with Vapi keys configured.');
        process.exit(0);
    }

    console.log(`Found ${clients.length} client(s) with Vapi configured:\n`);

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const client of clients) {
        console.log(`\n--- Processing: ${client.name || client.id} ---`);

        const result = await syncClientCalls(client.id, client.vapi_key, client.vapi_org_id);

        console.log(`  ✓ Synced: ${result.synced}`);
        console.log(`  ○ Skipped: ${result.skipped}`);
        if (result.errors > 0) {
            console.log(`  ✗ Errors: ${result.errors}`);
        }

        totalSynced += result.synced;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
    }

    console.log('\n=== Summary ===');
    console.log(`Total Synced: ${totalSynced}`);
    console.log(`Total Skipped: ${totalSkipped}`);
    console.log(`Total Errors: ${totalErrors}`);
    console.log('\nDone!');
}

main().catch(console.error);
