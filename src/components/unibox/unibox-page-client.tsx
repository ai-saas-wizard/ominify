"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { UniboxAgentOption, UniboxThread } from "@/lib/unibox/types";
import type { ActiveCallRow } from "@/lib/unibox/live";
import { fetchSupabaseToken, createAuthedSupabase } from "@/lib/supabase-browser";
import { backfillMissingCallTimestamps } from "@/app/actions/vapi-sync-actions";
import { UniboxView } from "./unibox-view";

interface UniboxPageClientProps {
    threads: UniboxThread[];
    agents: UniboxAgentOption[];
    clientId: string;
    initialAgentVapiId: string | null;
}

// Supabase JWT lives 30 minutes server-side; refresh at 25.
const TOKEN_REFRESH_MS = 25 * 60 * 1000;

/**
 * Owns the realtime `active_calls` subscription so in-progress calls stream
 * into the thread view. Server-built threads come in as props.
 */
export function UniboxPageClient({ threads, agents, clientId, initialAgentVapiId }: UniboxPageClientProps) {
    const [activeCalls, setActiveCalls] = useState<ActiveCallRow[]>([]);
    const router = useRouter();

    const supabaseRef = useRef<SupabaseClient | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);

    // Repair rows with null started_at in the background. Runs once per mount;
    // if anything was repaired the server action refreshes the route cache.
    useEffect(() => {
        let cancelled = false;
        backfillMissingCallTimestamps(clientId)
            .then((repaired) => {
                if (!cancelled && repaired > 0) router.refresh();
            })
            .catch(() => {
                /* surfaced server-side already */
            });
        return () => {
            cancelled = true;
        };
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
            .from("active_calls")
            .select("*")
            .eq("client_id", clientId)
            .order("started_at", { ascending: false });

        if (!error && data) setActiveCalls(data as ActiveCallRow[]);
    }, [clientId, ensureClient]);

    useEffect(() => {
        let cancelled = false;

        const buildSubscription = async () => {
            const client = await ensureClient();
            if (!client || cancelled) return;

            await fetchActiveCalls();

            const channel: RealtimeChannel = client
                .channel(`active_calls_unibox:${clientId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "active_calls", filter: `client_id=eq.${clientId}` },
                    (payload) => {
                        if (payload.eventType === "INSERT") {
                            setActiveCalls((prev) => [payload.new as ActiveCallRow, ...prev]);
                        } else if (payload.eventType === "UPDATE") {
                            const next = payload.new as ActiveCallRow;
                            setActiveCalls((prev) => prev.map((c) => (c.id === next.id ? next : c)));
                        } else if (payload.eventType === "DELETE") {
                            const gone = payload.old as ActiveCallRow;
                            setActiveCalls((prev) => prev.filter((c) => c.id !== gone.id));
                            // The finished call lands in `calls` via webhook; pull it
                            // into the thread so the live card becomes a real one.
                            router.refresh();
                        }
                    }
                )
                .subscribe();

            channelRef.current = channel;
        };

        buildSubscription();

        // Periodically refresh token + rebuild subscription.
        const refreshTimer = setInterval(async () => {
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
            clearInterval(refreshTimer);
            if (channelRef.current && supabaseRef.current) {
                supabaseRef.current.removeChannel(channelRef.current);
            }
        };
    }, [clientId, ensureClient, fetchActiveCalls, router]);

    return (
        <UniboxView
            threads={threads}
            agents={agents}
            activeCalls={activeCalls}
            clientId={clientId}
            initialAgentVapiId={initialAgentVapiId}
        />
    );
}
