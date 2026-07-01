/**
 * Agent Messaging Resolver
 *
 * Resolves the per-channel messaging assets for the agent a sequence is bound
 * to (`sequences.agent_id`). The main app stores these on `agents.agent_config`
 * at deploy / edit time:
 *   - sms_prompt          — the SMS persona + instructions (how to text)
 *   - sms_first_message   — the SMS opening template
 *   - shared_context      — the offer facts that bleed into BOTH channels
 *                           (product, value props, objections, pricing, ICP…)
 *   - voice_prompt        — the full voice system prompt (durable copy)
 *   - vapi_id             — the VAPI assistant id used to place voice calls
 *
 * This lets the sequencer "adapt personality" per channel at runtime: the
 * agent's voice assistant for calls, its SMS persona + shared context for
 * texts. Resolution is live (no process-lifetime cache) so prompt edits in the
 * dashboard take effect on the next message without recreating the sequence.
 */

import { supabase } from './db.js';

export interface AgentMessaging {
    agentId: string;
    vapiId: string | null;
    smsPrompt: string | null;
    smsFirstMessage: string | null;
    voicePrompt: string | null;
    sharedContext: Record<string, any> | null;
    /** Pre-formatted, prompt-ready block of the shared offer context. */
    sharedContextText: string;
}

/**
 * Load the bound agent's messaging assets. Returns null when no agent is bound
 * or the row/config is missing — callers fall back to their prior behavior.
 */
export async function getAgentMessaging(
    agentId: string | null | undefined
): Promise<AgentMessaging | null> {
    if (!agentId) return null;

    const { data, error } = await supabase
        .from('agents')
        .select('id, vapi_id, agent_config')
        .eq('id', agentId)
        .single();

    if (error || !data) {
        if (error) console.error('[AGENT-MSG] Failed to load agent', agentId, error.message);
        return null;
    }

    const cfg = (data.agent_config || {}) as Record<string, any>;
    const sharedContext = (cfg.shared_context as Record<string, any>) || null;

    return {
        agentId: data.id,
        vapiId: data.vapi_id || null,
        smsPrompt: cfg.sms_prompt || null,
        smsFirstMessage: cfg.sms_first_message || null,
        voicePrompt: cfg.voice_prompt || null,
        sharedContext,
        sharedContextText: formatSharedContext(sharedContext),
    };
}

/**
 * Render the shared offer context object into a labeled, prompt-ready block.
 * Vertical-agnostic: only the keys present are emitted. Returns '' when empty.
 */
export function formatSharedContext(ctx: Record<string, any> | string | null | undefined): string {
    if (!ctx) return '';
    // Operators can save free-text context from the agent editor; render it
    // verbatim instead of silently dropping it (string has none of the keys).
    if (typeof ctx === 'string') {
        const text = ctx.trim();
        if (!text) return '';
        return (
            "SHARED OFFER CONTEXT (what we sell — keep messaging consistent with this; " +
            "it's the same context the voice agent uses on calls):\n" + text
        );
    }
    const lines: string[] = [];
    const push = (label: string, val: any) => {
        if (val === undefined || val === null || val === '') return;
        const text = Array.isArray(val) ? val.filter(Boolean).join(', ') : String(val);
        if (text.trim()) lines.push(`- ${label}: ${text.trim()}`);
    };

    push('Company', ctx.company_name);
    push('Product', ctx.product_one_liner);
    push('Who we reach', ctx.icp);
    push('Value props', ctx.value_props);
    push('Common objections', ctx.common_objections);
    push('Pricing', ctx.pricing_summary);
    push('Markets', ctx.markets);
    push('Deal types', ctx.deal_types);
    push('Appointment type', ctx.appointment_type);
    push('Persona', ctx.persona_name);
    push('Goal', ctx.goal);

    if (lines.length === 0) return '';
    return (
        "SHARED OFFER CONTEXT (what we sell — keep messaging consistent with this; " +
        "it's the same context the voice agent uses on calls):\n" +
        lines.join('\n')
    );
}
