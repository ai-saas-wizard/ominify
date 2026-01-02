"use client";

import { VapiAgent } from "@/lib/vapi";
import { format } from "date-fns";
import { MoreVertical, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useParams } from "next/navigation";

interface AgentTableProps {
    agents: VapiAgent[];
}

export const AgentTable = ({ agents }: AgentTableProps) => {
    const params = useParams();
    const clientId = params.clientId as string;

    return (
        <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold border-b">
                    <tr>
                        <th className="px-6 py-3">Agent Name</th>
                        <th className="px-6 py-3">Phone Number</th>
                        <th className="px-6 py-3">Last Edited</th>
                        <th className="px-6 py-3">Type</th>
                        <th className="px-6 py-3 w-[50px]"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                    {agents.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                No agents found.
                            </td>
                        </tr>
                    ) : (
                        agents.map((agent) => (
                            <tr key={agent.id} className="hover:bg-gray-50 transition-colors group cursor-pointer border-b border-gray-50 last:border-0">
                                <td className="px-6 py-4">
                                    <Link href={`/client/${clientId}/agents/${agent.id}`} className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10 border border-gray-100 bg-violet-100 text-violet-600">
                                            <AvatarFallback className="font-medium">{agent.name?.[0]?.toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                        <div className="font-medium text-gray-900">{agent.name || "Untitled"}</div>
                                    </Link>
                                </td>
                                <td className="px-6 py-4 text-gray-400">
                                    —
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="text-gray-900 font-medium text-xs">{format(new Date(agent.createdAt), 'MMM d, yyyy')}</span>
                                        <span className="text-gray-400 text-[10px]">{format(new Date(agent.createdAt), 'HH:mm')}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                        <ExternalLink className="w-3 h-3" />
                                        Outbound
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <Link href={`/client/${clientId}/agents/${agent.id}`}>
                                        <button className="p-2 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition-colors">
                                            <MoreVertical className="w-4 h-4" />
                                        </button>
                                    </Link>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
