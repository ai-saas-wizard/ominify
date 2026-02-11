import { supabase } from "@/lib/supabase";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft, User, Shield, Users, ChevronRight, Webhook, Plug } from "lucide-react";
import { revalidatePath } from "next/cache";
import { UpdateProfileForm } from "@/components/settings/update-profile-form";
import { getClientMembers } from "@/lib/auth";


export default async function ClientSettingsPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    // Fetch client data
    const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

    if (!client) {
        return <div className="p-8 text-center text-red-600">Client not found</div>;
    }

    // Get Clerk user info
    const clerkUser = await currentUser();

    // Get team member count
    const members = await getClientMembers(clientId);

    // Get webhook count
    const { count: webhookCount } = await supabase
        .from('webhooks')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

    async function updateProfile(formData: FormData) {
        "use server";
        const name = formData.get("name") as string;
        const email = formData.get("email") as string;

        await supabase
            .from('clients')
            .update({ name, email })
            .eq('id', clientId);

        revalidatePath(`/client/${clientId}/settings`);
    }

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <Link
                    href={`/client/${clientId}`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                <p className="mt-1 text-gray-600">Manage your account settings and preferences</p>
            </div>

            {/* Account Details Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Account Details</h2>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-gray-500">Account ID</p>
                            <p className="font-mono text-sm text-gray-900">{client.id}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Member Since</p>
                            <p className="text-gray-900">{new Date(client.created_at).toLocaleDateString()}</p>
                        </div>
                    </div>
                    {clerkUser && (
                        <div className="pt-4 border-t border-gray-100">
                            <p className="text-sm text-gray-500 mb-2">Signed in as</p>
                            <div className="flex items-center gap-3">
                                {clerkUser.imageUrl && (
                                    <img
                                        src={clerkUser.imageUrl}
                                        alt="Profile"
                                        className="w-10 h-10 rounded-full"
                                    />
                                )}
                                <div>
                                    <p className="font-medium text-gray-900">
                                        {clerkUser.firstName} {clerkUser.lastName}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {clerkUser.emailAddresses[0]?.emailAddress}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Profile Settings */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <User className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Profile Information</h2>
                    </div>
                </div>
                <div className="p-6">
                    <UpdateProfileForm
                        currentName={client.name || ""}
                        currentEmail={client.email || ""}
                        updateProfile={updateProfile}
                    />
                </div>
            </div>

            {/* Team Members Link */}
            <Link
                href={`/client/${clientId}/settings/team`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:border-violet-300 transition-colors"
            >
                <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-violet-100 rounded-lg">
                            <Users className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
                            <p className="text-sm text-gray-500">
                                {members.length} member{members.length !== 1 ? 's' : ''} • Manage who can access this account
                            </p>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
            </Link>

            {/* Integrations Link */}
            <Link
                href={`/client/${clientId}/settings/integrations`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:border-blue-300 transition-colors"
            >
                <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <Plug className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>
                            <p className="text-sm text-gray-500">
                                Connect Google Calendar and other services
                            </p>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
            </Link>

            {/* Webhooks Link */}
            <Link
                href={`/client/${clientId}/settings/webhooks`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:border-indigo-300 transition-colors"
            >
                <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <Webhook className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Webhooks</h2>
                            <p className="text-sm text-gray-500">
                                {webhookCount || 0} webhook{webhookCount !== 1 ? 's' : ''} • Receive real-time call notifications
                            </p>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
            </Link>
        </div>
    );
}
