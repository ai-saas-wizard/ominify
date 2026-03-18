import { ensurePipelineStages, getPipelineData } from "@/app/actions/pipeline-actions";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export default async function PipelinePage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;

    // Seed default stages if first visit
    await ensurePipelineStages(clientId);

    // Fetch all pipeline data
    const { stages, contacts } = await getPipelineData(clientId);

    return <PipelineBoard clientId={clientId} initialStages={stages} initialContacts={contacts} />;
}
