'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { VapiCall, VapiAgent, VapiPhoneNumber } from '@/lib/vapi';
import { LogViewerWithLive } from './log-viewer-live';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

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
    agents: VapiAgent[];
    phoneNumbers: VapiPhoneNumber[];
    clientId: string;
}

export function LogsPageClient({ calls, agents, phoneNumbers, clientId }: LogsPageClientProps) {
    const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);

    const fetchActiveCalls = useCallback(async () => {
        const { data, error } = await supabaseClient
            .from('active_calls')
            .select('*')
            .eq('client_id', clientId)
            .order('started_at', { ascending: false });

        if (!error && data) {
            setActiveCalls(data);
        }
    }, [clientId]);

    useEffect(() => {
        fetchActiveCalls();

        // Subscribe to realtime changes
        const channel: RealtimeChannel = supabaseClient
            .channel(`active_calls_logs:${clientId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'active_calls',
                    filter: `client_id=eq.${clientId}`
                },
                (payload) => {
                    console.log('Realtime update:', payload);

                    if (payload.eventType === 'INSERT') {
                        setActiveCalls(prev => [payload.new as ActiveCall, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        setActiveCalls(prev =>
                            prev.map(call =>
                                call.id === (payload.new as ActiveCall).id
                                    ? payload.new as ActiveCall
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

        return () => {
            supabaseClient.removeChannel(channel);
        };
    }, [clientId, fetchActiveCalls]);

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
