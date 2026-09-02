/**
 * Pure helpers for reading a VAPI call's state (used by the vapi-worker's
 * start-error verification). Kept side-effect free so scripts can import
 * them without starting a worker.
 */

/** GET /call/{id} — the fields we classify on. */
export interface VapiCallState {
    status?: string;
    endedReason?: string;
    startedAt?: string | null;
}

/**
 * 'start_error': ended without ever starting (call.start.error-*) — VAPI
 *                sends no webhook for these, so the caller must clean up.
 * 'pending':     still queued/ringing — check again later.
 * 'ok':          in progress or ended normally — the webhook path owns it.
 */
export function classifyCallStart(call: VapiCallState): 'start_error' | 'pending' | 'ok' {
    if (call.status === 'ended') {
        return (call.endedReason || '').startsWith('call.start.error') ? 'start_error' : 'ok';
    }
    if (call.status === 'queued' || call.status === 'ringing') return 'pending';
    return 'ok';
}

export async function fetchVapiCall(callId: string, vapiApiKey: string): Promise<VapiCallState> {
    const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { Authorization: `Bearer ${vapiApiKey}` },
    });
    if (!res.ok) throw new Error(`VAPI GET /call/${callId} -> HTTP ${res.status}`);
    return (await res.json()) as VapiCallState;
}
