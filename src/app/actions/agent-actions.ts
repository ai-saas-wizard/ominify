"use server";

import { updateAgent, getAgent, VapiAgent } from "@/lib/vapi";
import { revalidatePath } from "next/cache";
import { getClientVapiKey } from "@/lib/client-secrets";

export async function updateAgentAction(agentId: string, clientId: string, formData: FormData) {
    const name = formData.get("name") as string;
    const systemPrompt = formData.get("systemPrompt") as string;
    const modelId = formData.get("model") as string;
    const voiceId = formData.get("voiceId") as string;

    // 1. Resolve the client's VAPI key (decrypted)
    const vapiKey = clientId ? await getClientVapiKey(clientId) : null;
    if (!vapiKey) {
        return { success: false, error: "No VAPI API key found for this client" };
    }

    // 2. Fetch current agent to preserve other fields
    const currentAgent = await getAgent(agentId, vapiKey);
    if (!currentAgent) {
        return { success: false, error: "Agent not found" };
    }

    const payload: any = {};

    // Update Name
    if (name) payload.name = name;

    // Update Model Configuration
    if (modelId || systemPrompt) {
        const existingModel = currentAgent.model || { provider: 'openai', model: 'gpt-3.5-turbo' };
        const newModel: any = { ...existingModel };

        // Update model ID if provided
        if (modelId) newModel.model = modelId;

        // Update system prompt — handle both VAPI formats
        if (systemPrompt) {
            // Remove messages array and use systemPrompt field directly
            delete newModel.messages;
            newModel.systemPrompt = systemPrompt;
        }

        payload.model = newModel;
    }

    // Update Voice
    if (voiceId) {
        payload.voice = {
            provider: "11labs",
            voiceId: voiceId,
        };
    }

    const result = await updateAgent(agentId, payload, vapiKey);

    if (result) {
        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}/agents/${agentId}`);
        return { success: true };
    } else {
        return { success: false, error: "Failed to update agent" };
    }
}
