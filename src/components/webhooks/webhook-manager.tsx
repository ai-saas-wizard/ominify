"use client";

import { useState, useEffect } from "react";
import { Plus, Webhook, MoreVertical, Trash2, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AddWebhookModal } from "./add-webhook-modal";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from "@/components/ui/table";
import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { staggerContainer, staggerItem } from "@/lib/settings-animations";

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
    };

    const handleDelete = async (webhookId: string) => {
        try {
            await fetch(`/api/client/${clientId}/webhooks/${webhookId}`, {
                method: 'DELETE'
            });
            fetchWebhooks();
        } catch (error) {
            console.error('Error deleting webhook:', error);
        }
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
            <Card className="p-8">
                <div className="space-y-4">
                    <Skeleton className="h-6 w-1/4" />
                    <Skeleton className="h-20 w-full" />
                </div>
            </Card>
        );
    }

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-100 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Webhook className="w-5 h-5 text-indigo-600" />
                        Webhooks
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Set up and manage webhook endpoints to receive real-time event notifications
                    </p>
                </div>
                <Button
                    onClick={() => setShowAddModal(true)}
                    variant="secondary"
                    className="bg-gray-900 text-white hover:bg-gray-800"
                >
                    <Plus className="w-4 h-4" />
                    Add Webhook
                </Button>
            </CardHeader>

            {webhooks.length === 0 ? (
                <div className="p-12 text-center">
                    <Webhook className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-1">No webhooks yet</h4>
                    <p className="text-gray-500 text-sm mb-4">
                        Create a webhook to receive real-time call notifications
                    </p>
                    <Button
                        onClick={() => setShowAddModal(true)}
                        className="bg-indigo-600 hover:bg-indigo-700"
                    >
                        <Plus className="w-4 h-4" />
                        Create your first webhook
                    </Button>
                </div>
            ) : (
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                <TableHead className="px-6 py-3 font-medium">Name</TableHead>
                                <TableHead className="px-6 py-3 font-medium">URL</TableHead>
                                <TableHead className="px-6 py-3 font-medium">Agents</TableHead>
                                <TableHead className="px-6 py-3 font-medium">Created At</TableHead>
                                <TableHead className="px-6 py-3 font-medium text-center">Status</TableHead>
                                <TableHead className="px-6 py-3 font-medium text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <AnimatePresence>
                                {webhooks.map((webhook, index) => (
                                    <motion.tr
                                        key={webhook.id}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            delay: index * 0.05,
                                            type: "spring",
                                            stiffness: 280,
                                            damping: 22,
                                        }}
                                        className="border-b transition-colors hover:bg-gray-50/50"
                                    >
                                        <TableCell className="px-6 py-4">
                                            <span className="font-medium text-gray-900">{webhook.name}</span>
                                        </TableCell>
                                        <TableCell className="px-6 py-4">
                                            <div className="flex items-center gap-1.5 text-sm text-gray-600 max-w-[200px] truncate">
                                                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                                                <span className="truncate">{webhook.url}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="px-6 py-4">
                                            <div className="flex items-center gap-1">
                                                {webhook.agents.length === 0 ? (
                                                    <span className="text-xs text-gray-400">All agents</span>
                                                ) : webhook.agents.length <= 2 ? (
                                                    webhook.agents.map(agent => (
                                                        <Badge key={agent.id} className="bg-indigo-50 text-indigo-700 border-indigo-200">
                                                            {agent.name}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <Badge variant="secondary">
                                                        {webhook.agents.length} agents
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="px-6 py-4 text-sm text-gray-500">
                                            {formatDate(webhook.created_at)}
                                        </TableCell>
                                        <TableCell className="px-6 py-4 text-center">
                                            <Switch
                                                checked={webhook.is_active}
                                                onCheckedChange={() => handleToggleActive(webhook.id, webhook.is_active)}
                                                className="data-[state=checked]:bg-indigo-600"
                                            />
                                        </TableCell>
                                        <TableCell className="px-6 py-4 text-right">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete webhook</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Are you sure you want to delete &quot;{webhook.name}&quot;? This action cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDelete(webhook.id)}
                                                            className="bg-red-600 hover:bg-red-700"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </motion.tr>
                                ))}
                            </AnimatePresence>
                        </TableBody>
                    </Table>
                </CardContent>
            )}

            <AnimatePresence>
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
            </AnimatePresence>
        </Card>
    );
}
