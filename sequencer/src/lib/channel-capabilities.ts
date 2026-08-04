/**
 * Tenant channel capability — runtime guard for the dynamic step generator and
 * dispatch paths: which channels (sms / email / voice) a tenant can ACTUALLY
 * send on, derived from provisioning state. A stale sequence_strategy can
 * therefore never make the AI pick a dead channel.
 *
 * Each check mirrors the corresponding worker's send path:
 * - sms   → sms-worker.ts getTenantTwilioConfig (active subaccount with
 *           sid+token, sending via messaging service OR a sequencer phone)
 * - email → email-worker.ts getTenantEmailConfig (is_active), tightened with
 *           is_verified (deliberate under-offer)
 * - voice → an outbound agent with a VAPI assistant
 *
 * KEEP IN SYNC with src/lib/channels/capabilities.ts in the main app — the
 * app derives available_channels at creation time from the same queries.
 */

import { supabase } from './db.js';
import type { ChannelType } from './types.js';
import { resolveTwilioAccountSid } from './twilio-account.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
    channels: ChannelType[];
    expiresAt: number;
}

// Generation fires per outcome across many leads of the same tenant — cache
// the (rarely changing) provisioning lookups for a few minutes.
const cache = new Map<string, CacheEntry>();

// Each checker THROWS on query errors (supabase-js returns them in-band, it
// does not reject) so the caller's catch can fail open instead of a transient
// DB blip reading as "not provisioned" and getting cached.
async function checkSmsCapable(clientId: string): Promise<boolean> {
    const { data: twilioAccount, error } = await supabase
        .from('tenant_twilio_accounts')
        .select('account_type, subaccount_sid, external_account_sid, auth_token_encrypted, messaging_service_sid')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .maybeSingle();
    if (error) throw new Error(`tenant_twilio_accounts query failed: ${error.message}`);

    // BYOA tenants keep their SID in external_account_sid — see lib/twilio-account.ts.
    if (!resolveTwilioAccountSid(twilioAccount) || !twilioAccount?.auth_token_encrypted) return false;
    if (twilioAccount.messaging_service_sid) return true;

    const { data: phoneNumbers, error: phoneError } = await supabase
        .from('tenant_phone_numbers')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .eq('purpose', 'sequencer')
        .limit(1);
    if (phoneError) throw new Error(`tenant_phone_numbers query failed: ${phoneError.message}`);

    return !!phoneNumbers && phoneNumbers.length > 0;
}

async function checkEmailCapable(clientId: string): Promise<boolean> {
    const { data: emailAccount, error } = await supabase
        .from('tenant_email_accounts')
        .select('is_verified')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw new Error(`tenant_email_accounts query failed: ${error.message}`);

    return !!emailAccount?.is_verified;
}

async function checkVoiceCapable(clientId: string, agentId?: string | null): Promise<boolean> {
    let query = supabase
        .from('agents')
        .select('id')
        .eq('client_id', clientId)
        .eq('agent_type', 'outbound')
        .not('vapi_id', 'is', null)
        .limit(1);
    if (agentId) query = query.eq('id', agentId);

    const { data: agents, error } = await query;
    if (error) throw new Error(`agents query failed: ${error.message}`);
    return !!agents && agents.length > 0;
}

/**
 * Dispatch-time email gate for the scheduler. Mirrors the email-worker's
 * ACTUAL send path (getTenantEmailConfig): any is_active account row sends
 * regardless of is_verified, and with no row it falls back to platform env
 * SMTP. Deliberately looser than checkEmailCapable, which is the
 * creation/generation-time offering check.
 */
export async function isEmailDispatchable(clientId: string): Promise<boolean> {
    try {
        const { data: emailAccount, error } = await supabase
            .from('tenant_email_accounts')
            .select('id')
            .eq('client_id', clientId)
            .eq('is_active', true)
            .maybeSingle();
        if (error) throw new Error(`tenant_email_accounts query failed: ${error.message}`);
        if (emailAccount) return true;
        // email-worker returns null only when BOTH are unset.
        return !!(process.env.SMTP_HOST || process.env.SMTP_USER);
    } catch (err) {
        console.error(`[CHANNELS] Email dispatchability check failed for ${clientId}:`, err);
        // Fail open: let the email worker's own config resolution decide.
        return true;
    }
}

/**
 * The channels this tenant can send on right now, ordered [sms, voice, email]
 * (the generator's invalid-channel fallback picks index 0 — sms is safest).
 * Cached per (clientId, agentId) for ~5 minutes.
 */
export async function getTenantCapableChannels(
    clientId: string,
    agentId?: string | null
): Promise<ChannelType[]> {
    const key = `${clientId}:${agentId || ''}`;
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.channels;

    try {
        const [sms, email, voice] = await Promise.all([
            checkSmsCapable(clientId),
            checkEmailCapable(clientId),
            checkVoiceCapable(clientId, agentId),
        ]);

        const channels: ChannelType[] = [];
        if (sms) channels.push('sms');
        if (voice) channels.push('voice');
        if (email) channels.push('email');

        cache.set(key, { channels, expiresAt: Date.now() + CACHE_TTL_MS });
        return channels;
    } catch (err) {
        console.error(`[CHANNELS] Capability check failed for ${clientId}:`, err);
        // Fail open on transient errors: an over-offered channel fails at the
        // worker with a logged error, while failing closed would silently end
        // every enrollment with no_valid_channels.
        return ['sms', 'voice', 'email'];
    }
}
