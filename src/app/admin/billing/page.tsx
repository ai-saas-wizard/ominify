import { getAllClientsBilling, getPlatformBillingSummary, updateClientPricing, addMinutesToBalance } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft, DollarSign, TrendingUp, Users, Clock, AlertTriangle } from "lucide-react";
import { ClientPricingEditor } from "@/components/admin/client-pricing-editor";
import { AddMinutesModal } from "@/components/admin/add-minutes-modal";
import { revalidatePath } from "next/cache";

export default async function AdminBillingPage() {
    const [summary, clientsBilling] = await Promise.all([
        getPlatformBillingSummary(),
        getAllClientsBilling()
    ]);

    async function updatePricing(formData: FormData) {
        "use server";
        const clientId = formData.get("clientId") as string;
        const pricePerMinute = parseFloat(formData.get("pricePerMinute") as string);
        const costPerMinute = parseFloat(formData.get("costPerMinute") as string);

        await updateClientPricing(clientId, pricePerMinute, costPerMinute);
        revalidatePath("/admin/billing");
    }

    async function addMinutes(formData: FormData) {
        "use server";
        const clientId = formData.get("clientId") as string;
        const minutes = parseInt(formData.get("minutes") as string);

        await addMinutesToBalance(clientId, minutes);
        revalidatePath("/admin/billing");
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin"
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Admin
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">Billing Management</h1>
                    <p className="mt-2 text-gray-600">Manage client pricing, view revenue, and track usage</p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-100 rounded-lg">
                                <DollarSign className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Revenue</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    ${summary.totalRevenue.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-100 rounded-lg">
                                <TrendingUp className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Cost (Vapi)</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    ${summary.totalCost.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-violet-100 rounded-lg">
                                <DollarSign className="w-6 h-6 text-violet-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Profit</p>
                                <p className="text-2xl font-bold text-green-600">
                                    ${summary.totalProfit.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-100 rounded-lg">
                                <Clock className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Minutes Sold / Used</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {summary.totalMinutesSold} / {summary.totalMinutesUsed}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Client Pricing Table */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-900">Client Pricing</h2>
                        <p className="text-sm text-gray-500">Set custom pricing for each client</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Client
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Balance
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Price/Min
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Cost/Min
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Margin
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {clientsBilling.map(({ client, billing, balance }) => {
                                    const margin = billing.price_per_minute - billing.cost_per_minute;
                                    const marginPercent = ((margin / billing.cost_per_minute) * 100).toFixed(0);
                                    const isLowBalance = balance.balance_minutes <= 10;
                                    const isNegative = balance.balance_minutes < 0;

                                    return (
                                        <tr key={client.id} className={`hover:bg-gray-50 ${isNegative ? 'bg-red-50' : ''}`}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div>
                                                    <div className="font-medium text-gray-900">
                                                        {client.name || "Unnamed"}
                                                    </div>
                                                    <div className="text-sm text-gray-500">{client.email}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    {isNegative && (
                                                        <AlertTriangle className="w-4 h-4 text-red-500" />
                                                    )}
                                                    <span className={`font-medium ${isNegative ? 'text-red-600' :
                                                            isLowBalance ? 'text-orange-600' : 'text-green-600'
                                                        }`}>
                                                        {balance.balance_minutes.toFixed(0)} mins
                                                    </span>
                                                    {isNegative && (
                                                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                                                            OVERDUE
                                                        </span>
                                                    )}
                                                    {!isNegative && isLowBalance && (
                                                        <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">
                                                            LOW
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                                                ${billing.price_per_minute.toFixed(2)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                ${billing.cost_per_minute.toFixed(2)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-green-600 font-medium">
                                                    ${margin.toFixed(2)} ({marginPercent}%)
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <AddMinutesModal
                                                        clientId={client.id}
                                                        clientName={client.name || "Client"}
                                                        currentBalance={balance.balance_minutes}
                                                        addMinutes={addMinutes}
                                                    />
                                                    <ClientPricingEditor
                                                        clientId={client.id}
                                                        currentPrice={billing.price_per_minute}
                                                        currentCost={billing.cost_per_minute}
                                                        updatePricing={updatePricing}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {clientsBilling.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                            No clients found. Clients will appear here once they sign up.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
