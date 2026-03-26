"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fadeIn } from "@/lib/settings-animations";

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
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
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
                    <AnimatePresence>
                        {error && (
                            <motion.div
                                variants={fadeIn}
                                initial="hidden"
                                animate="show"
                                exit="exit"
                                className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600"
                            >
                                {error}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Webhook Name */}
                    <div>
                        <Label htmlFor="webhook-name" className="mb-1.5 block">
                            Webhook name
                        </Label>
                        <Input
                            id="webhook-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Status webhook"
                        />
                    </div>

                    {/* Endpoint URL */}
                    <div>
                        <Label htmlFor="webhook-url" className="mb-1.5 block">
                            Endpoint URL
                        </Label>
                        <Input
                            id="webhook-url"
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="e.g. https://example.com/webhook"
                        />
                    </div>

                    {/* AI Agents */}
                    <div>
                        <Label className="mb-2 block">AI Agents</Label>
                        <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center justify-between py-1">
                                <span className="text-sm text-gray-600">
                                    All <span className="text-gray-400">{selectedAgents.length}/{agents.length}</span>
                                </span>
                                <Switch
                                    checked={selectedAgents.length === agents.length}
                                    onCheckedChange={handleAllAgentsToggle}
                                    className="data-[state=checked]:bg-emerald-600 h-5 w-9"
                                />
                            </div>

                            {agents.map((agent) => (
                                <div key={agent.id} className="flex items-center justify-between py-1 pl-4">
                                    <span className="text-sm text-gray-700">{agent.name}</span>
                                    <Switch
                                        checked={selectedAgents.includes(agent.id)}
                                        onCheckedChange={() => handleAgentToggle(agent.id)}
                                        className="data-[state=checked]:bg-emerald-600 h-5 w-9"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Events */}
                    <div>
                        <Label className="mb-2 block">Events</Label>
                        <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center justify-between py-1">
                                <span className="text-sm text-gray-600">
                                    All <span className="text-gray-400">{selectedEvents.length}/{EVENT_TYPES.length}</span>
                                </span>
                                <Switch
                                    checked={selectedEvents.length === EVENT_TYPES.length}
                                    onCheckedChange={handleAllEventsToggle}
                                    className="data-[state=checked]:bg-emerald-600 h-5 w-9"
                                />
                            </div>

                            {EVENT_TYPES.map((event) => (
                                <div key={event.id} className="flex items-center justify-between py-1 pl-4">
                                    <span className="text-sm text-gray-700">{event.label}</span>
                                    <Switch
                                        checked={selectedEvents.includes(event.id)}
                                        onCheckedChange={() => handleEventToggle(event.id)}
                                        className="data-[state=checked]:bg-emerald-600 h-5 w-9"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={loading}
                            className="flex-1"
                        >
                            Test webhook
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Create webhook
                        </Button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}
