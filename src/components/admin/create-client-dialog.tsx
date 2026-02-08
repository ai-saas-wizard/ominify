"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, Umbrella, Key } from "lucide-react";
import { createClientAction } from "@/app/actions/client-actions";
import { getUmbrellas } from "@/app/actions/umbrella-actions";

type UmbrellaOption = {
    id: string;
    name: string;
    concurrency_limit: number;
    current_concurrency: number;
};

export function CreateClientDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [accountType, setAccountType] = useState<"CUSTOM" | "UMBRELLA">("CUSTOM");
    const [umbrellas, setUmbrellas] = useState<UmbrellaOption[]>([]);
    const [loadingUmbrellas, setLoadingUmbrellas] = useState(false);

    // Fetch umbrellas when UMBRELLA type is selected
    useEffect(() => {
        if (accountType === "UMBRELLA" && umbrellas.length === 0) {
            setLoadingUmbrellas(true);
            getUmbrellas().then((data) => {
                setUmbrellas(data as UmbrellaOption[]);
                setLoadingUmbrellas(false);
            });
        }
    }, [accountType, umbrellas.length]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);

        const res = await createClientAction(formData);
        setLoading(false);

        if (res.success) {
            setIsOpen(false);
            setAccountType("CUSTOM");
        } else {
            alert(res.error || "Failed");
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
                <Plus className="w-4 h-4" />
                Add Client
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-lg">Add New Client</h3>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Client Name</label>
                        <input name="name" required placeholder="Acme Corp" className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Email (Optional)</label>
                        <input name="email" type="email" placeholder="client@example.com" className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Account Type</label>
                        <select
                            name="type"
                            value={accountType}
                            onChange={(e) => setAccountType(e.target.value as "CUSTOM" | "UMBRELLA")}
                            className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500"
                        >
                            <option value="CUSTOM">Type A (Custom Key)</option>
                            <option value="UMBRELLA">Type B (Umbrella)</option>
                        </select>
                    </div>

                    {/* ── TYPE A: Client provides their own Vapi key ── */}
                    {accountType === "CUSTOM" && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Key className="w-3.5 h-3.5" />
                                Vapi Private API Key
                            </label>
                            <input name="vapi_key" required placeholder="sk_..." className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 font-mono text-sm" />
                            <p className="text-xs text-gray-500">Use the API key provided by the client.</p>
                        </div>
                    )}

                    {/* ── TYPE B: Agency umbrella assignment ── */}
                    {accountType === "UMBRELLA" && (
                        <div className="space-y-4">
                            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                                <div className="flex items-center gap-2 text-indigo-700 text-sm font-medium mb-1">
                                    <Umbrella className="w-4 h-4" />
                                    Umbrella Mode
                                </div>
                                <p className="text-xs text-indigo-600/80">
                                    This client will use agency-managed VAPI credentials and get a Twilio subaccount provisioned automatically.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Assign to Umbrella</label>
                                {loadingUmbrellas ? (
                                    <div className="flex items-center gap-2 text-sm text-gray-500 p-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading umbrellas...
                                    </div>
                                ) : umbrellas.length === 0 ? (
                                    <div className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3">
                                        No umbrellas configured. Create one in Admin → Umbrellas first.
                                    </div>
                                ) : (
                                    <select name="umbrella_id" required className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-500">
                                        <option value="">Select an umbrella...</option>
                                        {umbrellas.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.name} ({u.current_concurrency}/{u.concurrency_limit} slots used)
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Reserved Concurrency</label>
                                <input
                                    name="tenant_concurrency_cap"
                                    type="number"
                                    min="1"
                                    max="20"
                                    defaultValue="2"
                                    className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <p className="text-xs text-gray-500">Max concurrent calls this tenant can make within the umbrella.</p>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={() => { setIsOpen(false); setAccountType("CUSTOM"); }}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || (accountType === "UMBRELLA" && umbrellas.length === 0)}
                            className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center ${
                                accountType === "UMBRELLA"
                                    ? "bg-indigo-600 hover:bg-indigo-700"
                                    : "bg-violet-600 hover:bg-violet-700"
                            } disabled:opacity-50`}
                        >
                            {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                            Create Client
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
