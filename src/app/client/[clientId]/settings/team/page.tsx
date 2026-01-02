import { getClientMembers, addClientMember, removeClientMember } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft, Users, Plus, UserPlus } from "lucide-react";
import { revalidatePath } from "next/cache";
import { AddMemberForm } from "@/components/settings/add-member-form";
import { RemoveMemberButton } from "@/components/settings/remove-member-button";

export default async function ClientTeamPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    const user = await currentUser();
    const userEmail = user?.emailAddresses[0]?.emailAddress;

    // Get client info
    const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', clientId)
        .single();

    // Get current team members
    const members = await getClientMembers(clientId);

    async function handleAddMember(formData: FormData) {
        "use server";
        const email = formData.get("email") as string;
        const name = formData.get("name") as string;
        const role = (formData.get("role") as string) || "member";

        if (!email) return;

        await addClientMember(clientId, email, role as any, userEmail, name);
        revalidatePath(`/client/${clientId}/settings/team`);
    }

    async function handleRemoveMember(formData: FormData) {
        "use server";
        const memberId = formData.get("memberId") as string;

        if (!memberId) return;

        // Prevent removing yourself
        const memberToRemove = members.find(m => m.id === memberId);
        if (memberToRemove?.email === userEmail) {
            throw new Error("Cannot remove yourself");
        }

        await removeClientMember(memberId);
        revalidatePath(`/client/${clientId}/settings/team`);
    }

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <Link
                    href={`/client/${clientId}/settings`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Settings
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">Team Members</h1>
                <p className="mt-1 text-gray-600">
                    Invite team members to access {client?.name || "this account"}
                </p>
            </div>

            {/* Add Member */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <UserPlus className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Invite Team Member</h2>
                    </div>
                </div>
                <div className="p-6">
                    <AddMemberForm addMember={handleAddMember} />
                </div>
            </div>

            {/* Current Members */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Users className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Current Members</h2>
                    </div>
                </div>
                <div className="divide-y divide-gray-200">
                    {members.map((member) => (
                        <div key={member.id} className="px-6 py-4 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="font-medium text-gray-900">{member.name || member.email}</p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${member.role === 'owner'
                                            ? 'bg-violet-100 text-violet-700'
                                            : member.role === 'admin'
                                                ? 'bg-blue-100 text-blue-700'
                                                : 'bg-gray-100 text-gray-600'
                                        }`}>
                                        {member.role}
                                    </span>
                                    {!member.accepted_at && (
                                        <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">
                                            Pending
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500">{member.email}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    Added {new Date(member.created_at).toLocaleDateString()}
                                    {member.invited_by && ` by ${member.invited_by}`}
                                </p>
                            </div>
                            {member.email !== userEmail && (
                                <RemoveMemberButton memberId={member.id} removeMember={handleRemoveMember} />
                            )}
                            {member.email === userEmail && (
                                <span className="text-xs text-gray-400 px-2 py-1 bg-gray-100 rounded">You</span>
                            )}
                        </div>
                    ))}
                    {members.length === 0 && (
                        <div className="px-6 py-12 text-center text-gray-500">
                            No team members yet. Invite someone above!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
