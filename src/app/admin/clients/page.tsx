import { supabase } from "@/lib/supabase";
import { secretLastChars } from "@/lib/encryption-helpers";
import { Users, Key, CreditCard, Umbrella, CheckCircle, Clock, Zap } from "lucide-react";
import Link from "next/link";
import { CreateClientDialog } from "@/components/admin/create-client-dialog";
import { DisableClientButton } from "@/components/admin/disable-client-button";
import { ClientCard } from "@/components/admin/client-card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionBadge } from "@/components/admin/subscription-badge";

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

    // Enrich UMBRELLA clients with concurrency + onboarding status.
    // Also compute key_last_four server-side and strip the raw ciphertext
    // `vapi_key` from every client row so it never reaches any render path.
    const enriched = await Promise.all(
        data.map(async (client) => {
            // Compute last-4 from decrypted key (safe whether plaintext or ciphertext)
            const keyLastFour = secretLastChars(client.vapi_key, 4);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { vapi_key, ...safeClient } = client;

            // Load live subscription status for admin-facing badge.
            const { data: sub } = await supabase
                .from("subscriptions")
                .select("status")
                .eq("client_id", client.id)
                .in("status", ["active", "trialing", "past_due", "admin_granted"])
                .maybeSingle();

            const enrichedClient = {
                ...safeClient,
                key_last_four: keyLastFour,
                subscription_status: (sub?.status as string | undefined) ?? null,
            };

            if (enrichedClient.account_type === "UMBRELLA") {
                // Get concurrency cap from assignment
                const { data: assignment } = await supabase
                    .from("tenant_vapi_assignments")
                    .select("tenant_concurrency_cap")
                    .eq("client_id", enrichedClient.id)
                    .eq("is_active", true)
                    .single();

                // Get onboarding status
                const { data: profile } = await supabase
                    .from("tenant_profiles")
                    .select("onboarding_completed, industry")
                    .eq("client_id", enrichedClient.id)
                    .single();

                return {
                    ...enrichedClient,
                    concurrency_cap: assignment?.tenant_concurrency_cap,
                    onboarding_completed: profile?.onboarding_completed || false,
                    industry: profile?.industry,
                };
            }
            return enrichedClient;
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
                            <span className="ml-2 text-emerald-600">
                                {umbrellaClients.length} Umbrella · {customClients.length} Custom
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/admin/billing"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
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
                    <h3 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-2">
                        <Umbrella className="w-4 h-4" />
                        Type B — Umbrella Clients
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {umbrellaClients.map((client, i) => (
                            <ClientCard key={client.id} index={i} disabled={!!client.disabled} variant="umbrella">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${client.disabled ? "bg-red-50 text-red-400" : "bg-emerald-50 text-emerald-600"}`}>
                                            {client.name?.[0]?.toUpperCase() || "C"}
                                        </div>
                                        <div>
                                            <h3 className={`font-semibold ${client.disabled ? "text-gray-400" : "text-gray-900"}`}>{client.name}</h3>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-200">
                                                    UMBRELLA
                                                </Badge>
                                                {client.disabled && (
                                                    <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">
                                                        DISABLED
                                                    </Badge>
                                                )}
                                                <SubscriptionBadge
                                                    clientId={client.id}
                                                    accountType={client.account_type}
                                                    grandfathered={!!client.subscription_grandfathered}
                                                    subscriptionStatus={client.subscription_status}
                                                />
                                                <span className="text-xs text-gray-400 truncate max-w-[140px]">{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <DisableClientButton clientId={client.id} clientName={client.name} disabled={!!client.disabled} />
                                </div>

                                <div className="space-y-2 pt-3 border-t border-gray-100 mt-3">
                                    {client.concurrency_cap && (
                                        <div className="flex items-center text-gray-500 gap-2 text-sm">
                                            <Zap className="w-3.5 h-3.5" />
                                            <span className="text-xs">{client.concurrency_cap} concurrency slots</span>
                                        </div>
                                    )}

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
                                        <Link href={`/client/${client.id}/agents`} className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
                                            Manage →
                                        </Link>
                                    </div>
                                </div>
                            </ClientCard>
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
                        customClients.map((client, i) => (
                            <ClientCard key={client.id} index={i} disabled={!!client.disabled} variant="custom">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${client.disabled ? "bg-red-50 text-red-400" : "bg-blue-50 text-blue-600"}`}>
                                            {client.name?.[0]?.toUpperCase() || "C"}
                                        </div>
                                        <div>
                                            <h3 className={`font-semibold ${client.disabled ? "text-gray-400" : "text-gray-900"}`}>{client.name}</h3>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                    CUSTOM
                                                </Badge>
                                                {client.disabled && (
                                                    <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">
                                                        DISABLED
                                                    </Badge>
                                                )}
                                                <SubscriptionBadge
                                                    clientId={client.id}
                                                    accountType={client.account_type}
                                                    grandfathered={!!client.subscription_grandfathered}
                                                    subscriptionStatus={client.subscription_status}
                                                />
                                                <span className="text-xs text-gray-400 truncate max-w-[140px]">{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <DisableClientButton clientId={client.id} clientName={client.name} disabled={!!client.disabled} />
                                </div>

                                <div className="space-y-3 pt-3 border-t border-gray-100 mt-3">
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center text-gray-500 gap-2">
                                            <Key className="w-4 h-4" />
                                            <span className="text-xs font-mono bg-gray-50 px-2 py-1 rounded">
                                                {client.key_last_four ? "••••" + client.key_last_four : "Not Configured"}
                                            </span>
                                        </div>
                                        <Link href={`/client/${client.id}/agents`} className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
                                            Manage Agents →
                                        </Link>
                                    </div>
                                </div>
                            </ClientCard>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
