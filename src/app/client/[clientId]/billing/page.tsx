import {
    getOrCreateMinuteBalance,
    getOrCreateClientBilling,
    getClientUsageRecords,
    getClientPurchases,
    getClientUsageSummary,
    getClientDailyUsage,
} from "@/lib/billing";
import { getActiveSubscription } from "@/lib/subscriptions";
import { getTierForClient } from "@/lib/pricing-tiers";
import { supabase } from "@/lib/supabase";
import { BillingClient } from "@/components/billing/billing-client";

export default async function ClientBillingPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    // account_type + grandfather flag drive what the plan panel is allowed to offer.
    const { data: client } = await supabase
        .from("clients")
        .select("id, name, email, account_type, subscription_grandfathered")
        .eq("id", clientId)
        .single();

    if (!client) {
        return <div className="p-8 text-center text-red-600">Client not found</div>;
    }

    const [
        balance,
        billing,
        usageRecords,
        purchases,
        usageSummary,
        dailyUsage,
        subscription,
        tier,
    ] = await Promise.all([
        getOrCreateMinuteBalance(clientId),
        getOrCreateClientBilling(clientId),
        getClientUsageRecords(clientId, 50),
        getClientPurchases(clientId, 25),
        getClientUsageSummary(clientId),
        getClientDailyUsage(clientId, 14),
        getActiveSubscription(clientId),
        getTierForClient(clientId),
    ]);

    return (
        <BillingClient
            clientId={clientId}
            email={client.email || ""}
            topUpMinutes={Number(balance.balance_minutes ?? 0)}
            planMinutes={Number(balance.subscription_minutes ?? 0)}
            planRolloverCap={Number(balance.subscription_rollover_cap ?? tier.rollover_cap)}
            totalPurchased={Number(balance.total_purchased_minutes ?? 0)}
            totalUsed={Number(balance.total_used_minutes ?? 0)}
            totalBilled={usageSummary.totalPriceCharged}
            pricePerMinute={billing.price_per_minute}
            planName={tier.display_name}
            planPriceUsd={tier.price_usd ?? null}
            planIncludedMinutes={Number(tier.rollover_cap ?? 0)}
            renewsAt={subscription?.current_period_end ?? null}
            grandfathered={!!client.subscription_grandfathered}
            isCustom={client.account_type === "CUSTOM"}
            dailyUsage={dailyUsage}
            usageRecords={usageRecords}
            purchases={purchases}
        />
    );
}
