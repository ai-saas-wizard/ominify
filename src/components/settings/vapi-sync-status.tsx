"use client";

import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export function VapiSyncStatus({ clientId }: { clientId: string }) {
    const [status, setStatus] = useState<{
        orgId: string | null;
        isConfigured: boolean;
    } | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        try {
            const res = await fetch(`/api/client/${clientId}/vapi-sync`);
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch (err) {
            console.error('Error fetching status:', err);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, [clientId]);

    const handleSync = async () => {
        setSyncing(true);
        setError(null);

        try {
            const res = await fetch(`/api/client/${clientId}/vapi-sync`, {
                method: 'POST'
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error);
            } else {
                setStatus({ orgId: data.orgId, isConfigured: true });
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Vapi Integration</h3>
                    <p className="text-sm text-gray-500">
                        Link your Vapi account to enable contact auto-creation
                    </p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                    {syncing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <RefreshCw className="w-4 h-4" />
                    )}
                    Sync
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 mb-4">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    {error}
                </div>
            )}

            <div className="flex items-center gap-3">
                {status?.isConfigured ? (
                    <>
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <div>
                            <p className="text-sm font-medium text-gray-900">Connected</p>
                            <p className="text-xs text-gray-500 font-mono">
                                Org ID: {status.orgId}
                            </p>
                        </div>
                    </>
                ) : (
                    <>
                        <AlertCircle className="w-5 h-5 text-amber-500" />
                        <div>
                            <p className="text-sm font-medium text-gray-900">Not Connected</p>
                            <p className="text-xs text-gray-500">
                                Click Sync to link your Vapi organization
                            </p>
                        </div>
                    </>
                )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                    <strong>Why sync?</strong> When calls come in, we use the Vapi Org ID to identify
                    which client the call belongs to, enabling automatic contact creation.
                </p>
            </div>
        </div>
    );
}
