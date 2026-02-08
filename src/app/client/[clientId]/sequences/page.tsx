import { supabase } from "@/lib/supabase";
import Link from "next/link";
import {
    Zap,
    Plus,
    ToggleLeft,
    ToggleRight,
    GitBranch,
    Users,
    CheckCircle2,
    ListOrdered,
} from "lucide-react";
import { CreateSequenceDialog } from "@/components/sequences/create-sequence-dialog";

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

async function getSequencesData(clientId: string) {
    const { data, error } = await supabase
        .from("sequences")
        .select(`
            *,
            sequence_steps(id),
            sequence_enrollments(id, status)
        `)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("getSequencesData error:", error);
        return [];
    }

    return (data || []).map((seq: any) => ({
        ...seq,
        step_count: seq.sequence_steps?.length || 0,
        enrolled_count: seq.sequence_enrollments?.filter(
            (e: any) => e.status === "active" || e.status === "paused"
        ).length || 0,
        completed_count: seq.sequence_enrollments?.filter(
            (e: any) => e.status === "completed" || e.status === "booked"
        ).length || 0,
        total_enrolled: seq.sequence_enrollments?.length || 0,
        sequence_steps: undefined,
        sequence_enrollments: undefined,
    }));
}

export default async function SequencesPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const sequences = await getSequencesData(clientId);

    const totalSequences = sequences.length;
    const activeSequences = sequences.filter((s: any) => s.is_active).length;
    const totalEnrolled = sequences.reduce(
        (sum: number, s: any) => sum + s.enrolled_count,
        0
    );
    const totalCompleted = sequences.reduce(
        (sum: number, s: any) => sum + s.completed_count,
        0
    );

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Zap className="w-6 h-6 text-violet-600" />
                        Sequences
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">
                        Automated multi-step outreach workflows
                    </p>
                </div>
                <CreateSequenceDialog clientId={clientId} />
            </div>

            {/* Summary Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border shadow-sm p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-violet-100 rounded-lg">
                            <ListOrdered className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Sequences</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {totalSequences}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-green-100 rounded-lg">
                            <ToggleRight className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Active Sequences</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {activeSequences}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-blue-100 rounded-lg">
                            <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Enrolled</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {totalEnrolled}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-100 rounded-lg">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total Completed</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {totalCompleted}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sequence Cards Grid */}
            {sequences.length === 0 ? (
                <div className="bg-white rounded-xl border shadow-sm p-12 text-center">
                    <GitBranch className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                        No sequences yet
                    </h3>
                    <p className="text-gray-500 text-sm mb-4">
                        Create your first sequence to start automating outreach workflows.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {sequences.map((sequence: any) => (
                        <Link
                            key={sequence.id}
                            href={`/client/${clientId}/sequences/${sequence.id}`}
                            className="bg-white rounded-xl border shadow-sm p-5 hover:shadow-md hover:border-violet-200 transition-all group"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-gray-900 group-hover:text-violet-700 transition-colors truncate">
                                        {sequence.name}
                                    </h3>
                                    {sequence.description && (
                                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                                            {sequence.description}
                                        </p>
                                    )}
                                </div>
                                <div className="ml-3 flex-shrink-0">
                                    {sequence.is_active ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                            Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                            Inactive
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mb-3">
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
                            </div>

                            <div className="flex items-center justify-between text-sm text-gray-500 pt-3 border-t border-gray-100">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <ListOrdered className="w-3.5 h-3.5" />
                                        {sequence.step_count} step{sequence.step_count !== 1 ? "s" : ""}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Users className="w-3.5 h-3.5" />
                                        {sequence.enrolled_count} enrolled
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {sequence.completed_count}
                                    </span>
                                </div>
                                <span className="text-xs text-gray-400">
                                    {new Date(sequence.created_at).toLocaleDateString()}
                                </span>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
