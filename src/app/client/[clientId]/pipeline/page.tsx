import { ensureDefaultPipeline, getPipelines, getPipelineData } from "@/app/actions/pipeline-actions";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export default async function PipelinePage({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ pipeline?: string }>;
}) {
    const { clientId } = await params;
    const { pipeline: pipelineParam } = await searchParams;

    // Ensure at least one pipeline exists
    await ensureDefaultPipeline(clientId);

    // Fetch all pipelines
    const { pipelines } = await getPipelines(clientId);

    if (pipelines.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-gray-500">
                Failed to load pipelines
            </div>
        );
    }

    // Determine active pipeline: from URL param or default
    const activePipeline =
        (pipelineParam && pipelines.find((p) => p.id === pipelineParam)) ||
        pipelines.find((p) => p.is_default) ||
        pipelines[0];

    // Fetch pipeline data
    const { stages, contacts } = await getPipelineData(clientId, activePipeline.id);

    return (
        <PipelineBoard
            clientId={clientId}
            pipelineId={activePipeline.id}
            currentPipeline={activePipeline}
            pipelines={pipelines}
            initialStages={stages}
            initialContacts={contacts}
        />
    );
}
