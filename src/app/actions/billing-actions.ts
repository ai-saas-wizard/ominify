"use server";

import { recordCallUsage } from "@/lib/billing";
import { listCalls, VapiCall } from "@/lib/vapi";
import { supabase } from "@/lib/supabase";

/**
 * Sync call usage from Vapi to our billing system
 * This should be called periodically (e.g., every 5 minutes) or after a webhook
 */
export async function syncCallUsage(clientId: string, vapiKey?: string): Promise<{
    synced: number;
    skipped: number;
    errors: number;
}> {
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
        // Fetch calls from Vapi
        const calls = await listCalls(vapiKey);

        for (const call of calls) {
            // Skip calls that haven't ended
            if (!call.endedAt || call.status !== 'ended') {
                skipped++;
                continue;
            }

            // Calculate duration
            const startedAt = new Date(call.startedAt);
            const endedAt = new Date(call.endedAt);
            const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

            if (durationSeconds <= 0) {
                skipped++;
                continue;
            }

            try {
                // Record the usage (will skip if already recorded)
                await recordCallUsage(clientId, call.id, durationSeconds);
                synced++;
            } catch (err) {
                console.error(`Error recording usage for call ${call.id}:`, err);
                errors++;
            }
        }
    } catch (err: any) {
        console.error('Error syncing call usage:', err);
        errors++;
    }

    return { synced, skipped, errors };
}

/**
 * Sync all clients' call usage
 */
export async function syncAllClientsCallUsage(): Promise<{
    clientsSynced: number;
    totalSynced: number;
    totalErrors: number;
}> {
    let clientsSynced = 0;
    let totalSynced = 0;
    let totalErrors = 0;

    // Get all clients with Vapi keys
    const { data: clients } = await supabase
        .from('clients')
        .select('id, vapi_key')
        .not('vapi_key', 'is', null);

    if (!clients) return { clientsSynced: 0, totalSynced: 0, totalErrors: 0 };

    for (const client of clients) {
        const result = await syncCallUsage(client.id, client.vapi_key);
        clientsSynced++;
        totalSynced += result.synced;
        totalErrors += result.errors;
    }

    return { clientsSynced, totalSynced, totalErrors };
}
