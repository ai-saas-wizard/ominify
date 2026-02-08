import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
    ArrowLeft,
    MessageSquare,
    Mail,
    Phone,
    Clock,
    GitBranch,
    Zap,
    Users,
    CheckCircle2,
    AlertCircle,
    Pause,
    XCircle,
} from "lucide-react";
import { SequenceDetailClient } from "@/components/sequences/sequence-detail-client";

const URGENCY_COLORS: Record<string, string> = {
    critical: "bg-red-100 text-red-700 border-red-200",
    high: "bg-orange-100 text-orange-700 border-orange-200",
    medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    low: "bg-green-100 text-green-700 border-green-200",
};

const TRIGGER_LABELS: Record<string, string> = {
    new_lead: "New Lead",
    missed_call: "Missed Call",
    form_submission: "Form Submission",
    manual: "Manual",
    tag_added: "Tag Added",
    status_change: "Status Change",
    schedule: "Schedule",
};

async function getSequenceWithDetails(sequenceId: string) {
    const { data: sequence, error } = await supabase
        .from("sequences")
        .select(`
            *,
            sequence_steps(*),
            sequence_enrollments(*, contacts(id, name, phone, email))
        `)
        .eq("id", sequenceId)
        .single();

    if (error || !sequence) {
        return null;
    }

    // Sort steps by step_order
    if (sequence.sequence_steps) {
        sequence.sequence_steps.sort(
            (a: any, b: any) => a.step_order - b.step_order
        );
    }

    // Compute enrollment stats
    const enrollments = sequence.sequence_enrollments || [];
    const stats = {
        active: enrollments.filter((e: any) => e.status === "active").length,
        paused: enrollments.filter((e: any) => e.status === "paused").length,
        completed: enrollments.filter((e: any) => e.status === "completed").length,
        replied: enrollments.filter((e: any) => e.status === "replied").length,
        booked: enrollments.filter((e: any) => e.status === "booked").length,
        failed: enrollments.filter((e: any) => e.status === "failed").length,
        total: enrollments.length,
    };

    return { ...sequence, enrollment_stats: stats };
}

export default async function SequenceDetailPage({
    params,
}: {
    params: Promise<{ clientId: string; sequenceId: string }>;
}) {
    const { clientId, sequenceId } = await params;
    const sequence = await getSequenceWithDetails(sequenceId);

    if (!sequence) {
        notFound();
    }

    return (
        <div className="p-4 lg:p-8 max-w-[1600px] mx-auto space-y-6">
            {/* Back Link */}
            <Link
                href={`/client/${clientId}/sequences`}
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Sequences
            </Link>

            {/* Sequence Header */}
            <div className="bg-white rounded-xl border shadow-sm p-6">
                <div className="flex items-start justify-between">
                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold text-gray-900">
                            {sequence.name}
                        </h1>
                        {sequence.description && (
                            <p className="text-gray-500">{sequence.description}</p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                                {TRIGGER_LABELS[sequence.trigger_type] || sequence.trigger_type}
                            </span>
                            <span
                                className={`text-xs px-2 py-0.5 rounded-full border ${
                                    URGENCY_COLORS[sequence.urgency_tier] || URGENCY_COLORS.medium
                                }`}
                            >
                                {sequence.urgency_tier}
                            </span>
                            {sequence.is_active ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                    Active
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                    Inactive
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Enrollment Stats Bar */}
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                        <Zap className="w-4 h-4 text-green-600" />
                        <div>
                            <p className="text-xs text-green-600 font-medium">Active</p>
                            <p className="text-lg font-bold text-green-700">
                                {sequence.enrollment_stats.active}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 rounded-lg">
                        <Pause className="w-4 h-4 text-yellow-600" />
                        <div>
                            <p className="text-xs text-yellow-600 font-medium">Paused</p>
                            <p className="text-lg font-bold text-yellow-700">
                                {sequence.enrollment_stats.paused}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-blue-600" />
                        <div>
                            <p className="text-xs text-blue-600 font-medium">Completed</p>
                            <p className="text-lg font-bold text-blue-700">
                                {sequence.enrollment_stats.completed}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
                        <MessageSquare className="w-4 h-4 text-purple-600" />
                        <div>
                            <p className="text-xs text-purple-600 font-medium">Replied</p>
                            <p className="text-lg font-bold text-purple-700">
                                {sequence.enrollment_stats.replied}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg">
                        <Users className="w-4 h-4 text-emerald-600" />
                        <div>
                            <p className="text-xs text-emerald-600 font-medium">Booked</p>
                            <p className="text-lg font-bold text-emerald-700">
                                {sequence.enrollment_stats.booked}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg">
                        <XCircle className="w-4 h-4 text-red-600" />
                        <div>
                            <p className="text-xs text-red-600 font-medium">Failed</p>
                            <p className="text-lg font-bold text-red-700">
                                {sequence.enrollment_stats.failed}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Client component handles interactive step timeline and enrollments */}
            <SequenceDetailClient
                clientId={clientId}
                sequenceId={sequenceId}
                sequence={sequence}
                steps={sequence.sequence_steps || []}
                enrollments={sequence.sequence_enrollments || []}
                isActive={sequence.is_active}
            />
        </div>
    );
}
