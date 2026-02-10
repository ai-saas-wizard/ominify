"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { updateUmbrella } from "@/app/actions/umbrella-actions";

type UmbrellaData = {
    id: string;
    name: string;
    concurrency_limit: number;
    current_concurrency: number;
    tenant_count: number;
};

export function UmbrellaSettingsCard({ umbrella }: { umbrella: UmbrellaData }) {
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(false);
    const [concurrency, setConcurrency] = useState(umbrella.concurrency_limit);

    const costEstimate = concurrency * 10;
    const usagePercent = umbrella.concurrency_limit > 0
        ? Math.round((umbrella.current_concurrency / umbrella.concurrency_limit) * 100)
        : 0;

    const handleSave = async () => {
        setLoading(true);
        const formData = new FormData();
        formData.set("concurrency_limit", concurrency.toString());

        const res = await updateUmbrella(umbrella.id, formData);
        setLoading(false);

        if (res.success) {
            setEditing(false);
        } else {
            alert(res.error || "Failed to update");
        }
    };

    return (
        <div className="space-y-4">
            {/* Umbrella Info */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-900">{umbrella.name}</p>
                    <p className="text-xs text-gray-500">{umbrella.tenant_count} active tenant{umbrella.tenant_count !== 1 ? "s" : ""}</p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Active
                </span>
            </div>

            {/* Concurrency Usage */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Current Usage</span>
                    <span className="text-sm font-medium text-gray-900">
                        {umbrella.current_concurrency} / {umbrella.concurrency_limit} lines
                    </span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all ${
                            usagePercent >= 90
                                ? "bg-red-500"
                                : usagePercent >= 70
                                  ? "bg-amber-500"
                                  : "bg-indigo-500"
                        }`}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                </div>
            </div>

            {/* Concurrency Limit Editor */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Concurrency Limit</label>
                    {!editing && (
                        <button
                            onClick={() => setEditing(true)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                            Edit
                        </button>
                    )}
                </div>

                {editing ? (
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={concurrency}
                            onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
                            className="w-24 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                        <span className="text-sm text-gray-500">
                            lines = <span className="font-medium text-gray-900">${costEstimate}/mo</span>
                        </span>
                        <div className="flex-1" />
                        <button
                            onClick={() => { setEditing(false); setConcurrency(umbrella.concurrency_limit); }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading || concurrency === umbrella.concurrency_limit}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-gray-900">{umbrella.concurrency_limit}</span>
                        <span className="text-sm text-gray-500">
                            concurrent lines · <span className="font-medium">${umbrella.concurrency_limit * 10}/mo</span>
                        </span>
                    </div>
                )}
                <p className="text-xs text-gray-400">
                    Each line costs $10/mo from Vapi. The sequencer uses this limit to batch outbound calls.
                </p>
            </div>
        </div>
    );
}
