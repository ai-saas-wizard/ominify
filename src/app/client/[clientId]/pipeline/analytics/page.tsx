import { getPipelines } from "@/app/actions/pipeline-actions";
import { getPipelineAnalytics } from "@/app/actions/pipeline-analytics-actions";
import { PipelineAnalytics } from "@/components/pipeline/pipeline-analytics";

export default async function PipelineAnalyticsPage({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ pipeline?: string }>;
}) {
    const { clientId } = await params;
    const { pipeline: pipelineParam } = await searchParams;

    const { pipelines } = await getPipelines(clientId);

    const activePipeline =
        (pipelineParam && pipelines.find((p) => p.id === pipelineParam)) ||
        pipelines.find((p) => p.is_default) ||
        pipelines[0];

    if (!activePipeline) {
        return (
            <div className="h-full flex items-center justify-center text-gray-500">
                No pipelines found
            </div>
        );
    }

    const result = await getPipelineAnalytics(activePipeline.id);
    const data = result.data ?? { stages: [], funnel: [], durations: [], velocity: [], sources: [], totalContacts: 0 };

    return (
        <PipelineAnalytics
            clientId={clientId}
            pipelineId={activePipeline.id}
            pipelineName={activePipeline.name}
            pipelineColor={activePipeline.color}
            data={data as any}
        />
    );
}
