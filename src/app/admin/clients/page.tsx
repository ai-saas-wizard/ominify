import { supabase } from "@/lib/supabase";
import { secretLastChars } from "@/lib/encryption-helpers";
import { Users, Key, CreditCard, Umbrella, CheckCircle, Clock, Zap, Tag, Layers } from "lucide-react";
import Link from "next/link";
import { CreateClientDialog } from "@/components/admin/create-client-dialog";
import { DisableClientButton } from "@/components/admin/disable-client-button";
import { ClientCard } from "@/components/admin/client-card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionBadge } from "@/components/admin/subscription-badge";
import {
    ChangePlanModal,
    type TierOption,
    type OfferOption,
} from "@/components/admin/change-plan-modal";
import {
    listAllTiers,
    getTierPhases,
    type PricingTier,
} from "@/lib/pricing-tiers";
import { listOffers, type Offer } from "@/lib/offers";

export const dynamic = "force-dynamic";

interface EnrichedClient {
    id: string;
    name: string | null;
    email: string | null;
    account_type: string;
    disabled: boolean | null;
    subscription_grandfathered: boolean | null;
    pricing_tier_id: string | null;
    signup_offer_id: string | null;
    key_last_four: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
    last_invoice_at: string | null;
    last_invoice_amount: number | null;
    concurrency_cap?: number;
    onboarding_completed?: boolean;
    industry?: string | null;
    tier_display_name?: string | null;
    tier_price_label?: string | null;
    offer_name?: string | null;
    picker_pending: boolean;
    awaiting_payment: boolean;
}

/**
 * Format a tier's price journey as a compact one-liner for the admin row.
 * Single-phase: "$479/mo". Multi-phase: "$99 → $249 (2mo intro)".
 */
function tierPriceLabel(tier: PricingTier): string {
    const phases = getTierPhases(tier);
    if (phases.length === 1) {
        const p = phases[0];
        const price = Number.isInteger(p.price_usd) ? `$${p.price_usd}` : `$${p.price_usd.toFixed(2)}`;
        return `${price}/mo`;
    }
    const intro = phases[0];
    const tail = phases[phases.length - 1];
    const introPrice = Number.isInteger(intro.price_usd) ? `$${intro.price_usd}` : `$${intro.price_usd.toFixed(2)}`;
    const tailPrice = Number.isInteger(tail.price_usd) ? `$${tail.price_usd}` : `$${tail.price_usd.toFixed(2)}`;
    const introDur = intro.duration_months ? `${intro.duration_months}mo intro` : "";
    return `${introPrice} → ${tailPrice}${introDur ? ` (${introDur})` : ""}`;
}

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    } catch {
        return "—";
    }
}

async function getClients(): Promise<EnrichedClient[]> {
    const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Supabase Error:", error);
        return [];
    }

    if (!data) return [];

    // Cache tier + offer lookups across all clients in one shot so we don't
    // fire N+1 queries for each row's tier/offer join.
    const allTiers = await listAllTiers();
    const tierById = new Map(allTiers.map((t) => [t.id, t]));
    const allOffers = await listOffers();
    const offerById = new Map(allOffers.map((o) => [o.id, o]));

    const enriched = await Promise.all(
        data.map(async (client): Promise<EnrichedClient> => {
            const keyLastFour = secretLastChars(client.vapi_key, 4);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { vapi_key, ...safeClient } = client;

            // Parallel: subscription, last invoice, umbrella enrichment
            const [subResult, lastInvoiceResult, assignmentResult, profileResult] =
                await Promise.all([
                    supabase
                        .from("subscriptions")
                        .select("status, current_period_end")
                        .eq("client_id", client.id)
                        .in("status", ["active", "trialing", "past_due", "admin_granted"])
                        .maybeSingle(),
                    supabase
                        .from("minute_purchases")
                        .select("amount_paid, created_at")
                        .eq("client_id", client.id)
                        .eq("kind", "subscription_grant")
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle(),
                    client.account_type === "UMBRELLA"
                        ? supabase
                              .from("tenant_vapi_assignments")
                              .select("tenant_concurrency_cap")
                              .eq("client_id", client.id)
                              .eq("is_active", true)
                              .maybeSingle()
                        : Promise.resolve({ data: null }),
                    client.account_type === "UMBRELLA"
                        ? supabase
                              .from("tenant_profiles")
                              .select("onboarding_completed, industry")
                              .eq("client_id", client.id)
                              .maybeSingle()
                        : Promise.resolve({ data: null }),
                ]);

            const sub = subResult.data as
                | { status: string; current_period_end: string | null }
                | null;
            const lastInvoice = lastInvoiceResult.data as
                | { amount_paid: number; created_at: string }
                | null;
            const assignment = assignmentResult.data as
                | { tenant_concurrency_cap: number | null }
                | null;
            const profile = profileResult.data as
                | { onboarding_completed: boolean | null; industry: string | null }
                | null;

            const tier = client.pricing_tier_id
                ? tierById.get(client.pricing_tier_id) ?? null
                : null;
            const offer = client.signup_offer_id
                ? offerById.get(client.signup_offer_id) ?? null
                : null;

            const subStatus = sub?.status ?? null;
            const liveSub = subStatus === "active" || subStatus === "trialing";
            const pickerPending = !client.pricing_tier_id && !!client.signup_offer_id && !liveSub;
            const awaitingPayment =
                !!client.pricing_tier_id &&
                !liveSub &&
                subStatus !== "past_due" &&
                subStatus !== "admin_granted" &&
                subStatus !== "canceled" &&
                client.account_type !== "CUSTOM" &&
                !client.subscription_grandfathered;

            return {
                id: safeClient.id,
                name: safeClient.name,
                email: safeClient.email,
                account_type: safeClient.account_type,
                disabled: safeClient.disabled,
                subscription_grandfathered: safeClient.subscription_grandfathered,
                pricing_tier_id: safeClient.pricing_tier_id ?? null,
                signup_offer_id: safeClient.signup_offer_id ?? null,
                key_last_four: keyLastFour,
                subscription_status: subStatus,
                current_period_end: sub?.current_period_end ?? null,
                last_invoice_at: lastInvoice?.created_at ?? null,
                last_invoice_amount: lastInvoice?.amount_paid ?? null,
                concurrency_cap: assignment?.tenant_concurrency_cap ?? undefined,
                onboarding_completed: profile?.onboarding_completed ?? false,
                industry: profile?.industry ?? null,
                tier_display_name: tier?.display_name ?? null,
                tier_price_label: tier ? tierPriceLabel(tier) : null,
                offer_name: offer?.name ?? null,
                picker_pending: pickerPending,
                awaiting_payment: awaitingPayment,
            };
        })
    );

    return enriched;
}

async function getPlanOptions(): Promise<{
    tierOptions: TierOption[];
    offerOptions: OfferOption[];
}> {
    const [tiers, offers] = await Promise.all([listAllTiers(), listOffers()]);

    const tierOptions: TierOption[] = tiers
        .filter((t) => t.is_active)
        .map((t) => ({
            id: t.id,
            slug: t.slug,
            display_name: t.display_name,
            price_label: tierPriceLabel(t),
        }));

    // Count active tiers per offer
    const tierCountByOffer = new Map<string, number>();
    for (const t of tiers) {
        if (t.is_active && t.offer_id) {
            tierCountByOffer.set(t.offer_id, (tierCountByOffer.get(t.offer_id) ?? 0) + 1);
        }
    }

    const offerOptions: OfferOption[] = offers
        .filter((o: Offer) => o.is_active)
        .map((o: Offer) => ({
            id: o.id,
            slug: o.slug,
            name: o.name,
            tier_count: tierCountByOffer.get(o.id) ?? 0,
        }));

    return { tierOptions, offerOptions };
}

function PlanInfo({ client }: { client: EnrichedClient }) {
    if (client.tier_display_name) {
        return (
            <div className="space-y-0.5">
                <p className="text-xs font-medium text-gray-900">
                    {client.tier_display_name}
                </p>
                {client.tier_price_label && (
                    <p className="text-[11px] text-gray-500">{client.tier_price_label}</p>
                )}
            </div>
        );
    }
    if (client.offer_name) {
        return (
            <div className="space-y-0.5">
                <p className="text-xs font-medium text-amber-700 inline-flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    Picker — {client.offer_name}
                </p>
                <p className="text-[11px] text-amber-600">Hasn&apos;t picked a tier yet</p>
            </div>
        );
    }
    return <p className="text-xs text-gray-400">—</p>;
}

function StatusDetail({ client }: { client: EnrichedClient }) {
    if (
        client.subscription_status === "active" ||
        client.subscription_status === "trialing"
    ) {
        return (
            <p className="text-[11px] text-gray-500">
                Next renewal: {formatDate(client.current_period_end)}
            </p>
        );
    }
    if (
        client.subscription_status === "past_due" ||
        client.subscription_status === "canceled"
    ) {
        if (client.last_invoice_at) {
            return (
                <p className="text-[11px] text-gray-500">
                    Last paid: {formatDate(client.last_invoice_at)} · $
                    {client.last_invoice_amount?.toFixed(2) ?? "0.00"}
                </p>
            );
        }
        return null;
    }
    if (client.picker_pending) {
        return (
            <p className="text-[11px] text-amber-600">
                Awaiting tier pick on subscribe page
            </p>
        );
    }
    if (client.awaiting_payment) {
        return <p className="text-[11px] text-indigo-600">Tier assigned, not yet paid</p>;
    }
    return null;
}

export default async function AdminClientsPage() {
    const [clients, { tierOptions, offerOptions }] = await Promise.all([
        getClients(),
        getPlanOptions(),
    ]);

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
                                                    pickerPending={client.picker_pending}
                                                    awaitingPayment={client.awaiting_payment}
                                                />
                                                <span className="text-xs text-gray-400 truncate max-w-[140px]">{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <DisableClientButton clientId={client.id} clientName={client.name ?? "Client"} disabled={!!client.disabled} />
                                </div>

                                {/* Plan + change plan trigger */}
                                <div className="flex items-start justify-between gap-2 pb-3 mb-1 border-b border-gray-100">
                                    <div className="flex items-start gap-2 min-w-0">
                                        <Tag className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <PlanInfo client={client} />
                                            <StatusDetail client={client} />
                                        </div>
                                    </div>
                                    <ChangePlanModal
                                        client={{
                                            id: client.id,
                                            name: client.name,
                                            pricing_tier_id: client.pricing_tier_id,
                                            signup_offer_id: client.signup_offer_id,
                                            subscription_status: client.subscription_status,
                                        }}
                                        tiers={tierOptions}
                                        offers={offerOptions}
                                    />
                                </div>

                                <div className="space-y-2 pt-1">
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
                                                    pickerPending={client.picker_pending}
                                                    awaitingPayment={client.awaiting_payment}
                                                />
                                                <span className="text-xs text-gray-400 truncate max-w-[140px]">{client.email || "No email"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <DisableClientButton clientId={client.id} clientName={client.name ?? "Client"} disabled={!!client.disabled} />
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
