"use client";

import { useState, useEffect } from "react";
import { Plus, Webhook, MoreVertical, Trash2, Power, ExternalLink } from "lucide-react";
import { AddWebhookModal } from "./add-webhook-modal";

interface Agent {
    id: string;
    name: string;
    vapi_id: string;
}

interface WebhookData {
    id: string;
    name: string;
    url: string;
    events: string[];
    is_active: boolean;
    created_at: string;
    agents: Agent[];
}

export function WebhookManager({ clientId, agents }: { clientId: string; agents: Agent[] }) {
    const [webhooks, setWebhooks] = useState<WebhookData[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);

    const fetchWebhooks = async () => {
        try {
            const res = await fetch(`/api/client/${clientId}/webhooks`);
            if (res.ok) {
                const data = await res.json();
                setWebhooks(data);
            }
        } catch (error) {
            console.error('Error fetching webhooks:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWebhooks();
    }, [clientId]);

    const handleToggleActive = async (webhookId: string, currentStatus: boolean) => {
        try {
            await fetch(`/api/client/${clientId}/webhooks/${webhookId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !currentStatus })
            });
            fetchWebhooks();
        } catch (error) {
            console.error('Error toggling webhook:', error);
        }
        setActionMenuId(null);
    };

    const handleDelete = async (webhookId: string) => {
        if (!confirm('Are you sure you want to delete this webhook?')) return;

        try {
            await fetch(`/api/client/${clientId}/webhooks/${webhookId}`, {
                method: 'DELETE'
            });
            fetchWebhooks();
        } catch (error) {
            console.error('Error deleting webhook:', error);
        }
        setActionMenuId(null);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 bg-gray-200 rounded w-1/4"></div>
                    <div className="h-20 bg-gray-100 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Webhook className="w-5 h-5 text-indigo-600" />
                        Webhooks
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Set up and manage webhook endpoints to receive real-time event notifications
                    </p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add Webhook
                </button>
            </div>

            {webhooks.length === 0 ? (
                <div className="p-12 text-center">
                    <Webhook className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-1">No webhooks yet</h4>
                    <p className="text-gray-500 text-sm mb-4">
                        Create a webhook to receive real-time call notifications
                    </p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Create your first webhook
                    </button>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                <th className="px-6 py-3 text-left font-medium">Name</th>
                                <th className="px-6 py-3 text-left font-medium">URL</th>
                                <th className="px-6 py-3 text-left font-medium">Agents</th>
                                <th className="px-6 py-3 text-left font-medium">Created At</th>
                                <th className="px-6 py-3 text-center font-medium">Status</th>
                                <th className="px-6 py-3 text-right font-medium"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {webhooks.map((webhook) => (
                                <tr key={webhook.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <span className="font-medium text-gray-900">{webhook.name}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1.5 text-sm text-gray-600 max-w-[200px] truncate">
                                            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span className="truncate">{webhook.url}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1">
                                            {webhook.agents.length === 0 ? (
                                                <span className="text-xs text-gray-400">All agents</span>
                                            ) : webhook.agents.length <= 2 ? (
                                                webhook.agents.map(agent => (
                                                    <span key={agent.id} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                                                        {agent.name}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                    {webhook.agents.length} agents
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {formatDate(webhook.created_at)}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={() => handleToggleActive(webhook.id, webhook.is_active)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${webhook.is_active ? 'bg-indigo-600' : 'bg-gray-200'
                                                }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${webhook.is_active ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                            />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right relative">
                                        <button
                                            onClick={() => setActionMenuId(actionMenuId === webhook.id ? null : webhook.id)}
                                            className="p-1 hover:bg-gray-100 rounded"
                                        >
                                            <MoreVertical className="w-4 h-4 text-gray-400" />
                                        </button>
                                        {actionMenuId === webhook.id && (
                                            <div className="absolute right-6 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                                                <button
                                                    onClick={() => handleDelete(webhook.id)}
                                                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showAddModal && (
                <AddWebhookModal
                    clientId={clientId}
                    agents={agents}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={() => {
                        setShowAddModal(false);
                        fetchWebhooks();
                    }}
                />
            )}
        </div>
    );
}
