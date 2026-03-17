import { supabase } from "@/lib/supabase";
import {
    SequencesListClient,
    type SequenceCardData,
} from "@/components/sequences/sequences-list-client";

async function getSequencesData(clientId: string): Promise<SequenceCardData[]> {
    const { data, error } = await supabase
        .from("sequences")
        .select(`
            *,
            sequence_steps(id, channel, enable_ai_mutation),
            sequence_enrollments(id, status)
        `)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("getSequencesData error:", error);
        return [];
    }

    return (data || []).map((seq: any) => {
        const steps = seq.sequence_steps || [];
        const enrollments = seq.sequence_enrollments || [];

        return {
            id: seq.id,
            name: seq.name,
            description: seq.description,
            trigger_type: seq.trigger_type,
            urgency_tier: seq.urgency_tier,
            is_active: seq.is_active,
            generation_mode: seq.generation_mode || null,
            created_at: seq.created_at,
            updated_at: seq.updated_at || null,
            step_count: steps.length,
            channels: steps.map((s: any) => s.channel).filter(Boolean),
            ai_mutation_steps: steps.filter((s: any) => s.enable_ai_mutation).length,
            enrolled_count: enrollments.filter(
                (e: any) => e.status === "active" || e.status === "paused"
            ).length,
            completed_count: enrollments.filter(
                (e: any) => e.status === "completed" || e.status === "booked"
            ).length,
            replied_count: enrollments.filter((e: any) => e.status === "replied").length,
            booked_count: enrollments.filter((e: any) => e.status === "booked").length,
            failed_count: enrollments.filter((e: any) => e.status === "failed").length,
            total_enrolled: enrollments.length,
        };
    });
}

export default async function SequencesPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const sequences = await getSequencesData(clientId);

    return <SequencesListClient clientId={clientId} sequences={sequences} />;
}
