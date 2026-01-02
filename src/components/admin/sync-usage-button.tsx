"use client";

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle } from "lucide-react";

export function SyncUsageButton() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [result, setResult] = useState<{
        success: boolean;
        clientsSynced?: number;
        totalSynced?: number;
        error?: string;
    } | null>(null);

    const handleSync = async () => {
        setIsSyncing(true);
        setResult(null);

        try {
            const res = await fetch('/api/admin/sync-usage', {
                method: 'POST',
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Sync failed');
            }

            setResult({
                success: true,
                clientsSynced: data.clientsSynced,
                totalSynced: data.totalSynced,
            });
        } catch (err: any) {
            setResult({
                success: false,
                error: err.message,
            });
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-600">
                Sync call usage data from Vapi for all clients. This will update minute balances and record any new calls.
            </p>

            <button
                onClick={handleSync}
                disabled={isSyncing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isSyncing ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Syncing...
                    </>
                ) : (
                    <>
                        <RefreshCw className="w-4 h-4" />
                        Sync Now
                    </>
                )}
            </button>

            {result && (
                <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    {result.success ? (
                        <div className="flex items-start gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                            <div>
                                <p className="font-medium text-green-800">Sync completed!</p>
                                <p className="text-sm text-green-700 mt-1">
                                    Synced {result.clientsSynced} clients, {result.totalSynced} new usage records.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-red-700">{result.error}</p>
                    )}
                </div>
            )}
        </div>
    );
}
