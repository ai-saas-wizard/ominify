/**
 * Fold in-progress calls (the `active_calls` realtime table) into the
 * server-built threads so a live conversation shows up at the top of the
 * lead's timeline instead of in a separate list. Client-safe.
 */

import type { UniboxAgentOption, UniboxEvent, UniboxThread } from "./types";
import { normalizePhone, parseTranscript } from "./parse";

export interface ActiveCallRow {
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

export function mergeLiveCalls(
    threads: UniboxThread[],
    activeCalls: ActiveCallRow[],
    agents: UniboxAgentOption[]
): UniboxThread[] {
    if (activeCalls.length === 0) return threads;

    const byPhone = new Map<string, UniboxThread>();
    for (const t of threads) {
        const p = normalizePhone(t.phone);
        if (p && !byPhone.has(p)) byPhone.set(p, t);
    }
    const agentByVapi = new Map(agents.map((a) => [a.vapiId, a]));

    const patched = new Map<string, UniboxThread>();
    const synthetic: UniboxThread[] = [];

    for (const call of activeCalls) {
        const phone = normalizePhone(call.customer_number);
        const agent = call.assistant_id ? agentByVapi.get(call.assistant_id) : undefined;
        const event: UniboxEvent = {
            id: `live:${call.vapi_call_id}`,
            kind: "voice",
            direction: call.type === "inboundPhoneCall" ? "inbound" : "outbound",
            at: call.started_at,
            body: call.transcript ?? undefined,
            summary: call.summary ?? undefined,
            transcript: parseTranscript(call.transcript),
            disposition: "live",
            agentName: agent?.name,
            agentVapiId: call.assistant_id ?? undefined,
            providerId: call.vapi_call_id,
            isLive: true,
        };

        const existing = phone ? patched.get(phone) ?? byPhone.get(phone) : undefined;
        if (existing) {
            const events = [...existing.events.filter((e) => e.id !== event.id), event];
            patched.set(phone!, {
                ...existing,
                events,
                touches: events.length,
                channelCounts: { ...existing.channelCounts, voice: (existing.channelCounts.voice ?? 0) + 1 },
                lastActivityAt: call.started_at,
                preview: "Live call in progress",
                hasLiveCall: true,
                agentName: existing.agentName ?? agent?.name ?? null,
                agentVapiId: existing.agentVapiId ?? call.assistant_id ?? null,
            });
            continue;
        }

        synthetic.push({
            id: phone ? `phone:${phone}` : `live:${call.vapi_call_id}`,
            contactId: null,
            name: null,
            phone,
            email: null,
            location: null,
            company: null,
            agentName: agent?.name ?? null,
            agentVapiId: call.assistant_id ?? null,
            sequenceName: null,
            sequenceProgress: null,
            events: [event],
            channelCounts: { voice: 1 },
            touches: 1,
            firstTouchAt: call.started_at,
            lastActivityAt: call.started_at,
            lastResponseAt: null,
            status: "new",
            preview: "Live call in progress",
            needsReply: false,
            appointmentBooked: false,
            optedOut: false,
            hasLiveCall: true,
            engagementScore: null,
            sentimentTrend: null,
            pipelineStage: null,
        });
    }

    const merged = threads.map((t) => {
        const p = normalizePhone(t.phone);
        return (p && patched.get(p)?.id === t.id ? patched.get(p) : undefined) ?? t;
    });
    return [...synthetic, ...merged];
}
