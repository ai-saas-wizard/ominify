"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface WorkspaceDisplayProps {
    clientId: string;
    initialCurrentClient?: ClientInfo;
    initialAllClients?: ClientInfo[];
}

interface ClientInfo {
    id: string;
    name: string;
    business_name?: string | null;
}

export function WorkspaceDisplay({
    clientId,
    initialCurrentClient,
    initialAllClients,
}: WorkspaceDisplayProps) {
    const [currentClient, setCurrentClient] = useState<ClientInfo | null>(
        initialCurrentClient ?? null
    );
    const [allClients, setAllClients] = useState<ClientInfo[]>(initialAllClients ?? []);
    const [isLoading, setIsLoading] = useState(!initialCurrentClient);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (initialCurrentClient && initialAllClients) return;

        async function fetchClientData() {
            try {
                const currentRes = await fetch(`/api/client/${clientId}/info`);
                if (currentRes.ok) {
                    const data = await currentRes.json();
                    setCurrentClient(data);
                }

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
    }, [clientId, initialCurrentClient, initialAllClients]);

    if (isLoading) {
        return (
            <div className="p-4 border-b border-gray-100">
                <div className="animate-pulse flex items-center gap-2.5 px-2 py-1.5">
                    <div className="w-8 h-8 rounded bg-gray-200" />
                    <div className="h-3 w-28 bg-gray-200 rounded" />
                </div>
            </div>
        );
    }

    // Shown as the business writes it. The old toUpperCase() shouted every
    // workspace name and made mixed case brands unreadable.
    const displayName = currentClient?.business_name || currentClient?.name || "Workspace";
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
                <div className="flex min-w-0 items-center gap-2.5">
                    <Image
                        src="/omnify-mark.png"
                        alt="Omnify"
                        width={32}
                        height={32}
                        className="h-8 w-8 flex-none object-contain"
                        priority
                    />
                    {/* One line now that the bell has moved out of this row, so a
                        real business name no longer wraps. */}
                    <div className="min-w-0 truncate text-sm font-semibold text-gray-900">
                        {displayName}
                    </div>
                </div>
                {hasMultipleClients && (
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </div>

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
                                    {(client.business_name || client.name)?.charAt(0).toUpperCase() || 'C'}
                                </div>
                                <span className="text-sm text-gray-700 truncate">{client.business_name || client.name || ""}</span>
                            </Link>
                        ))}
                </div>
            )}
        </div>
    );
}
