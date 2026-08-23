import { isCampaignApproved } from "@/lib/a2p-status";
import "server-only";
import { supabase } from "@/lib/supabase";
import { resolveTwilioAccountSid } from "@/lib/twilio-account";

/**
 * Tenant channel capability, the single source of truth for which outreach
 * channels (sms / email / voice) a tenant can ACTUALLY send on, derived from
 * provisioning state instead of hardcoded lists.
 *
 * Each check mirrors the sequencer worker's send path so "offered" always
 * equals "sendable":
 * - sms   → sequencer/src/workers/sms-worker.ts getTenantTwilioConfig
 * - email → sequencer/src/workers/email-worker.ts getTenantEmailConfig
 *           (tightened with is_verified: we deliberately under-offer rather
 *           than offer a channel that may bounce)
 * - voice → an outbound agent with a VAPI assistant
 *
 * KEEP IN SYNC with sequencer/src/lib/channel-capabilities.ts, the sequencer
 * is a separate build and duplicates these queries for its runtime guard.
 */

export type ChannelReadiness = {
    sms: { ready: boolean; reason?: string };
    email: { ready: boolean; reason?: string };
    voice: { ready: boolean; reason?: string };
};

export type CapableChannel = "sms" | "email" | "voice";

async function checkSmsCapability(
    clientId: string
): Promise<{ ready: boolean; reason?: string }> {
    const { data: twilioAccount } = await supabase
        .from("tenant_twilio_accounts")
        .select(
            "account_type, subaccount_sid, external_account_sid, auth_token_encrypted, messaging_service_sid"
        )
        .eq("client_id", clientId)
        .eq("status", "active")
        .maybeSingle();

    // BYOA tenants keep their SID in external_account_sid, see lib/twilio-account.ts.
    // Split the two failures: "no account SID" and "no token" are different fixes,
    // and the old single message ("No active Twilio subaccount provisioned") was
    // actively wrong for BYOA.
    if (!twilioAccount) {
        return { ready: false, reason: "No active Twilio account connected" };
    }
    if (!resolveTwilioAccountSid(twilioAccount)) {
        return { ready: false, reason: "No Twilio account SID on file" };
    }
    if (!twilioAccount.auth_token_encrypted) {
        return { ready: false, reason: "No Twilio auth token on file" };
    }

    // The sms-worker sends via messagingServiceSid OR a sequencer phone number.
    if (!twilioAccount.messaging_service_sid) {
        const { data: phoneNumbers } = await supabase
            .from("tenant_phone_numbers")
            .select("id")
            .eq("client_id", clientId)
            .eq("status", "active")
            .eq("purpose", "sequencer")
            .limit(1);

        if (!phoneNumbers || phoneNumbers.length === 0) {
            return { ready: false, reason: "No active phone number for outreach" };
        }
    }

    // A2P status is informational only. The sms-worker still sends while a
    // campaign is pending (at reduced throughput), so it must not gate the
    // channel. It must also not cry wolf: this used to compare against a
    // lowercase "approved" while Twilio returns VERIFIED, so fully registered
    // tenants were permanently annotated as if something were wrong.
    const { data: a2p } = await supabase
        .from("tenant_a2p_registrations")
        .select("campaign_status")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (a2p && !isCampaignApproved(a2p.campaign_status)) {
        return { ready: true, reason: `A2P campaign status: ${a2p.campaign_status}` };
    }

    return { ready: true };
}

async function checkEmailCapability(
    clientId: string
): Promise<{ ready: boolean; reason?: string }> {
    const { data: emailAccount } = await supabase
        .from("tenant_email_accounts")
        .select("is_verified")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .maybeSingle();

    if (!emailAccount) {
        return { ready: false, reason: "No email account configured" };
    }
    if (!emailAccount.is_verified) {
        return { ready: false, reason: "Email account not verified" };
    }
    return { ready: true };
}

async function checkVoiceCapability(
    clientId: string,
    agentId?: string | null
): Promise<{ ready: boolean; reason?: string }> {
    // Outbound calls require an outbound-capable agent with a VAPI assistant.
    // When a specific agent is bound, THAT agent must be voice-capable.
    let query = supabase
        .from("agents")
        .select("id")
        .eq("client_id", clientId)
        .eq("agent_type", "outbound")
        .not("vapi_id", "is", null)
        .limit(1);
    if (agentId) query = query.eq("id", agentId);

    const { data: agents, error } = await query;

    if (error || !agents || agents.length === 0) {
        return {
            ready: false,
            reason: agentId
                ? "The bound agent has no voice assistant"
                : "No outbound agent configured. Create one from the Agents page.",
        };
    }
    return { ready: true };
}

/**
 * Full readiness report per channel (with human-readable reasons).
 * When agentId is provided, voice is checked against that specific agent.
 */
export async function getChannelCapabilities(
    clientId: string,
    agentId?: string | null
): Promise<ChannelReadiness> {
    try {
        const [sms, email, voice] = await Promise.all([
            checkSmsCapability(clientId),
            checkEmailCapability(clientId),
            checkVoiceCapability(clientId, agentId),
        ]);
        return { sms, email, voice };
    } catch (error) {
        console.error("getChannelCapabilities error:", error);
        return {
            sms: { ready: false, reason: "Failed to check SMS readiness" },
            email: { ready: false, reason: "Failed to check email readiness" },
            voice: { ready: false, reason: "Failed to check voice readiness" },
        };
    }
}

/**
 * The channels a dynamic-sequence strategy may offer the AI.
 * Order matters: dynamic-step-generator falls back to the FIRST entry when the
 * LLM picks an invalid channel, so sms (cheapest, least intrusive) leads.
 */
export async function deriveAvailableChannels(
    clientId: string,
    agentId?: string | null
): Promise<CapableChannel[]> {
    const readiness = await getChannelCapabilities(clientId, agentId);
    const ordered: CapableChannel[] = ["sms", "voice", "email"];
    return ordered.filter((ch) => readiness[ch].ready);
}
