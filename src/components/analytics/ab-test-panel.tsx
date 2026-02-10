"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Trophy, BarChart3, Plus } from "lucide-react";
import { getStepVariants, createStepVariant } from "@/app/actions/sequence-actions";

interface Variant {
    id: string;
    variant_name: string;
    content: Record<string, any>;
    traffic_weight: number;
    total_sent: number;
    total_replies: number;
    total_conversions: number;
    reply_rate: number;
    conversion_rate: number;
    is_winner: boolean;
    p_value: number | null;
    is_active: boolean;
}

interface ABTestPanelProps {
    stepId: string;
    stepOrder: number;
    channel: string;
    sequenceId: string;
    clientId: string;
}

export function ABTestPanel({ stepId, stepOrder, channel, sequenceId, clientId }: ABTestPanelProps) {
    const [variants, setVariants] = useState<Variant[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [newContent, setNewContent] = useState("");

    useEffect(() => {
        loadVariants();
    }, [stepId]);

    async function loadVariants() {
        const result = await getStepVariants(stepId);
        if (result.success) {
            setVariants(result.data || []);
        }
        setLoading(false);
    }

    async function handleCreate() {
        if (!newName || !newContent) return;
        setCreating(true);
        try {
            const content = JSON.parse(newContent);
            const weight = 1 / (variants.length + 1);
            await createStepVariant(stepId, sequenceId, clientId, newName, content, weight);
            await loadVariants();
            setShowCreate(false);
            setNewName("");
            setNewContent("");
        } catch {
            alert("Invalid JSON content");
        }
        setCreating(false);
    }

    if (loading) {
        return (
            <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
                <div className="h-20 bg-gray-100 rounded" />
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-purple-500" />
                    <h4 className="text-xs font-semibold text-gray-900">
                        A/B Test &middot; Step {stepOrder} ({channel.toUpperCase()})
                    </h4>
                </div>
                {!showCreate && (
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-purple-600 hover:bg-purple-50 rounded transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        Add Variant
                    </button>
                )}
            </div>

            {variants.length === 0 && !showCreate ? (
                <p className="text-xs text-gray-500">
                    No A/B test variants configured. Create a variant to start testing alternative content.
                </p>
            ) : (
                <div className="space-y-2">
                    {variants.map((v) => {
                        const replyRate = parseFloat(String(v.reply_rate)) * 100;
                        const convRate = parseFloat(String(v.conversion_rate)) * 100;
                        const pVal = v.p_value ? parseFloat(String(v.p_value)) : null;

                        return (
                            <div
                                key={v.id}
                                className={`p-2.5 rounded-lg border text-xs ${
                                    v.is_winner ? "border-green-300 bg-green-50" :
                                    !v.is_active ? "border-gray-200 bg-gray-50 opacity-60" :
                                    "border-gray-200"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-gray-900">{v.variant_name}</span>
                                        {v.is_winner && (
                                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold">
                                                <Trophy className="w-2.5 h-2.5" />
                                                Winner
                                            </span>
                                        )}
                                        {!v.is_active && (
                                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px]">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-gray-400">
                                        {(parseFloat(String(v.traffic_weight)) * 100).toFixed(0)}% traffic
                                    </span>
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                    <div>
                                        <span className="text-gray-500">Sent</span>
                                        <div className="font-semibold text-gray-900">{v.total_sent}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Replies</span>
                                        <div className="font-semibold text-gray-900">{v.total_replies}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Reply Rate</span>
                                        <div className="font-semibold text-gray-900">{replyRate.toFixed(1)}%</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Conv Rate</span>
                                        <div className="font-semibold text-green-600">{convRate.toFixed(1)}%</div>
                                    </div>
                                </div>

                                {pVal !== null && (
                                    <div className="mt-1.5 flex items-center gap-1">
                                        <BarChart3 className="w-3 h-3 text-gray-400" />
                                        <span className={`text-[10px] ${pVal < 0.05 ? "text-green-600 font-medium" : "text-gray-400"}`}>
                                            p-value: {pVal.toFixed(4)}
                                            {pVal < 0.05 ? " (significant)" : " (not significant)"}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create variant form */}
            {showCreate && (
                <div className="mt-3 p-3 border border-dashed border-purple-200 rounded-lg bg-purple-50/30">
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Variant name (e.g., B - Shorter SMS)"
                            className="w-full px-2 py-1.5 text-xs border rounded focus:ring-1 focus:ring-purple-300 focus:border-purple-300"
                        />
                        <textarea
                            value={newContent}
                            onChange={(e) => setNewContent(e.target.value)}
                            placeholder={`Content JSON (e.g., ${channel === "sms" ? '{"body": "Hi {{first_name}}..."}' : '{"subject": "...", "body_html": "...", "body_text": "..."}'}`}
                            rows={3}
                            className="w-full px-2 py-1.5 text-xs border rounded font-mono focus:ring-1 focus:ring-purple-300 focus:border-purple-300"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCreate}
                                disabled={creating || !newName || !newContent}
                                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                            >
                                {creating ? "Creating..." : "Create Variant"}
                            </button>
                            <button
                                onClick={() => { setShowCreate(false); setNewName(""); setNewContent(""); }}
                                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
