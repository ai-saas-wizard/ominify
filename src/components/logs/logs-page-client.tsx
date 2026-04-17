'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { VapiCall, VapiPhoneNumber } from '@/lib/vapi';
import { LogViewerWithLive } from './log-viewer-live';
import type { ClientAgent } from '@/app/client/[clientId]/logs/page';
import { fetchSupabaseToken, createAuthedSupabase } from '@/lib/supabase-browser';
import { backfillMissingCallTimestamps } from '@/app/actions/vapi-sync-actions';

export interface ActiveCall {
    id: string;
    client_id: string;
    vapi_call_id: string;
    assistant_id: string | null;
    customer_number: string | null;
    status: string;
    started_at: string;
    last_active_at: string;
    transcript: string | null;
    summary: string | null;
    cost: number;
    type: string;
}

interface LogsPageClientProps {
    calls: VapiCall[];
    agents: ClientAgent[];
    phoneNumbers: VapiPhoneNumber[];
    clientId: string;
}

// Supabase JWT lives 30 minutes server-side; refresh at 25.
const TOKEN_REFRESH_MS = 25 * 60 * 1000;

export function LogsPageClient({ calls, agents, phoneNumbers, clientId }: LogsPageClientProps) {
    const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
    const router = useRouter();

    const supabaseRef = useRef<SupabaseClient | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);

    // Repair rows with null started_at in the background. Runs once per mount;
    // if anything was repaired the server action refreshes the route cache.
    useEffect(() => {
        let cancelled = false;
        backfillMissingCallTimestamps(clientId)
            .then(repaired => {
                if (!cancelled && repaired > 0) router.refresh();
            })
            .catch(() => { /* surfaced server-side already */ });
        return () => { cancelled = true; };
    }, [clientId, router]);

    const ensureClient = useCallback(async (): Promise<SupabaseClient | null> => {
        const tokenResp = await fetchSupabaseToken();
        if (!tokenResp) return null;
        const client = createAuthedSupabase(tokenResp.token);
        supabaseRef.current = client;
        return client;
    }, []);

    const fetchActiveCalls = useCallback(async () => {
        const client = supabaseRef.current ?? (await ensureClient());
        if (!client) return;

        const { data, error } = await client
            .from('active_calls')
            .select('*')
            .eq('client_id', clientId)
            .order('started_at', { ascending: false });

        if (!error && data) {
            setActiveCalls(data as ActiveCall[]);
        }
    }, [clientId, ensureClient]);

    useEffect(() => {
        let cancelled = false;
        let refreshTimer: ReturnType<typeof setInterval> | null = null;

        const buildSubscription = async () => {
            const client = await ensureClient();
            if (!client || cancelled) return;

            await fetchActiveCalls();

            const channel: RealtimeChannel = client
                .channel(`active_calls_logs:${clientId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'active_calls',
                        filter: `client_id=eq.${clientId}`,
                    },
                    (payload) => {
                        if (payload.eventType === 'INSERT') {
                            setActiveCalls(prev => [payload.new as ActiveCall, ...prev]);
                        } else if (payload.eventType === 'UPDATE') {
                            setActiveCalls(prev =>
                                prev.map(call =>
                                    call.id === (payload.new as ActiveCall).id
                                        ? (payload.new as ActiveCall)
                                        : call
                                )
                            );
                        } else if (payload.eventType === 'DELETE') {
                            setActiveCalls(prev =>
                                prev.filter(call => call.id !== (payload.old as ActiveCall).id)
                            );
                        }
                    }
                )
                .subscribe();

            channelRef.current = channel;
        };

        buildSubscription();

        // Periodically refresh token + rebuild subscription.
        refreshTimer = setInterval(async () => {
            if (cancelled) return;
            if (channelRef.current && supabaseRef.current) {
                try {
                    await supabaseRef.current.removeChannel(channelRef.current);
                } catch {
                    /* ignore */
                }
            }
            await buildSubscription();
        }, TOKEN_REFRESH_MS);

        return () => {
            cancelled = true;
            if (refreshTimer) clearInterval(refreshTimer);
            if (channelRef.current && supabaseRef.current) {
                supabaseRef.current.removeChannel(channelRef.current);
            }
        };
    }, [clientId, ensureClient, fetchActiveCalls]);

    return (
        <LogViewerWithLive
            calls={calls}
            agents={agents}
            phoneNumbers={phoneNumbers}
            activeCalls={activeCalls}
            clientId={clientId}
        />
    );
}
