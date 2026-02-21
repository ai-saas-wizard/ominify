"use client";

import { useState } from "react";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { updateAgentDefaultSettings } from "@/app/actions/agent-default-settings-actions";

interface AgentDefaultSettingsEditorProps {
    inboundSettings: Record<string, any> | null;
    outboundSettings: Record<string, any> | null;
}

export function AgentDefaultSettingsEditor({
    inboundSettings,
    outboundSettings,
}: AgentDefaultSettingsEditorProps) {
    const [activeTab, setActiveTab] = useState<"inbound" | "outbound">("inbound");
    const [inboundJson, setInboundJson] = useState(
        inboundSettings ? JSON.stringify(inboundSettings, null, 2) : "{}"
    );
    const [outboundJson, setOutboundJson] = useState(
        outboundSettings ? JSON.stringify(outboundSettings, null, 2) : "{}"
    );
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currentJson = activeTab === "inbound" ? inboundJson : outboundJson;
    const setCurrentJson = activeTab === "inbound" ? setInboundJson : setOutboundJson;

    const validateJson = (json: string): Record<string, any> | null => {
        try {
            const parsed = JSON.parse(json);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    };

    const handleSave = async () => {
        setError(null);
        const parsed = validateJson(currentJson);
        if (!parsed) {
            setError("Invalid JSON. Please check your syntax.");
            return;
        }

        setIsSaving(true);
        setSaved(false);

        const result = await updateAgentDefaultSettings(activeTab, parsed);

        setIsSaving(false);
        if (result.success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } else {
            setError(result.error || "Failed to save");
        }
    };

    const isValidJson = validateJson(currentJson) !== null;

    return (
        <div className="space-y-4">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
                <button
                    onClick={() => { setActiveTab("inbound"); setError(null); setSaved(false); }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "inbound"
                            ? "border-violet-600 text-violet-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                >
                    Inbound Defaults
                </button>
                <button
                    onClick={() => { setActiveTab("outbound"); setError(null); setSaved(false); }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "outbound"
                            ? "border-violet-600 text-violet-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                >
                    Outbound Defaults
                </button>
            </div>

            {/* JSON Editor */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    VAPI Configuration Template ({activeTab})
                </label>
                <textarea
                    value={currentJson}
                    onChange={(e) => { setCurrentJson(e.target.value); setError(null); }}
                    rows={20}
                    spellCheck={false}
                    className={`w-full font-mono text-sm p-4 border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 bg-gray-50 ${
                        !isValidJson && currentJson.length > 0
                            ? "border-red-300"
                            : "border-gray-300"
                    }`}
                />
                <p className="text-xs text-gray-500 mt-1">
                    This template is merged with dynamic values (name, system prompt, tools, metadata) during agent deployment.
                </p>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* Save Button */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={!isValidJson || isSaving}
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
                            Save {activeTab === "inbound" ? "Inbound" : "Outbound"} Defaults
                        </>
                    )}
                </button>
                {saved && (
                    <span className="text-sm text-green-600">Saved successfully</span>
                )}
            </div>
        </div>
    );
}
