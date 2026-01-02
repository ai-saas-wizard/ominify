import { getAllAdmins, addAdmin, removeAdmin } from "@/lib/auth";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft, Shield, Plus, Trash2 } from "lucide-react";
import { revalidatePath } from "next/cache";
import { AddAdminForm } from "@/components/admin/add-admin-form";
import { RemoveAdminButton } from "@/components/admin/remove-admin-button";

export default async function AdminUsersPage() {
    const user = await currentUser();
    const userEmail = user?.emailAddresses[0]?.emailAddress;

    const admins = await getAllAdmins();

    async function handleAddAdmin(formData: FormData) {
        "use server";
        const email = formData.get("email") as string;
        const name = formData.get("name") as string;

        if (!email) return;

        await addAdmin(email, name, userEmail);
        revalidatePath("/admin/settings/admins");
    }

    async function handleRemoveAdmin(formData: FormData) {
        "use server";
        const adminId = formData.get("adminId") as string;

        if (!adminId) return;

        // Prevent removing yourself
        const adminToRemove = admins.find(a => a.id === adminId);
        if (adminToRemove?.email === userEmail) {
            throw new Error("Cannot remove yourself");
        }

        await removeAdmin(adminId);
        revalidatePath("/admin/settings/admins");
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin/settings"
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Settings
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">Manage Admins</h1>
                    <p className="mt-2 text-gray-600">Add or remove platform administrators</p>
                </div>

                {/* Add Admin */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Plus className="w-5 h-5 text-gray-600" />
                            <h2 className="text-lg font-semibold text-gray-900">Add Administrator</h2>
                        </div>
                    </div>
                    <div className="p-6">
                        <AddAdminForm addAdmin={handleAddAdmin} />
                    </div>
                </div>

                {/* Current Admins */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Shield className="w-5 h-5 text-gray-600" />
                            <h2 className="text-lg font-semibold text-gray-900">Current Administrators</h2>
                        </div>
                    </div>
                    <div className="divide-y divide-gray-200">
                        {admins.map((admin) => (
                            <div key={admin.id} className="px-6 py-4 flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-gray-900">{admin.name || admin.email}</p>
                                    <p className="text-sm text-gray-500">{admin.email}</p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Added {new Date(admin.created_at).toLocaleDateString()}
                                        {admin.added_by && ` by ${admin.added_by}`}
                                    </p>
                                </div>
                                {admin.email !== userEmail && (
                                    <RemoveAdminButton adminId={admin.id} removeAdmin={handleRemoveAdmin} />
                                )}
                                {admin.email === userEmail && (
                                    <span className="text-xs text-gray-400 px-2 py-1 bg-gray-100 rounded">You</span>
                                )}
                            </div>
                        ))}
                        {admins.length === 0 && (
                            <div className="px-6 py-12 text-center text-gray-500">
                                No administrators found.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
