"use client";

import { useState } from "react";
import { Loader2, UserMinus, Users, FlaskConical } from "lucide-react";
import { unenrollContact } from "@/app/actions/sequence-actions";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { seqCardStatic, seqFocusRing } from "@/components/sequences/theme";

// Status as dot+label: sky=in-flight, amber=paused, red=failed, ink=terminal
// outcomes, gray=inactive. Dynamic enrollments spend most of their life in
// awaiting_outcome / generating_next_step — without entries they'd
// misleadingly render as plain "active".
const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
    active: { dot: "bg-sky-500", text: "text-sky-700" },
    awaiting_outcome: { dot: "bg-sky-500", text: "text-sky-700" },
    generating_next_step: { dot: "bg-sky-500", text: "text-sky-700" },
    paused: { dot: "bg-amber-500", text: "text-amber-700" },
    completed: { dot: "bg-gray-900", text: "text-gray-700" },
    replied: { dot: "bg-gray-900", text: "text-gray-700" },
    booked: { dot: "bg-gray-900", text: "text-gray-700" },
    failed: { dot: "bg-red-500", text: "text-red-700" },
    unenrolled: { dot: "bg-gray-300", text: "text-gray-500" },
};

interface Enrollment {
    id: string;
    status: string;
    current_step_order: number;
    enrolled_at: string;
    completed_at: string | null;
    source: string | null;
    contact_id: string;
    is_test?: boolean;
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
            <div className={cn(seqCardStatic, "p-12 text-center")}>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                    <Users className="h-5 w-5 text-gray-400" />
                </div>
                <h4 className="mb-1 text-base font-semibold text-gray-900">
                    No enrollments yet
                </h4>
                <p className="text-sm text-gray-500">
                    Contacts will appear here when they are enrolled in this sequence.
                </p>
            </div>
        );
    }

    return (
        <div className={cn(seqCardStatic, "overflow-hidden")}>
            <div className="flex items-baseline gap-2 border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-900">Enrollments</h3>
                <span className="text-xs tabular-nums text-gray-400">
                    {enrollments.length}
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
                            <th className="px-4 py-2.5 text-left font-medium">Contact</th>
                            <th className="px-4 py-2.5 text-left font-medium">Phone</th>
                            <th className="px-4 py-2.5 text-left font-medium">Status</th>
                            <th className="px-4 py-2.5 text-right font-medium">Step</th>
                            <th className="px-4 py-2.5 text-left font-medium">Enrolled</th>
                            <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {enrollments.map((enrollment) => {
                            const status =
                                STATUS_STYLES[enrollment.status] || STATUS_STYLES.active;
                            return (
                                <tr
                                    key={enrollment.id}
                                    className="transition-colors hover:bg-gray-50"
                                >
                                    <td className="px-4 py-2.5">
                                        <p className="text-sm font-medium text-gray-900">
                                            {enrollment.contacts?.name || "Unknown"}
                                        </p>
                                        {enrollment.contacts?.email && (
                                            <p className="mt-0.5 text-xs text-gray-500">
                                                {enrollment.contacts.email}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className="font-mono text-xs text-gray-600">
                                            {enrollment.contacts?.phone || "-"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
                                                status.text
                                            )}
                                        >
                                            <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                                            {enrollment.status}
                                        </span>
                                        {enrollment.is_test && (
                                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-1 py-px text-xs font-medium text-amber-700">
                                                <FlaskConical className="h-2.5 w-2.5" />
                                                Test
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="text-sm tabular-nums text-gray-700">
                                            #{enrollment.current_step_order}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className="whitespace-nowrap text-xs text-gray-500">
                                            {formatDate(enrollment.enrolled_at)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        {(enrollment.status === "active" ||
                                            enrollment.status === "paused") && (
                                            <button
                                                onClick={() => handleUnenroll(enrollment.id)}
                                                disabled={unenrollingId === enrollment.id}
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50",
                                                    seqFocusRing
                                                )}
                                            >
                                                {unenrollingId === enrollment.id ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <UserMinus className="h-3 w-3" />
                                                )}
                                                Unenroll
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
