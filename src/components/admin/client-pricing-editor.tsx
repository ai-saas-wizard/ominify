"use client";

import { useState, useEffect } from "react";
import { Edit2, Check, X, ChevronDown, Loader2 } from "lucide-react";
import { getAgentsForClient, updateAgentPricing, type AgentPricing } from "@/app/actions/admin-actions";

interface ClientPricingEditorProps {
    clientId: string;
    currentPrice: number;
    currentCost: number;
    updatePricing: (formData: FormData) => Promise<void>;
}

export function ClientPricingEditor({
    clientId,
    currentPrice,
    currentCost,
    updatePricing
}: ClientPricingEditorProps) {
    const [isEditing, setIsEditing] = useState(false);

    // Global client pricing state
    const [price, setPrice] = useState(currentPrice.toString());
    const [cost, setCost] = useState(currentCost.toString());
    const [isSavingGlobal, setIsSavingGlobal] = useState(false);

    // Agent pricing state
    const [agents, setAgents] = useState<AgentPricing[]>([]);
    const [isLoadingAgents, setIsLoadingAgents] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string>("");

    // Selected agent rate state
    const [agentPrice, setAgentPrice] = useState("");
    const [agentCost, setAgentCost] = useState("");
    const [isSavingAgent, setIsSavingAgent] = useState(false);

    // Load agents when editing starts
    useEffect(() => {
        if (isEditing) {
            loadAgents();
        }
    }, [isEditing]);

    // Update local agent input state when agent selection changes
    useEffect(() => {
        if (selectedAgentId) {
            const agent = agents.find(a => a.id === selectedAgentId);
            if (agent) {
                setAgentPrice(agent.price_per_minute?.toString() || "");
                setAgentCost(agent.cost_per_minute?.toString() || "");
            }
        } else {
            setAgentPrice("");
            setAgentCost("");
        }
    }, [selectedAgentId, agents]);

    const loadAgents = async () => {
        setIsLoadingAgents(true);
        try {
            const data = await getAgentsForClient(clientId);
            setAgents(data);
        } catch (error) {
            console.error("Failed to load agents", error);
        } finally {
            setIsLoadingAgents(false);
        }
    };

    const handleSaveGlobal = async () => {
        setIsSavingGlobal(true);
        try {
            const formData = new FormData();
            formData.set("clientId", clientId);
            formData.set("pricePerMinute", price);
            formData.set("costPerMinute", cost);
            await updatePricing(formData);
            // Don't close editing, allows continued editing of agents
        } catch (error) {
            console.error("Failed to save global pricing", error);
        } finally {
            setIsSavingGlobal(false);
        }
    };

    const handleSaveAgent = async () => {
        if (!selectedAgentId) return;
        setIsSavingAgent(true);
        try {
            const p = agentPrice ? parseFloat(agentPrice) : null;
            const c = agentCost ? parseFloat(agentCost) : null;
            await updateAgentPricing(selectedAgentId, p, c);

            // Refund/Update local state
            setAgents(prev => prev.map(a =>
                a.id === selectedAgentId
                    ? { ...a, price_per_minute: p, cost_per_minute: c }
                    : a
            ));

            alert("Agent pricing updated!");
        } catch (error) {
            console.error("Failed to save agent pricing", error);
            alert("Failed to save agent pricing");
        } finally {
            setIsSavingAgent(false);
        }
    };

    const handleClose = () => {
        setPrice(currentPrice.toString());
        setCost(currentCost.toString());
        setIsEditing(false);
        setSelectedAgentId("");
    };

    if (!isEditing) {
        return (
            <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 font-medium"
            >
                <Edit2 className="w-4 h-4" />
                Edit
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h3 className="font-semibold text-gray-900">Manage Pricing</h3>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Global Pricing Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-violet-600"></span>
                            Default Client Rate
                        </h4>
                        <div className="flex items-end gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <div className="flex-1 space-y-1">
                                <label className="text-xs text-gray-500 font-medium">Price / min</label>
                                <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-violet-500 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div className="flex-1 space-y-1">
                                <label className="text-xs text-gray-500 font-medium">Cost / min</label>
                                <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={cost}
                                        onChange={(e) => setCost(e.target.value)}
                                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-violet-500 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <button
                                onClick={handleSaveGlobal}
                                disabled={isSavingGlobal}
                                className="h-[34px] px-3 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 text-sm font-medium"
                            >
                                {isSavingGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                            </button>
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-gray-500">Or Override per Agent</span>
                        </div>
                    </div>

                    {/* Per Agent Pricing Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            Agent Specific Rates
                        </h4>

                        {isLoadingAgents ? (
                            <div className="flex justify-center py-4 text-gray-500">
                                <Loader2 className="w-5 h-5 animate-spin" />
                            </div>
                        ) : (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-3">
                                <select
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded bg-white focus:ring-2 focus:ring-violet-500 focus:outline-none"
                                    value={selectedAgentId}
                                    onChange={(e) => setSelectedAgentId(e.target.value)}
                                >
                                    <option value="">Select an agent...</option>
                                    {agents.map(agent => (
                                        <option key={agent.id} value={agent.id}>
                                            {agent.name} {agent.price_per_minute ? `(Current: $${agent.price_per_minute}/m)` : '(Default)'}
                                        </option>
                                    ))}
                                </select>

                                {selectedAgentId && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                                        <div className="flex gap-3">
                                            <div className="flex-1 space-y-1">
                                                <label className="text-xs text-gray-500 font-medium">Price / min</label>
                                                <div className="relative">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="Default"
                                                        value={agentPrice}
                                                        onChange={(e) => setAgentPrice(e.target.value)}
                                                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-violet-500 focus:outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <label className="text-xs text-gray-500 font-medium">Cost / min</label>
                                                <div className="relative">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="Default"
                                                        value={agentCost}
                                                        onChange={(e) => setAgentCost(e.target.value)}
                                                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-violet-500 focus:outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={handleSaveAgent}
                                            disabled={isSavingAgent}
                                            className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex justify-center items-center gap-2"
                                        >
                                            {isSavingAgent ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Agent Rate"}
                                        </button>
                                        <p className="text-xs text-gray-500 text-center">
                                            Leave empty to use default client rate.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
