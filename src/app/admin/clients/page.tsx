import { supabase } from "@/lib/supabase";
import { Users, Key, CreditCard, Umbrella, CheckCircle, Clock } from "lucide-react";
import Link from "next/link";
import { CreateClientDialog } from "@/components/admin/create-client-dialog";

// Fetch clients with umbrella + profile data
async function getClients() {
    const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Supabase Error:", error);
        return [];
    }

    if (!data) return [];

    // Enrich UMBRELLA clients with umbrella name + onboarding status
    const enriched = await Promise.all(
        data.map(async (client) => {
            if (client.account_type === "UMBRELLA") {
                // Get umbrella assignment
                const { data: assignment } = await supabase
                    .from("tenant_vapi_assignments")
                    .select("umbrella_id, tenant_concurrency_cap, vapi_umbrellas(name)")
                    .eq("client_id", client.id)
                    .eq("is_active", true)
                    .single();

                // Get onboarding status
                const { data: profile } = await supabase
                    .from("tenant_profiles")
                    .select("onboarding_completed, industry")
                    .eq("client_id", client.id)
                    .single();

                return {
                    ...client,
                    umbrella_name: (assignment?.vapi_umbrellas as unknown as { name: string } | null)?.name || "Unassigned",
                    concurrency_cap: assignment?.tenant_concurrency_cap,
                    onboarding_completed: profile?.onboarding_completed || false,
                    industry: profile?.industry,
                };
            }
            return client;
        })
    );

    return enriched;
}

export default async function AdminClientsPage() {
    const clients = await getClients();

    const customClients = clients.filter((c) => c.account_type === "CUSTOM");
    const umbrellaClients = clients.filter((c) => c.account_type === "UMBRELLA");

    return (
        <div className="p-4 lg:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Clients</h2>
                    <p className="text-muted-foreground">
                        Manage your agency clients.
                        {umbrellaClients.length > 0 && (
                            <span className="ml-2 text-indigo-600">
                                {umbrellaClients.length} Umbrella · {customClients.length} Custom
                            </span>
                        )}
                    </p>
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

            {/* ── UMBRELLA CLIENTS ── */}
            {umbrellaClients.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-2">
                        <Umbrella className="w-4 h-4" />
                        Type B — Umbrella Clients
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {umbrellaClients.map((client) => (
                            <div key={client.id} className="bg-white border border-indigo-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                                            {client.name?.[0]?.toUpperCase() || "C"}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{client.name}</h3>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                                <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                                                    UMBRELLA
                                                </span>
                                                <span>•</span>
                                                <span>{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-indigo-50 mt-3">
                                    {/* Umbrella info */}
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center text-gray-500 gap-2">
                                            <Umbrella className="w-3.5 h-3.5" />
                                            <span className="text-xs">{client.umbrella_name}</span>
                                            {client.concurrency_cap && (
                                                <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {client.concurrency_cap} slots
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Onboarding status */}
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2">
                                            {client.onboarding_completed ? (
                                                <span className="flex items-center gap-1 text-xs text-green-600">
                                                    <CheckCircle className="w-3.5 h-3.5" />
                                                    Onboarded
                                                    {client.industry && <span className="text-gray-400">· {client.industry}</span>}
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    Awaiting Onboarding
                                                </span>
                                            )}
                                        </div>
                                        <Link href={`/client/${client.id}/agents`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                                            Manage →
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── CUSTOM CLIENTS ── */}
            <div className="space-y-3">
                {umbrellaClients.length > 0 && (
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        Type A — Custom Key Clients
                    </h3>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {clients.length === 0 ? (
                        <div className="col-span-full h-[300px] flex flex-col items-center justify-center border border-dashed rounded-xl bg-gray-50/50">
                            <Users className="w-12 h-12 text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900">No clients yet</h3>
                            <p className="text-gray-500 mb-6">Add your first client to get started.</p>
                        </div>
                    ) : customClients.length === 0 && umbrellaClients.length > 0 ? (
                        <div className="col-span-full h-[120px] flex flex-col items-center justify-center border border-dashed rounded-xl bg-gray-50/50">
                            <p className="text-gray-400 text-sm">No Type A clients yet.</p>
                        </div>
                    ) : (
                        customClients.map((client) => (
                            <div key={client.id} className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                            {client.name?.[0]?.toUpperCase() || "C"}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{client.name}</h3>
                                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                                <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">CUSTOM</span>
                                                <span>•</span>
                                                <span>{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2 border-t mt-4">
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center text-gray-500 gap-2">
                                            <Key className="w-4 h-4" />
                                            <span className="text-xs font-mono bg-gray-50 px-2 py-1 rounded">
                                                {client.vapi_key ? "••••" + client.vapi_key.slice(-4) : "Not Configured"}
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
        </div>
    );
}
