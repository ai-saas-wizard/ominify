"use client";

import { useState } from "react";
import { Loader2, Save, Key } from "lucide-react";
import { updateUmbrella } from "@/app/actions/umbrella-actions";

// The raw VAPI key never reaches the browser.
// The server decrypts and derives `key_last_four` + `has_key`; we render only
// a masked preview and accept a new key via an empty password input on edit.
type UmbrellaData = {
    id: string;
    name: string;
    concurrency_limit: number;
    current_concurrency: number;
    tenant_count: number;
    key_last_four: string | null;
    has_key: boolean;
};

export function UmbrellaSettingsCard({ umbrella }: { umbrella: UmbrellaData }) {
    const [editing, setEditing] = useState(false);
    const [editingKey, setEditingKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [keyLoading, setKeyLoading] = useState(false);
    const [concurrency, setConcurrency] = useState(umbrella.concurrency_limit);
    // Empty by default — we never pre-populate with the current key because
    // we don't have it on the client and never want to.
    const [newVapiKey, setNewVapiKey] = useState("");

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

    const handleKeySave = async () => {
        if (!newVapiKey.trim()) return;
        setKeyLoading(true);
        const formData = new FormData();
        formData.set("vapi_api_key", newVapiKey.trim());

        const res = await updateUmbrella(umbrella.id, formData);
        setKeyLoading(false);

        if (res.success) {
            setEditingKey(false);
            setNewVapiKey("");
        } else {
            alert(res.error || "Failed to update VAPI key");
        }
    };

    const maskedKey = umbrella.has_key && umbrella.key_last_four
        ? `••••••••••••${umbrella.key_last_four}`
        : "Not set";

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

            {/* VAPI API Key */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">VAPI API Key</span>
                    </div>
                    {!editingKey && (
                        <button
                            onClick={() => setEditingKey(true)}
                            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        >
                            {umbrella.has_key ? "Replace" : "Set"}
                        </button>
                    )}
                </div>

                {editingKey ? (
                    <div className="space-y-2">
                        <input
                            type="password"
                            value={newVapiKey}
                            onChange={(e) => setNewVapiKey(e.target.value)}
                            placeholder="Paste new VAPI API key…"
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono"
                            autoComplete="off"
                            autoFocus
                        />
                        <p className="text-xs text-gray-500">
                            You can retrieve your key from the{" "}
                            <a
                                href="https://dashboard.vapi.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-600 hover:underline"
                            >
                                VAPI dashboard
                            </a>
                            . The existing key is not shown here — once saved, it's only visible as the last 4 characters.
                        </p>
                        <div className="flex items-center gap-2 justify-end">
                            <button
                                onClick={() => { setEditingKey(false); setNewVapiKey(""); }}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleKeySave}
                                disabled={keyLoading || !newVapiKey.trim()}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                            >
                                {keyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Save & Propagate
                            </button>
                        </div>
                        <p className="text-xs text-amber-600">
                            Saving will update the key for all {umbrella.tenant_count} active tenant{umbrella.tenant_count !== 1 ? "s" : ""}.
                        </p>
                    </div>
                ) : (
                    <p className="text-sm font-mono text-gray-500">{maskedKey}</p>
                )}
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
                                  : "bg-emerald-500"
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
                            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
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
                            className="w-24 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
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
                            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
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
