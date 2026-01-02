"use client";

import { useState } from "react";
import { Save, Loader2, Eye, EyeOff, AlertTriangle } from "lucide-react";

interface UpdateVapiKeyFormProps {
    currentKey: string;
    updateVapiKey: (formData: FormData) => Promise<void>;
}

export function UpdateVapiKeyForm({ currentKey, updateVapiKey }: UpdateVapiKeyFormProps) {
    const [vapiKey, setVapiKey] = useState(currentKey);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const hasChanges = vapiKey !== currentKey;
    const hasKey = vapiKey && vapiKey.length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("vapiKey", vapiKey);

        await updateVapiKey(formData);
        setIsSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    const maskedKey = vapiKey
        ? `${vapiKey.slice(0, 8)}${'•'.repeat(20)}${vapiKey.slice(-4)}`
        : '';

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    API Key
                </label>
                <div className="relative">
                    <input
                        type={showKey ? "text" : "password"}
                        value={vapiKey}
                        onChange={(e) => setVapiKey(e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 font-mono text-sm"
                        placeholder="Enter your Vapi API key"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Get your API key from the <a href="https://dashboard.vapi.ai" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">Vapi Dashboard</a>
                </p>
            </div>

            {!hasKey && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-800">
                        No API key configured. Your agents will use the platform's default key.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={!hasChanges || isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save API Key
                        </>
                    )}
                </button>
                {saved && (
                    <span className="text-sm text-green-600">✓ Saved successfully</span>
                )}
            </div>
        </form>
    );
}
