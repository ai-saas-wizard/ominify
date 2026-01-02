"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { createClientAction } from "@/app/actions/client-actions";

export function CreateClientDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);

        const res = await createClientAction(formData);
        setLoading(false);

        if (res.success) {
            setIsOpen(false);
            // Ideally toast
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
                        <select name="type" className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500">
                            <option value="CUSTOM">Type A (Custom Key)</option>
                            {/* <option value="UMBRELLA">Type B (Umbrella)</option> */}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Vapi Private API Key</label>
                        <input name="vapi_key" required placeholder="sk_..." className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 font-mono text-sm" />
                        <p className="text-xs text-gray-500">Use the API key provided by the client (Type A).</p>
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
                            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg flex items-center"
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
