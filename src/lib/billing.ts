import { supabase } from './supabase';

// Re-export types and constants from billing-types (client-safe)
export {
    MINUTE_PACKAGES,
    type ClientBilling,
    type MinuteBalance,
    type MinutePurchase,
    type UsageRecord,
    type UsageSummary
} from './billing-types';

// Import types for use in this file
import type { ClientBilling, MinuteBalance, MinutePurchase, UsageRecord, UsageSummary } from './billing-types';

/**
 * Get or create billing config for a client
 */
export async function getOrCreateClientBilling(clientId: string): Promise<ClientBilling> {
    // Try to get existing
    const { data: existing } = await supabase
        .from('client_billing')
        .select('*')
        .eq('client_id', clientId)
        .single();

    if (existing) return existing as ClientBilling;

    // Create new with defaults
    const { data: created, error } = await supabase
        .from('client_billing')
        .insert({ client_id: clientId })
        .select()
        .single();

    if (error) throw new Error(`Failed to create billing config: ${error.message}`);
    return created as ClientBilling;
}

/**
 * Update client pricing (Admin only)
 */
export async function updateClientPricing(
    clientId: string,
    pricePerMinute: number,
    costPerMinute: number
): Promise<ClientBilling> {
    const { data, error } = await supabase
        .from('client_billing')
        .upsert({
            client_id: clientId,
            price_per_minute: pricePerMinute,
            cost_per_minute: costPerMinute,
            updated_at: new Date().toISOString()
        }, { onConflict: 'client_id' })
        .select()
        .single();

    if (error) throw new Error(`Failed to update pricing: ${error.message}`);
    return data as ClientBilling;
}

/**
 * Get or create minute balance for a client
 */
export async function getOrCreateMinuteBalance(clientId: string): Promise<MinuteBalance> {
    const { data: existing } = await supabase
        .from('minute_balances')
        .select('*')
        .eq('client_id', clientId)
        .single();

    if (existing) return existing as MinuteBalance;

    const { data: created, error } = await supabase
        .from('minute_balances')
        .insert({ client_id: clientId })
        .select()
        .single();

    if (error) throw new Error(`Failed to create balance: ${error.message}`);
    return created as MinuteBalance;
}

/**
 * Add minutes to client balance (after successful purchase)
 */
export async function addMinutesToBalance(
    clientId: string,
    minutes: number,
    purchaseId?: string
): Promise<MinuteBalance> {
    const current = await getOrCreateMinuteBalance(clientId);

    const { data, error } = await supabase
        .from('minute_balances')
        .update({
            balance_minutes: current.balance_minutes + minutes,
            total_purchased_minutes: current.total_purchased_minutes + minutes,
            updated_at: new Date().toISOString()
        })
        .eq('client_id', clientId)
        .select()
        .single();

    if (error) throw new Error(`Failed to add minutes: ${error.message}`);
    return data as MinuteBalance;
}

/**
 * Deduct minutes from client balance (after call usage)
 */
export async function deductMinutesFromBalance(
    clientId: string,
    minutes: number
): Promise<{ success: boolean; newBalance: number }> {
    const current = await getOrCreateMinuteBalance(clientId);

    if (current.balance_minutes < minutes) {
        return { success: false, newBalance: current.balance_minutes };
    }

    const { data, error } = await supabase
        .from('minute_balances')
        .update({
            balance_minutes: current.balance_minutes - minutes,
            total_used_minutes: current.total_used_minutes + minutes,
            updated_at: new Date().toISOString()
        })
        .eq('client_id', clientId)
        .select()
        .single();

    if (error) throw new Error(`Failed to deduct minutes: ${error.message}`);
    return { success: true, newBalance: (data as MinuteBalance).balance_minutes };
}

/**
 * Record call usage
 */
export async function recordCallUsage(
    clientId: string,
    vapiCallId: string,
    durationSeconds: number
): Promise<UsageRecord> {
    // Get client pricing
    const billing = await getOrCreateClientBilling(clientId);

    // Get call details to find agent
    const { data: calldata } = await supabase
        .from('calls')
        .select('agent_id')
        .eq('vapi_call_id', vapiCallId)
        .single();

    let pricePerMinute = billing.price_per_minute;
    let costPerMinute = billing.cost_per_minute;

    // Check if agent has specific pricing
    if (calldata?.agent_id) {
        const { data: agent } = await supabase
            .from('agents')
            .select('price_per_minute, cost_per_minute')
            .eq('id', calldata.agent_id)
            .single();

        if (agent) {
            if (agent.price_per_minute !== null && agent.price_per_minute !== undefined) {
                pricePerMinute = agent.price_per_minute;
            }
            if (agent.cost_per_minute !== null && agent.cost_per_minute !== undefined) {
                costPerMinute = agent.cost_per_minute;
            }
        }
    }

    // Round up to nearest minute
    const minutesCharged = Math.ceil(durationSeconds / 60);

    // Calculate costs
    const costToUs = minutesCharged * costPerMinute;
    const priceCharged = minutesCharged * pricePerMinute;

    // Check if already recorded
    const { data: existing } = await supabase
        .from('usage_records')
        .select('*')
        .eq('vapi_call_id', vapiCallId)
        .single();

    if (existing) return existing as UsageRecord;

    // Record usage
    const { data, error } = await supabase
        .from('usage_records')
        .insert({
            client_id: clientId,
            vapi_call_id: vapiCallId,
            duration_seconds: durationSeconds,
            minutes_charged: minutesCharged,
            cost_to_us: costToUs,
            price_charged: priceCharged
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to record usage: ${error.message}`);

    // Deduct from balance
    await deductMinutesFromBalance(clientId, minutesCharged);

    return data as UsageRecord;
}

/**
 * Get usage summary for a client
 */
export async function getClientUsageSummary(clientId: string): Promise<UsageSummary> {
    const { data, error } = await supabase
        .from('usage_records')
        .select('minutes_charged, cost_to_us, price_charged')
        .eq('client_id', clientId);

    if (error) throw new Error(`Failed to get usage: ${error.message}`);

    const records = data || [];
    const totalMinutesUsed = records.reduce((sum, r) => sum + Number(r.minutes_charged), 0);
    const totalCostToUs = records.reduce((sum, r) => sum + Number(r.cost_to_us), 0);
    const totalPriceCharged = records.reduce((sum, r) => sum + Number(r.price_charged), 0);

    return {
        totalMinutesUsed,
        totalCostToUs,
        totalPriceCharged,
        profit: totalPriceCharged - totalCostToUs
    };
}

/**
 * Get recent usage records for a client
 */
export async function getClientUsageRecords(
    clientId: string,
    limit: number = 50
): Promise<UsageRecord[]> {
    const { data, error } = await supabase
        .from('usage_records')
        .select('*')
        .eq('client_id', clientId)
        .order('recorded_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(`Failed to get usage records: ${error.message}`);
    return (data || []) as UsageRecord[];
}

/**
 * Create a pending purchase record
 */
export async function createPurchaseRecord(
    clientId: string,
    minutes: number,
    amountPaid: number,
    stripeCheckoutSessionId: string
): Promise<MinutePurchase> {
    const { data, error } = await supabase
        .from('minute_purchases')
        .insert({
            client_id: clientId,
            minutes_purchased: minutes,
            amount_paid: amountPaid,
            stripe_checkout_session_id: stripeCheckoutSessionId,
            status: 'pending'
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to create purchase: ${error.message}`);
    return data as MinutePurchase;
}

/**
 * Complete a purchase (called after Stripe webhook confirms payment)
 */
export async function completePurchase(
    stripeCheckoutSessionId: string,
    stripePaymentIntentId?: string
): Promise<MinutePurchase | null> {
    // Find the purchase
    const { data: purchase } = await supabase
        .from('minute_purchases')
        .select('*')
        .eq('stripe_checkout_session_id', stripeCheckoutSessionId)
        .single();

    if (!purchase) return null;

    // Update status
    const { data, error } = await supabase
        .from('minute_purchases')
        .update({
            status: 'completed',
            stripe_payment_intent_id: stripePaymentIntentId
        })
        .eq('id', purchase.id)
        .select()
        .single();

    if (error) throw new Error(`Failed to complete purchase: ${error.message}`);

    // Add minutes to balance
    await addMinutesToBalance(purchase.client_id, purchase.minutes_purchased, purchase.id);

    return data as MinutePurchase;
}

/**
 * Get purchase history for a client
 */
export async function getClientPurchases(
    clientId: string,
    limit: number = 20
): Promise<MinutePurchase[]> {
    const { data, error } = await supabase
        .from('minute_purchases')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(`Failed to get purchases: ${error.message}`);
    return (data || []) as MinutePurchase[];
}

/**
 * Get all clients with their billing info (Admin)
 */
export async function getAllClientsBilling(): Promise<Array<{
    client: { id: string; name: string; email: string };
    billing: ClientBilling;
    balance: MinuteBalance;
}>> {
    const { data: clients } = await supabase
        .from('clients')
        .select('id, name, email');

    if (!clients) return [];

    const results = await Promise.all(
        clients.map(async (client) => {
            const billing = await getOrCreateClientBilling(client.id);
            const balance = await getOrCreateMinuteBalance(client.id);
            return { client, billing, balance };
        })
    );

    return results;
}

/**
 * Get platform-wide billing summary (Admin)
 */
export async function getPlatformBillingSummary(): Promise<{
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    totalMinutesSold: number;
    totalMinutesUsed: number;
}> {
    const { data: purchases } = await supabase
        .from('minute_purchases')
        .select('amount_paid, minutes_purchased')
        .eq('status', 'completed');

    const { data: usage } = await supabase
        .from('usage_records')
        .select('minutes_charged, cost_to_us, price_charged');

    const totalRevenue = (purchases || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const totalMinutesSold = (purchases || []).reduce((sum, p) => sum + Number(p.minutes_purchased), 0);

    const totalMinutesUsed = (usage || []).reduce((sum, u) => sum + Number(u.minutes_charged), 0);
    const totalCost = (usage || []).reduce((sum, u) => sum + Number(u.cost_to_us), 0);
    const totalPriceCharged = (usage || []).reduce((sum, u) => sum + Number(u.price_charged), 0);

    return {
        totalRevenue,
        totalCost,
        totalProfit: totalRevenue - totalCost,
        totalMinutesSold,
        totalMinutesUsed
    };
}
