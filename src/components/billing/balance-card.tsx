import { Wallet } from "lucide-react";

interface BalanceCardProps {
    balance: number;
    totalPurchased: number;
    totalUsed: number;
}

export function BalanceCard({ balance, totalPurchased, totalUsed }: BalanceCardProps) {
    const usagePercentage = totalPurchased > 0
        ? Math.round((totalUsed / totalPurchased) * 100)
        : 0;

    return (
        <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-white/20 rounded-lg">
                    <Wallet className="w-6 h-6 text-white" />
                </div>
                <div>
                    <p className="text-sm text-violet-200">Current Balance</p>
                    <p className="text-3xl font-bold">
                        {balance.toFixed(0)} <span className="text-lg font-normal">mins</span>
                    </p>
                </div>
            </div>

            {/* Usage Bar */}
            <div className="mt-4">
                <div className="flex justify-between text-xs text-violet-200 mb-1">
                    <span>{totalUsed.toFixed(0)} used</span>
                    <span>{totalPurchased.toFixed(0)} purchased</span>
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-white rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                    />
                </div>
            </div>

            {balance < 10 && (
                <div className="mt-4 p-3 bg-red-500/20 rounded-lg border border-red-400/30">
                    <p className="text-sm font-medium">⚠️ Low balance! Purchase more minutes to avoid service interruption.</p>
                </div>
            )}
        </div>
    );
}
