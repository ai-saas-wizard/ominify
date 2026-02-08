import { supabase } from "@/lib/supabase";
import { Umbrella, Users, Zap, BarChart3, ChevronDown } from "lucide-react";
import { CreateUmbrellaDialog } from "@/components/admin/create-umbrella-dialog";
import { MigrateTenantDialog } from "@/components/admin/migrate-tenant-dialog";

type TenantAssignment = {
    id: string;
    client_id: string;
    tenant_concurrency_cap: number;
    is_active: boolean;
    assigned_at: string;
    clients: {
        id: string;
        name: string;
        email: string;
    } | null;
};

type UmbrellaWithStats = {
    id: string;
    name: string;
    umbrella_type: string;
    concurrency_limit: number;
    current_concurrency: number;
    max_tenants: number | null;
    is_active: boolean;
    notes: string | null;
    created_at: string;
    tenant_count: number;
    tenants: TenantAssignment[];
};

async function getUmbrellasWithTenants(): Promise<UmbrellaWithStats[]> {
    const { data: umbrellas, error } = await supabase
        .from("vapi_umbrellas")
        .select("*")
        .eq("is_active", true)
        .order("name");

    if (error) {
        console.error("getUmbrellasWithTenants error:", error);
        return [];
    }

    if (!umbrellas) return [];

    const result: UmbrellaWithStats[] = [];

    for (const umbrella of umbrellas) {
        const { data: assignments, count } = await supabase
            .from("tenant_vapi_assignments")
            .select(
                `
                id,
                client_id,
                tenant_concurrency_cap,
                is_active,
                assigned_at,
                clients (id, name, email)
            `,
                { count: "exact" }
            )
            .eq("umbrella_id", umbrella.id)
            .eq("is_active", true)
            .order("assigned_at", { ascending: false });

        result.push({
            ...umbrella,
            tenant_count: count || 0,
            tenants: (assignments as unknown as TenantAssignment[]) || [],
        });
    }

    return result;
}

export default async function AdminUmbrellasPage() {
    const umbrellas = await getUmbrellasWithTenants();

    const totalCapacity = umbrellas.reduce((sum, u) => sum + u.concurrency_limit, 0);
    const totalActiveTenants = umbrellas.reduce((sum, u) => sum + u.tenant_count, 0);

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">VAPI Umbrellas</h2>
                    <p className="text-muted-foreground">
                        Manage shared VAPI credentials and tenant assignments.
                    </p>
                </div>
                <CreateUmbrellaDialog />
            </div>

            {/* Summary Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-100 rounded-lg">
                            <Umbrella className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Umbrellas</p>
                            <p className="text-2xl font-bold text-gray-900">{umbrellas.length}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-violet-100 rounded-lg">
                            <Zap className="w-6 h-6 text-violet-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Capacity</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {totalCapacity} <span className="text-sm font-normal text-gray-400">slots</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-100 rounded-lg">
                            <Users className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Active Tenants</p>
                            <p className="text-2xl font-bold text-gray-900">{totalActiveTenants}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Umbrellas Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">All Umbrellas</h2>
                    <p className="text-sm text-gray-500">
                        {umbrellas.length} umbrella{umbrellas.length !== 1 ? "s" : ""} configured
                    </p>
                </div>

                {umbrellas.length === 0 ? (
                    <div className="h-[300px] flex flex-col items-center justify-center">
                        <Umbrella className="w-12 h-12 text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">No umbrellas yet</h3>
                        <p className="text-gray-500 mb-6">Create your first umbrella to start managing shared VAPI credentials.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Type
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Concurrency
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Tenants
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Created
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {umbrellas.map((umbrella) => (
                                    <UmbrellaRow key={umbrella.id} umbrella={umbrella} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function UmbrellaRow({ umbrella }: { umbrella: UmbrellaWithStats }) {
    const usagePercent = umbrella.concurrency_limit > 0
        ? Math.round((umbrella.current_concurrency / umbrella.concurrency_limit) * 100)
        : 0;

    return (
        <>
            <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <Umbrella className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="font-medium text-gray-900">{umbrella.name}</div>
                            {umbrella.notes && (
                                <div className="text-xs text-gray-400 max-w-[200px] truncate">{umbrella.notes}</div>
                            )}
                        </div>
                    </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            umbrella.umbrella_type === "dedicated"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-indigo-100 text-indigo-700"
                        }`}
                    >
                        {umbrella.umbrella_type}
                    </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                            {umbrella.current_concurrency}/{umbrella.concurrency_limit}
                        </span>
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full ${
                                    usagePercent >= 90
                                        ? "bg-red-500"
                                        : usagePercent >= 70
                                          ? "bg-amber-500"
                                          : "bg-indigo-500"
                                }`}
                                style={{ width: `${Math.min(usagePercent, 100)}%` }}
                            />
                        </div>
                    </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-sm text-gray-900">{umbrella.tenant_count}</span>
                        {umbrella.max_tenants && (
                            <span className="text-xs text-gray-400">/ {umbrella.max_tenants}</span>
                        )}
                    </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                    </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(umbrella.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                    })}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                        <BarChart3 className="w-4 h-4 text-gray-400" />
                    </div>
                </td>
            </tr>

            {/* Inline tenant rows */}
            {umbrella.tenants.length > 0 && (
                <tr>
                    <td colSpan={7} className="px-0 py-0">
                        <div className="bg-gray-50/70 border-t border-b border-gray-100 px-6 py-3">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                                <ChevronDown className="w-3 h-3" />
                                Assigned Tenants ({umbrella.tenants.length})
                            </div>
                            <div className="space-y-1.5">
                                {umbrella.tenants.map((tenant) => (
                                    <div
                                        key={tenant.id}
                                        className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-gray-100"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold">
                                                {tenant.clients?.name?.[0]?.toUpperCase() || "T"}
                                            </div>
                                            <div>
                                                <span className="text-sm font-medium text-gray-900">
                                                    {tenant.clients?.name || "Unknown"}
                                                </span>
                                                <span className="text-xs text-gray-400 ml-2">
                                                    {tenant.clients?.email || ""}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
                                                {tenant.tenant_concurrency_cap} slots
                                            </span>
                                            <span className="text-xs text-gray-400">
                                                Assigned{" "}
                                                {new Date(tenant.assigned_at).toLocaleDateString("en-US", {
                                                    month: "short",
                                                    day: "numeric",
                                                })}
                                            </span>
                                            <MigrateTenantDialog
                                                clientId={tenant.client_id}
                                                clientName={tenant.clients?.name || "Unknown"}
                                                currentUmbrellaId={umbrella.id}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
