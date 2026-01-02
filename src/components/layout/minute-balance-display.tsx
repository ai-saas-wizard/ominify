"use client";

import { useEffect, useState } from "react";
import { Zap, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface MinuteBalanceDisplayProps {
    clientId: string;
}

export function MinuteBalanceDisplay({ clientId }: MinuteBalanceDisplayProps) {
    const [balance, setBalance] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchBalance() {
            try {
                const res = await fetch(`/api/client/${clientId}/balance`);
                if (res.ok) {
                    const data = await res.json();
                    setBalance(data.balance_minutes);
                }
            } catch (err) {
                console.error('Failed to fetch balance:', err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchBalance();
    }, [clientId]);

    if (isLoading) {
        return (
            <div className="animate-pulse">
                <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                    <div className="space-y-1">
                        <div className="h-3 w-16 bg-gray-200 rounded" />
                        <div className="h-3 w-12 bg-gray-200 rounded" />
                    </div>
                </div>
            </div>
        );
    }

    const displayBalance = balance ?? 0;
    const isLow = displayBalance <= 10;
    const isNegative = displayBalance < 0;

    return (
        <>
            <div className="flex items-center gap-3 mb-4 px-2">
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-bold ${isNegative
                        ? 'border-red-300 text-red-600 bg-red-50'
                        : isLow
                            ? 'border-orange-300 text-orange-600 bg-orange-50'
                            : 'border-green-300 text-green-600 bg-green-50'
                    }`}>
                    {isNegative ? <AlertTriangle className="w-3 h-3" /> : `${Math.min(Math.max(displayBalance, 0), 99)}`}
                </div>
                <div className="text-xs">
                    <div className={`font-medium ${isNegative ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-gray-900'
                        }`}>
                        {isNegative ? 'Overdue' : isLow ? 'Low Balance' : 'Balance'}
                    </div>
                    <div className={isNegative ? 'text-red-500' : isLow ? 'text-orange-500' : 'text-gray-500'}>
                        {displayBalance.toFixed(0)} MIN
                    </div>
                </div>
            </div>
            <Link
                href={`/client/${clientId}/billing`}
                className="w-full bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors mb-4"
            >
                <Zap className="w-3 h-3 fill-current" />
                {isLow ? 'Buy Minutes' : 'Manage Billing'}
            </Link>
        </>
    );
}
