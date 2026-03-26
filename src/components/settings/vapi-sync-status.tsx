"use client";

import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fadeIn } from "@/lib/settings-animations";

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
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Vapi Integration</h3>
                    <p className="text-sm text-gray-500">
                        Link your Vapi account to enable contact auto-creation
                    </p>
                </div>
                <Button
                    onClick={handleSync}
                    disabled={syncing}
                    className="bg-emerald-600 hover:bg-emerald-700"
                >
                    {syncing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <RefreshCw className="w-4 h-4" />
                    )}
                    Sync
                </Button>
            </CardHeader>

            <CardContent className="space-y-4">
                <AnimatePresence>
                    {error && (
                        <motion.div
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600"
                        >
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex items-center gap-3">
                    {status?.isConfigured ? (
                        <>
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium text-gray-900">Connected</p>
                                    <Badge className="bg-green-100 text-green-700 border-green-200">Active</Badge>
                                </div>
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

                <div className="pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500">
                        <strong>Why sync?</strong> When calls come in, we use the Vapi Org ID to identify
                        which client the call belongs to, enabling automatic contact creation.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
