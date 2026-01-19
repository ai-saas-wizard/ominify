"use server";

import { recordCallUsage } from "@/lib/billing";
import { supabase } from "@/lib/supabase";

interface SupabaseCall {
    vapi_call_id: string;
    status: string;
    ended_at: string | null;
    duration_seconds: number;
}

/**
 * Sync call usage from Supabase calls table to our billing system
 * This should be called periodically (e.g., every 5 minutes) or after a webhook
 */
export async function syncCallUsage(clientId: string): Promise<{
    synced: number;
    skipped: number;
    errors: number;
}> {
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    try {
        // Fetch ended calls from Supabase
        const { data: calls, error } = await supabase
            .from('calls')
            .select('vapi_call_id, status, ended_at, duration_seconds')
            .eq('client_id', clientId)
            .eq('status', 'ended')
            .not('ended_at', 'is', null);

        if (error) {
            console.error('Error fetching calls:', error);
            return { synced: 0, skipped: 0, errors: 1 };
        }

        for (const call of (calls as SupabaseCall[]) || []) {
            // Skip calls with no duration
            if (!call.duration_seconds || call.duration_seconds <= 0) {
                skipped++;
                continue;
            }

            try {
                // Record the usage (will skip if already recorded)
                await recordCallUsage(clientId, call.vapi_call_id, call.duration_seconds);
                synced++;
            } catch (err) {
                console.error(`Error recording usage for call ${call.vapi_call_id}:`, err);
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

    // Get all clients
    const { data: clients } = await supabase
        .from('clients')
        .select('id');

    if (!clients) return { clientsSynced: 0, totalSynced: 0, totalErrors: 0 };

    for (const client of clients) {
        const result = await syncCallUsage(client.id);
        clientsSynced++;
        totalSynced += result.synced;
        totalErrors += result.errors;
    }

    return { clientsSynced, totalSynced, totalErrors };
}
