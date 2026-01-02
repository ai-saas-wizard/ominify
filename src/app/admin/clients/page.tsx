import { supabase } from "@/lib/supabase";
import { Plus, Users, Key, CreditCard } from "lucide-react";
import Link from "next/link";
import { CreateClientDialog } from "@/components/admin/create-client-dialog";

// Fetch clients server-side
async function getClients() {
    const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error("Supabase Error:", error);
        return [];
    }
    return data || [];
}

export default async function AdminClientsPage() {
    const clients = await getClients();

    return (
        <div className="p-4 lg:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Clients</h2>
                    <p className="text-muted-foreground">Manage your agency clients.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/admin/billing"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                    >
                        <CreditCard className="w-4 h-4" />
                        Billing
                    </Link>
                    <CreateClientDialog />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients.length === 0 ? (
                    <div className="col-span-full h-[300px] flex flex-col items-center justify-center border border-dashed rounded-xl bg-gray-50/50">
                        <Users className="w-12 h-12 text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">No clients yet</h3>
                        <p className="text-gray-500 mb-6">Add your first Type A client to get started.</p>
                    </div>
                ) : (
                    clients.map((client) => (
                        <div key={client.id} className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                        {client.name?.[0]?.toUpperCase() || 'C'}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{client.name}</h3>
                                        <div className="flex items-center gap-1 text-xs text-gray-500">
                                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{client.account_type}</span>
                                            <span>•</span>
                                            <span>{client.email || 'No email'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3 pt-2 border-t mt-4">
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center text-gray-500 gap-2">
                                        <Key className="w-4 h-4" />
                                        <span className="text-xs font-mono bg-gray-50 px-2 py-1 rounded">
                                            {client.vapi_key ? '••••' + client.vapi_key.slice(-4) : 'Not Configured'}
                                        </span>
                                    </div>
                                    <Link href={`/client/${client.id}/agents`} className="text-xs font-medium text-violet-600 hover:text-violet-700">
                                        Manage Agents →
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
