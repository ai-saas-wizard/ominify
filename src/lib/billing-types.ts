// Billing Types - Client-safe constants

// Types that can be used on client side
export interface ClientBilling {
    id: string;
    client_id: string;
    price_per_minute: number;
    cost_per_minute: number;
    stripe_customer_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface MinuteBalance {
    id: string;
    client_id: string;
    balance_minutes: number;
    total_purchased_minutes: number;
    total_used_minutes: number;
    updated_at: string;
}

export interface MinutePurchase {
    id: string;
    client_id: string;
    minutes_purchased: number;
    amount_paid: number;
    stripe_payment_intent_id: string | null;
    stripe_checkout_session_id: string | null;
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    created_at: string;
}

export interface UsageRecord {
    id: string;
    client_id: string;
    vapi_call_id: string;
    duration_seconds: number;
    minutes_charged: number;
    cost_to_us: number;
    price_charged: number;
    recorded_at: string;
}

export interface UsageSummary {
    totalMinutesUsed: number;
    totalCostToUs: number;
    totalPriceCharged: number;
    profit: number;
}
