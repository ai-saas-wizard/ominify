import { getOrCreateMinuteBalance, getOrCreateClientBilling, getClientUsageRecords, getClientPurchases, getClientUsageSummary } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft, CreditCard, Clock } from "lucide-react";
import { BalanceCard } from "@/components/billing/balance-card";
import { UsageTable } from "@/components/billing/usage-table";
import { PurchaseModal } from "@/components/billing/purchase-modal";

export default async function ClientBillingPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    // Fetch client info
    const { data: client } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('id', clientId)
        .single();

    if (!client) {
        return <div className="p-8 text-center text-red-600">Client not found</div>;
    }

    const [balance, billing, usageRecords, purchases, usageSummary] = await Promise.all([
        getOrCreateMinuteBalance(clientId),
        getOrCreateClientBilling(clientId),
        getClientUsageRecords(clientId, 20),
        getClientPurchases(clientId, 10),
        getClientUsageSummary(clientId)
    ]);

    return (
        <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <Link
                    href={`/client/${clientId}`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">Billing & Usage</h1>
                <p className="mt-1 text-gray-600">Manage your voice minutes and view usage history</p>
            </div>

            {/* Balance and Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <BalanceCard
                    balance={balance.balance_minutes}
                    totalPurchased={balance.total_purchased_minutes}
                    totalUsed={balance.total_used_minutes}
                />

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 rounded-lg">
                            <Clock className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Minutes Used</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {usageSummary.totalMinutesUsed.toFixed(0)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-100 rounded-lg">
                            <CreditCard className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Your Rate</p>
                            <p className="text-2xl font-bold text-gray-900">
                                ${billing.price_per_minute.toFixed(2)}/min
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Buy Minutes Section */}
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">Need more minutes?</h2>
                        <p className="text-violet-200 mt-1">Purchase any amount at ${billing.price_per_minute.toFixed(2)} per minute</p>
                    </div>
                    <PurchaseModal
                        clientId={clientId}
                        email={client.email || ""}
                        pricePerMinute={billing.price_per_minute}
                    />
                </div>
            </div>

            {/* Usage History */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">Recent Usage</h2>
                    <p className="text-sm text-gray-500">Your call history with minute breakdown</p>
                </div>
                <UsageTable records={usageRecords} />
            </div>

            {/* Purchase History */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">Purchase History</h2>
                </div>
                <div className="divide-y divide-gray-200">
                    {purchases.map((purchase) => (
                        <div key={purchase.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <p className="font-medium text-gray-900">
                                    {purchase.minutes_purchased} Minutes
                                </p>
                                <p className="text-sm text-gray-500">
                                    {new Date(purchase.created_at).toLocaleDateString()}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="font-medium text-gray-900">
                                    ${purchase.amount_paid.toFixed(2)}
                                </p>
                                <span className={`text-xs px-2 py-1 rounded-full ${purchase.status === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : purchase.status === 'pending'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}>
                                    {purchase.status}
                                </span>
                            </div>
                        </div>
                    ))}
                    {purchases.length === 0 && (
                        <div className="px-6 py-12 text-center text-gray-500">
                            No purchases yet. Buy your first minute package above!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
