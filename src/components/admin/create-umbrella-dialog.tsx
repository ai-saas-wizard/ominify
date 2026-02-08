"use client";

import { useState } from "react";
import { Plus, Loader2, Umbrella } from "lucide-react";
import { createUmbrella } from "@/app/actions/umbrella-actions";

export function CreateUmbrellaDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);

        const res = await createUmbrella(formData);
        setLoading(false);

        if (res.success) {
            setIsOpen(false);
        } else {
            alert(res.error || "Failed to create umbrella");
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
                <Plus className="w-4 h-4" />
                Add Umbrella
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Umbrella className="w-5 h-5 text-indigo-600" />
                        Add New Umbrella
                    </h3>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Umbrella Name</label>
                        <input
                            name="name"
                            required
                            placeholder="Production Umbrella"
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">VAPI Private API Key</label>
                        <input
                            name="vapi_api_key"
                            required
                            placeholder="sk_..."
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500">
                            The shared VAPI API key for tenants under this umbrella.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Type</label>
                        <select
                            name="umbrella_type"
                            defaultValue="shared"
                            className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="shared">Shared</option>
                            <option value="dedicated">Dedicated</option>
                        </select>
                        <p className="text-xs text-gray-500">
                            Shared umbrellas serve multiple tenants. Dedicated umbrellas are reserved for a single tenant.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Concurrency Limit</label>
                            <input
                                name="concurrency_limit"
                                type="number"
                                min="1"
                                max="100"
                                defaultValue="10"
                                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Max Tenants
                                <span className="text-xs text-gray-400 ml-1">(optional)</span>
                            </label>
                            <input
                                name="max_tenants"
                                type="number"
                                min="1"
                                placeholder="Unlimited"
                                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Notes
                            <span className="text-xs text-gray-400 ml-1">(optional)</span>
                        </label>
                        <textarea
                            name="notes"
                            rows={2}
                            placeholder="Internal notes about this umbrella..."
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                            Create Umbrella
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
