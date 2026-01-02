"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

interface Agent {
    id: string;
    name: string;
    vapi_id: string;
}

const EVENT_TYPES = [
    { id: 'call.started', label: 'Call started' },
    { id: 'call.ended', label: 'Call completed' },
];

export function AddWebhookModal({
    clientId,
    agents,
    onClose,
    onSuccess
}: {
    clientId: string;
    agents: Agent[];
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
    const [selectedEvents, setSelectedEvents] = useState<string[]>(['call.ended']);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAgentToggle = (agentId: string) => {
        setSelectedAgents(prev =>
            prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [...prev, agentId]
        );
    };

    const handleAllAgentsToggle = () => {
        if (selectedAgents.length === agents.length) {
            setSelectedAgents([]);
        } else {
            setSelectedAgents(agents.map(a => a.id));
        }
    };

    const handleEventToggle = (eventId: string) => {
        setSelectedEvents(prev =>
            prev.includes(eventId)
                ? prev.filter(id => id !== eventId)
                : [...prev, eventId]
        );
    };

    const handleAllEventsToggle = () => {
        if (selectedEvents.length === EVENT_TYPES.length) {
            setSelectedEvents([]);
        } else {
            setSelectedEvents(EVENT_TYPES.map(e => e.id));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim() || !url.trim()) {
            setError('Name and URL are required');
            return;
        }

        if (!url.startsWith('https://') && !url.startsWith('http://')) {
            setError('URL must start with http:// or https://');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/client/${clientId}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    url,
                    events: selectedEvents,
                    agentIds: selectedAgents
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create webhook');
            }

            onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Add Webhook</h3>
                        <p className="text-sm text-gray-500">
                            Setup your webhook endpoint to receive live events
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {/* Webhook Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Webhook name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Status webhook"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {/* Endpoint URL */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Endpoint URL
                        </label>
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="e.g. https://example.com/webhook"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {/* AI Agents */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            AI Agents
                        </label>
                        <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                            {/* All toggle */}
                            <div className="flex items-center justify-between py-1">
                                <span className="text-sm text-gray-600">
                                    All <span className="text-gray-400">{selectedAgents.length}/{agents.length}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={handleAllAgentsToggle}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${selectedAgents.length === agents.length ? 'bg-indigo-600' : 'bg-gray-200'
                                        }`}
                                >
                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${selectedAgents.length === agents.length ? 'translate-x-4' : 'translate-x-1'
                                        }`} />
                                </button>
                            </div>

                            {agents.map((agent) => (
                                <div key={agent.id} className="flex items-center justify-between py-1 pl-4">
                                    <span className="text-sm text-gray-700">{agent.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleAgentToggle(agent.id)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${selectedAgents.includes(agent.id) ? 'bg-indigo-600' : 'bg-gray-200'
                                            }`}
                                    >
                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${selectedAgents.includes(agent.id) ? 'translate-x-4' : 'translate-x-1'
                                            }`} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Events */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Events
                        </label>
                        <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                            {/* All toggle */}
                            <div className="flex items-center justify-between py-1">
                                <span className="text-sm text-gray-600">
                                    All <span className="text-gray-400">{selectedEvents.length}/{EVENT_TYPES.length}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={handleAllEventsToggle}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${selectedEvents.length === EVENT_TYPES.length ? 'bg-indigo-600' : 'bg-gray-200'
                                        }`}
                                >
                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${selectedEvents.length === EVENT_TYPES.length ? 'translate-x-4' : 'translate-x-1'
                                        }`} />
                                </button>
                            </div>

                            {EVENT_TYPES.map((event) => (
                                <div key={event.id} className="flex items-center justify-between py-1 pl-4">
                                    <span className="text-sm text-gray-700">{event.label}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleEventToggle(event.id)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${selectedEvents.includes(event.id) ? 'bg-indigo-600' : 'bg-gray-200'
                                            }`}
                                    >
                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${selectedEvents.includes(event.id) ? 'translate-x-4' : 'translate-x-1'
                                            }`} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            Test webhook
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Create webhook
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
