import { getClientMembers, addClientMember, removeClientMember } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft, Users, UserPlus } from "lucide-react";
import { revalidatePath } from "next/cache";
import { AddMemberForm } from "@/components/settings/add-member-form";
import { RemoveMemberButton } from "@/components/settings/remove-member-button";
import { PageTransition } from "@/components/ui/page-transition";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamMemberList } from "@/components/settings/team-member-list";

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
        <PageTransition>
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
                <Card>
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center gap-3 space-y-0 px-6 py-4">
                        <UserPlus className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Invite Team Member</h2>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <AddMemberForm addMember={handleAddMember} />
                    </CardContent>
                </Card>

                {/* Current Members */}
                <Card>
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center gap-3 space-y-0 px-6 py-4">
                        <Users className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Current Members</h2>
                    </CardHeader>
                    <TeamMemberList
                        members={members}
                        userEmail={userEmail}
                        handleRemoveMember={handleRemoveMember}
                    />
                </Card>
            </div>
        </PageTransition>
    );
}
