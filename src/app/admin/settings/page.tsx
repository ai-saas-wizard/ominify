import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft, DollarSign, Download, RefreshCw, Shield, ChevronRight } from "lucide-react";
import { revalidatePath } from "next/cache";
import { DefaultPricingForm } from "@/components/admin/default-pricing-form";
import { ExportClientsButton } from "@/components/admin/export-clients-button";
import { SyncUsageButton } from "@/components/admin/sync-usage-button";
import { getAllAdmins } from "@/lib/auth";

// Get platform settings from database or env
async function getPlatformSettings() {
    const { data } = await supabase
        .from('platform_settings')
        .select('*')
        .single();

    return data || {
        default_price_per_minute: 0.15,
        default_cost_per_minute: 0.12,
    };
}

// Get all clients for export
async function getAllClientsData() {
    const { data: clients } = await supabase
        .from('clients')
        .select('id, name, email, account_type, created_at');

    if (!clients) return [];

    // Get billing and balance for each client
    const enrichedClients = await Promise.all(
        clients.map(async (client) => {
            const { data: billing } = await supabase
                .from('client_billing')
                .select('price_per_minute, cost_per_minute')
                .eq('client_id', client.id)
                .single();

            const { data: balance } = await supabase
                .from('minute_balances')
                .select('balance_minutes, total_purchased_minutes, total_used_minutes')
                .eq('client_id', client.id)
                .single();

            return {
                ...client,
                price_per_minute: billing?.price_per_minute || 0.15,
                cost_per_minute: billing?.cost_per_minute || 0.12,
                balance_minutes: balance?.balance_minutes || 0,
                total_purchased: balance?.total_purchased_minutes || 0,
                total_used: balance?.total_used_minutes || 0,
            };
        })
    );

    return enrichedClients;
}

export default async function AdminSettingsPage() {
    const settings = await getPlatformSettings();
    const clients = await getAllClientsData();
    const admins = await getAllAdmins();

    async function updateDefaultPricing(formData: FormData) {
        "use server";
        const defaultPrice = parseFloat(formData.get("defaultPrice") as string);
        const defaultCost = parseFloat(formData.get("defaultCost") as string);

        // Upsert platform settings
        await supabase
            .from('platform_settings')
            .upsert({
                id: 'default',
                default_price_per_minute: defaultPrice,
                default_cost_per_minute: defaultCost,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

        revalidatePath("/admin/settings");
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin"
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Admin
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">Platform Settings</h1>
                    <p className="mt-2 text-gray-600">Configure default settings and manage platform data</p>
                </div>

                <div className="space-y-6">
                    {/* Manage Admins Link */}
                    <Link
                        href="/admin/settings/admins"
                        className="block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:border-violet-300 transition-colors"
                    >
                        <div className="px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-violet-100 rounded-lg">
                                    <Shield className="w-5 h-5 text-violet-600" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">Manage Administrators</h2>
                                    <p className="text-sm text-gray-500">
                                        {admins.length} admin{admins.length !== 1 ? 's' : ''} • Add or remove platform admins
                                    </p>
                                </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                    </Link>

                    {/* Default Pricing */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                            <div className="flex items-center gap-3">
                                <DollarSign className="w-5 h-5 text-gray-600" />
                                <h2 className="text-lg font-semibold text-gray-900">Default Pricing</h2>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                                Set default per-minute rates for new clients
                            </p>
                        </div>
                        <div className="p-6">
                            <DefaultPricingForm
                                currentPrice={settings.default_price_per_minute}
                                currentCost={settings.default_cost_per_minute}
                                updatePricing={updateDefaultPricing}
                            />
                        </div>
                    </div>

                    {/* Export Clients */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                            <div className="flex items-center gap-3">
                                <Download className="w-5 h-5 text-gray-600" />
                                <h2 className="text-lg font-semibold text-gray-900">Export Data</h2>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                                Download client and billing data as CSV
                            </p>
                        </div>
                        <div className="p-6">
                            <ExportClientsButton clients={clients} />
                        </div>
                    </div>

                    {/* Sync Usage */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                            <div className="flex items-center gap-3">
                                <RefreshCw className="w-5 h-5 text-gray-600" />
                                <h2 className="text-lg font-semibold text-gray-900">Sync Call Usage</h2>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                                Manually sync call usage for all clients
                            </p>
                        </div>
                        <div className="p-6">
                            <SyncUsageButton />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
