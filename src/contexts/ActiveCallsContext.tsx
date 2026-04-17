'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { fetchSupabaseToken, createAuthedSupabase } from '@/lib/supabase-browser';

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

interface ActiveCallsContextType {
    activeCalls: ActiveCall[];
    isLoading: boolean;
    error: string | null;
    refreshCalls: () => Promise<void>;
}

const ActiveCallsContext = createContext<ActiveCallsContextType | undefined>(undefined);

// Refresh the signed Supabase JWT a few minutes before it expires.
// Server TTL is 30 minutes; refresh at 25.
const TOKEN_REFRESH_MS = 25 * 60 * 1000;

export function ActiveCallsProvider({
    children,
    clientId
}: {
    children: React.ReactNode;
    clientId: string;
}) {
    const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Keep the authed supabase client in a ref so effects can re-use it.
    const supabaseRef = useRef<SupabaseClient | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);

    const ensureClient = useCallback(async (): Promise<SupabaseClient | null> => {
        const tokenResp = await fetchSupabaseToken();
        if (!tokenResp) {
            setError('Failed to obtain Supabase access token');
            return null;
        }
        const client = createAuthedSupabase(tokenResp.token);
        supabaseRef.current = client;
        return client;
    }, []);

    const fetchActiveCalls = useCallback(async () => {
        try {
            const client = supabaseRef.current ?? (await ensureClient());
            if (!client) return;

            const { data, error: fetchError } = await client
                .from('active_calls')
                .select('*')
                .eq('client_id', clientId)
                .order('started_at', { ascending: false });

            if (fetchError) throw fetchError;
            setActiveCalls(data || []);
            setError(null);
        } catch (err: any) {
            console.error('Error fetching active calls:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [clientId, ensureClient]);

    useEffect(() => {
        let cancelled = false;
        let refreshTimer: ReturnType<typeof setInterval> | null = null;

        const subscribe = async () => {
            const client = await ensureClient();
            if (!client || cancelled) return;

            await fetchActiveCalls();

            const channel: RealtimeChannel = client
                .channel(`active_calls:${clientId}`)
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

            // Refresh the token periodically by tearing down and re-subscribing
            // with a new client. Keeps the RLS-scoped JWT fresh.
            refreshTimer = setInterval(async () => {
                if (cancelled) return;
                const newClient = await ensureClient();
                if (!newClient || cancelled) return;
                if (channelRef.current) {
                    try {
                        await supabaseRef.current?.removeChannel(channelRef.current);
                    } catch {
                        /* ignore */
                    }
                }
                // Rebuild the subscription with the new client.
                const newChannel = newClient
                    .channel(`active_calls:${clientId}`)
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
                channelRef.current = newChannel;
            }, TOKEN_REFRESH_MS);
        };

        subscribe();

        return () => {
            cancelled = true;
            if (refreshTimer) clearInterval(refreshTimer);
            if (channelRef.current && supabaseRef.current) {
                supabaseRef.current.removeChannel(channelRef.current);
            }
        };
    }, [clientId, ensureClient, fetchActiveCalls]);

    return (
        <ActiveCallsContext.Provider value={{
            activeCalls,
            isLoading,
            error,
            refreshCalls: fetchActiveCalls
        }}>
            {children}
        </ActiveCallsContext.Provider>
    );
}

export function useActiveCalls() {
    const context = useContext(ActiveCallsContext);
    if (context === undefined) {
        throw new Error('useActiveCalls must be used within an ActiveCallsProvider');
    }
    return context;
}
