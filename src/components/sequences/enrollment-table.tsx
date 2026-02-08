"use client";

import { useState } from "react";
import { Loader2, UserMinus, Phone, Users } from "lucide-react";
import { unenrollContact } from "@/app/actions/sequence-actions";
import { useRouter } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-blue-100 text-blue-700",
    replied: "bg-purple-100 text-purple-700",
    booked: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    unenrolled: "bg-gray-100 text-gray-500",
};

interface Enrollment {
    id: string;
    status: string;
    current_step_order: number;
    enrolled_at: string;
    completed_at: string | null;
    source: string | null;
    contact_id: string;
    contacts: {
        id: string;
        name: string | null;
        phone: string;
        email: string | null;
    } | null;
}

export function EnrollmentTable({
    enrollments,
}: {
    enrollments: Enrollment[];
}) {
    const [unenrollingId, setUnenrollingId] = useState<string | null>(null);
    const router = useRouter();

    const handleUnenroll = async (enrollmentId: string) => {
        if (!confirm("Are you sure you want to unenroll this contact?")) return;
        setUnenrollingId(enrollmentId);

        const res = await unenrollContact(enrollmentId);

        setUnenrollingId(null);
        if (res.success) {
            router.refresh();
        } else {
            alert(res.error || "Failed to unenroll contact");
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.floor(
            (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    if (enrollments.length === 0) {
        return (
            <div className="bg-white rounded-xl border shadow-sm p-12 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-1">
                    No enrollments yet
                </h4>
                <p className="text-gray-500 text-sm">
                    Contacts will appear here when they are enrolled in this sequence.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b">
                <h3 className="font-semibold text-gray-900">
                    Enrollments ({enrollments.length})
                </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-3 text-left font-medium">Contact</th>
                            <th className="px-6 py-3 text-left font-medium">Phone</th>
                            <th className="px-6 py-3 text-center font-medium">Status</th>
                            <th className="px-6 py-3 text-center font-medium">
                                Current Step
                            </th>
                            <th className="px-6 py-3 text-left font-medium">Enrolled</th>
                            <th className="px-6 py-3 text-right font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {enrollments.map((enrollment) => (
                            <tr
                                key={enrollment.id}
                                className="hover:bg-gray-50 transition-colors"
                            >
                                <td className="px-6 py-4">
                                    <p className="font-medium text-gray-900">
                                        {enrollment.contacts?.name || "Unknown"}
                                    </p>
                                    {enrollment.contacts?.email && (
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {enrollment.contacts.email}
                                        </p>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-sm text-gray-600 font-mono flex items-center gap-1.5">
                                        <Phone className="w-3.5 h-3.5 text-gray-400" />
                                        {enrollment.contacts?.phone || "-"}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                            STATUS_COLORS[enrollment.status] ||
                                            STATUS_COLORS.active
                                        }`}
                                    >
                                        {enrollment.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-violet-100 text-violet-700 text-xs font-medium rounded-full">
                                        #{enrollment.current_step_order}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-sm text-gray-500">
                                        {formatDate(enrollment.enrolled_at)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {(enrollment.status === "active" ||
                                        enrollment.status === "paused") && (
                                        <button
                                            onClick={() => handleUnenroll(enrollment.id)}
                                            disabled={unenrollingId === enrollment.id}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {unenrollingId === enrollment.id ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <UserMinus className="w-3 h-3" />
                                            )}
                                            Unenroll
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
