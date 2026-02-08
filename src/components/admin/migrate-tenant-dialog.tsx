"use client";

import { useState, useEffect } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { getUmbrellas, migrateTenant } from "@/app/actions/umbrella-actions";

type UmbrellaOption = {
    id: string;
    name: string;
    concurrency_limit: number;
    current_concurrency: number;
};

type MigrateTenantDialogProps = {
    clientId: string;
    clientName: string;
    currentUmbrellaId: string;
    onComplete?: () => void;
};

export function MigrateTenantDialog({
    clientId,
    clientName,
    currentUmbrellaId,
    onComplete,
}: MigrateTenantDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [umbrellas, setUmbrellas] = useState<UmbrellaOption[]>([]);
    const [loadingUmbrellas, setLoadingUmbrellas] = useState(false);
    const [targetUmbrellaId, setTargetUmbrellaId] = useState("");
    const [reason, setReason] = useState("");

    useEffect(() => {
        if (isOpen && umbrellas.length === 0) {
            setLoadingUmbrellas(true);
            getUmbrellas().then((data) => {
                const available = (data as UmbrellaOption[]).filter(
                    (u) => u.id !== currentUmbrellaId
                );
                setUmbrellas(available);
                setLoadingUmbrellas(false);
            });
        }
    }, [isOpen, umbrellas.length, currentUmbrellaId]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!targetUmbrellaId) return;

        setLoading(true);
        const res = await migrateTenant(clientId, targetUmbrellaId, reason || "manual", "admin");
        setLoading(false);

        if (res.success) {
            setIsOpen(false);
            setTargetUmbrellaId("");
            setReason("");
            onComplete?.();
        } else {
            alert(res.error || "Migration failed");
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        setTargetUmbrellaId("");
        setReason("");
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
                <ArrowRightLeft className="w-3 h-3" />
                Migrate
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b">
                            <h3 className="font-semibold text-lg">Migrate Tenant</h3>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Move <span className="font-medium text-gray-900">{clientName}</span> to
                                a different umbrella.
                            </p>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Current Umbrella
                                </label>
                                <div className="w-full p-2 border rounded-lg bg-gray-50 text-sm text-gray-500">
                                    {loadingUmbrellas ? (
                                        <span className="flex items-center gap-2">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Loading...
                                        </span>
                                    ) : (
                                        currentUmbrellaId
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Target Umbrella
                                </label>
                                {loadingUmbrellas ? (
                                    <div className="flex items-center gap-2 text-sm text-gray-500 p-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading umbrellas...
                                    </div>
                                ) : umbrellas.length === 0 ? (
                                    <div className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3">
                                        No other umbrellas available to migrate to.
                                    </div>
                                ) : (
                                    <select
                                        value={targetUmbrellaId}
                                        onChange={(e) => setTargetUmbrellaId(e.target.value)}
                                        required
                                        className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">Select target umbrella...</option>
                                        {umbrellas.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.name} ({u.current_concurrency}/{u.concurrency_limit}{" "}
                                                slots used)
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Reason
                                    <span className="text-xs text-gray-400 ml-1">(optional)</span>
                                </label>
                                <input
                                    type="text"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="e.g., capacity rebalancing, client request..."
                                    className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {targetUmbrellaId && (
                                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                                    <p className="text-xs text-amber-700">
                                        This will update the tenant&apos;s VAPI credentials to match the
                                        target umbrella. Active calls may be affected.
                                    </p>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading || !targetUmbrellaId || umbrellas.length === 0}
                                    className="px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                                    Confirm Migration
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
