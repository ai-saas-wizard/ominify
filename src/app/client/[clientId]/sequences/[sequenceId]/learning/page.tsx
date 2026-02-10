import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Brain, FlaskConical } from "lucide-react";
import { ConversionFunnel } from "@/components/analytics/conversion-funnel";
import { StepAttributionChart } from "@/components/analytics/step-attribution-chart";
import { OptimizationFeed } from "@/components/analytics/optimization-feed";
import { IndustryBenchmarks } from "@/components/analytics/industry-benchmarks";
import { LearningABTests } from "./learning-ab-tests";

async function getSequenceBasic(sequenceId: string) {
    const { data, error } = await supabase
        .from("sequences")
        .select("id, name, client_id, sequence_steps(id, step_order, channel, content)")
        .eq("id", sequenceId)
        .single();

    if (error || !data) return null;

    if (data.sequence_steps) {
        (data.sequence_steps as any[]).sort(
            (a: any, b: any) => a.step_order - b.step_order
        );
    }

    return data;
}

export default async function LearningDashboardPage({
    params,
}: {
    params: Promise<{ clientId: string; sequenceId: string }>;
}) {
    const { clientId, sequenceId } = await params;
    const sequence = await getSequenceBasic(sequenceId);

    if (!sequence) {
        notFound();
    }

    const steps = (sequence.sequence_steps || []) as Array<{
        id: string;
        step_order: number;
        channel: string;
        content: any;
    }>;

    return (
        <div className="p-4 lg:p-8 max-w-[1600px] mx-auto space-y-6">
            {/* Navigation */}
            <div className="flex items-center gap-4">
                <Link
                    href={`/client/${clientId}/sequences/${sequenceId}`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sequence
                </Link>
            </div>

            {/* Header */}
            <div className="bg-white rounded-xl border shadow-sm p-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600">
                        <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">
                            Learning Dashboard
                        </h1>
                        <p className="text-sm text-gray-500">
                            {sequence.name} &mdash; Attribution, A/B testing, and AI optimization
                        </p>
                    </div>
                </div>
            </div>

            {/* Top Row: Funnel + Attribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ConversionFunnel sequenceId={sequenceId} />
                <StepAttributionChart sequenceId={sequenceId} />
            </div>

            {/* Middle Row: Optimization Feed + Industry Benchmarks */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <OptimizationFeed sequenceId={sequenceId} />
                <IndustryBenchmarks sequenceId={sequenceId} clientId={clientId} />
            </div>

            {/* A/B Testing Section */}
            <div>
                <div className="flex items-center gap-2 mb-4">
                    <FlaskConical className="w-4 h-4 text-purple-500" />
                    <h2 className="text-sm font-semibold text-gray-900">A/B Tests by Step</h2>
                </div>
                <LearningABTests steps={steps} sequenceId={sequenceId} clientId={clientId} />
            </div>
        </div>
    );
}
