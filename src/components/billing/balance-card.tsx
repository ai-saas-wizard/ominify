import { Wallet } from "lucide-react";

interface BalanceCardProps {
    balance: number;             // top-up bucket (uncapped)
    totalPurchased: number;
    totalUsed: number;
    subscriptionMinutes: number; // subscription bucket (rolls over to cap)
    rolloverCap: number;
}

export function BalanceCard({
    balance,
    totalPurchased,
    totalUsed,
    subscriptionMinutes,
    rolloverCap,
}: BalanceCardProps) {
    const total = balance + subscriptionMinutes;
    const subPct = rolloverCap > 0 ? Math.min(100, (subscriptionMinutes / rolloverCap) * 100) : 0;

    return (
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-white/20 rounded-lg">
                    <Wallet className="w-6 h-6 text-white" />
                </div>
                <div>
                    <p className="text-sm text-emerald-200">Available Minutes</p>
                    <p className="text-3xl font-bold">
                        {total.toFixed(0)} <span className="text-lg font-normal">mins</span>
                    </p>
                </div>
            </div>

            {/* Subscription bucket */}
            <div className="mt-4">
                <div className="flex justify-between text-xs text-emerald-200 mb-1">
                    <span>Subscription</span>
                    <span>
                        {subscriptionMinutes.toFixed(0)} / {rolloverCap.toLocaleString()} cap
                    </span>
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-white rounded-full transition-all duration-500"
                        style={{ width: `${subPct}%` }}
                    />
                </div>
            </div>

            {/* Top-up bucket */}
            <div className="mt-3">
                <div className="flex justify-between text-xs text-emerald-200 mb-1">
                    <span>Top-up</span>
                    <span>{balance.toFixed(0)} mins</span>
                </div>
            </div>

            {/* Lifetime usage */}
            <div className="mt-3 text-xs text-emerald-200">
                Lifetime: {totalUsed.toFixed(0)} used · {totalPurchased.toFixed(0)} purchased
            </div>

            {total < 10 && (
                <div className="mt-4 p-3 bg-red-500/20 rounded-lg border border-red-400/30">
                    <p className="text-sm font-medium">
                        Low balance. Purchase more minutes or wait for renewal to avoid service interruption.
                    </p>
                </div>
            )}
        </div>
    );
}
