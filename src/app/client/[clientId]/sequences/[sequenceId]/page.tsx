import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { SequenceFlowCanvas } from "@/components/sequences/flow/sequence-flow-canvas";

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
        <div className="h-screen w-full">
            <SequenceFlowCanvas
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
