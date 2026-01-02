"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Building2 } from "lucide-react";
import Link from "next/link";

interface WorkspaceDisplayProps {
    clientId: string;
}

interface ClientInfo {
    id: string;
    name: string;
}

export function WorkspaceDisplay({ clientId }: WorkspaceDisplayProps) {
    const [currentClient, setCurrentClient] = useState<ClientInfo | null>(null);
    const [allClients, setAllClients] = useState<ClientInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        async function fetchClientData() {
            try {
                // Fetch current client info
                const currentRes = await fetch(`/api/client/${clientId}/info`);
                if (currentRes.ok) {
                    const data = await currentRes.json();
                    setCurrentClient(data);
                }

                // Fetch all accessible clients for current user
                const allRes = await fetch('/api/user/clients');
                if (allRes.ok) {
                    const data = await allRes.json();
                    setAllClients(data.clients || []);
                }
            } catch (err) {
                console.error('Failed to fetch client info:', err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchClientData();
    }, [clientId]);

    if (isLoading) {
        return (
            <div className="p-4 border-b border-gray-100">
                <div className="animate-pulse flex items-center gap-3 px-2 py-1.5">
                    <div className="w-8 h-8 rounded bg-gray-200" />
                    <div className="space-y-1">
                        <div className="h-3 w-24 bg-gray-200 rounded" />
                        <div className="h-2 w-16 bg-gray-200 rounded" />
                    </div>
                </div>
            </div>
        );
    }

    const displayName = currentClient?.name || "Workspace";
    const initial = displayName.charAt(0).toUpperCase();
    const hasMultipleClients = allClients.length > 1;

    return (
        <div className="p-4 border-b border-gray-100">
            <div
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg transition-all ${hasMultipleClients
                        ? 'hover:bg-gray-50 cursor-pointer border border-transparent hover:border-gray-200'
                        : ''
                    }`}
                onClick={() => hasMultipleClients && setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-violet-100 flex items-center justify-center text-violet-600 font-semibold text-xs border border-violet-200">
                        {initial}
                    </div>
                    <div className="text-sm">
                        <div className="font-semibold text-gray-900 leading-none mb-0.5 truncate max-w-[140px]">
                            {displayName}
                        </div>
                        <div className="text-xs text-gray-500">Client Dashboard</div>
                    </div>
                </div>
                {hasMultipleClients && (
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </div>

            {/* Dropdown for multiple clients */}
            {isOpen && hasMultipleClients && (
                <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {allClients
                        .filter(c => c.id !== clientId)
                        .map(client => (
                            <Link
                                key={client.id}
                                href={`/client/${client.id}/agents`}
                                className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-600 font-semibold text-xs">
                                    {client.name?.charAt(0).toUpperCase() || 'C'}
                                </div>
                                <span className="text-sm text-gray-700 truncate">{client.name}</span>
                            </Link>
                        ))}
                </div>
            )}
        </div>
    );
}
