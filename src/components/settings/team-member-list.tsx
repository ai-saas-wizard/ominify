"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { RemoveMemberButton } from "./remove-member-button";
import { staggerContainer, staggerItem } from "@/lib/settings-animations";

interface Member {
    id: string;
    name: string | null;
    email: string;
    role: string;
    accepted_at: string | null;
    created_at: string;
    invited_by: string | null;
}

const roleBadgeClass: Record<string, string> = {
    owner: "bg-violet-100 text-violet-700 border-violet-200",
    admin: "bg-blue-100 text-blue-700 border-blue-200",
    member: "bg-gray-100 text-gray-600 border-gray-200",
};

export function TeamMemberList({
    members,
    userEmail,
    handleRemoveMember,
}: {
    members: Member[];
    userEmail?: string;
    handleRemoveMember: (formData: FormData) => Promise<void>;
}) {
    if (members.length === 0) {
        return (
            <div className="px-6 py-12 text-center text-gray-500">
                No team members yet. Invite someone above!
            </div>
        );
    }

    return (
        <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="divide-y divide-gray-200"
        >
            {members.map((member) => (
                <motion.div
                    key={member.id}
                    variants={staggerItem}
                    className="px-6 py-4 flex items-center justify-between"
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">
                                {member.name || member.email}
                            </p>
                            <Badge className={roleBadgeClass[member.role] || roleBadgeClass.member}>
                                {member.role}
                            </Badge>
                            {!member.accepted_at && (
                                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">
                                    Pending
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">{member.email}</p>
                        <p className="text-xs text-gray-400 mt-1">
                            Added {new Date(member.created_at).toLocaleDateString()}
                            {member.invited_by && ` by ${member.invited_by}`}
                        </p>
                    </div>
                    {member.email !== userEmail && (
                        <RemoveMemberButton
                            memberId={member.id}
                            removeMember={handleRemoveMember}
                        />
                    )}
                    {member.email === userEmail && (
                        <Badge variant="secondary">You</Badge>
                    )}
                </motion.div>
            ))}
        </motion.div>
    );
}
