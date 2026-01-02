"use server";

import { updateAgent, getAgent, VapiAgent } from "@/lib/vapi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function updateAgentAction(id: string, formData: FormData) {
    const name = formData.get("name") as string;
    const systemPrompt = formData.get("systemPrompt") as string;
    const modelId = formData.get("model") as string;

    // 1. Fetch current agent to preserve other fields
    const currentAgent = await getAgent(id);
    if (!currentAgent) {
        return { success: false, error: "Agent not found" };
    }

    const payload: any = {};

    // Update Name
    if (name) payload.name = name;

    // Update Model Configuration
    if (modelId || systemPrompt) {
        // Clone existing model or default
        const existingModel = currentAgent.model || { provider: 'openai', model: 'gpt-3.5-turbo' };

        payload.model = {
            ...existingModel,
            model: modelId || existingModel.model,
            // Update messages to set system prompt
            messages: [
                {
                    role: 'system',
                    content: systemPrompt || (
                        Array.isArray(existingModel.messages)
                            ? existingModel.messages.find((m: any) => m.role === 'system')?.content
                            : ""
                    )
                }
            ]
        };
    }

    const result = await updateAgent(id, payload);

    if (result) {
        revalidatePath("/dashboard/agents");
        revalidatePath(`/dashboard/agents/${id}`);
        return { success: true };
    } else {
        return { success: false, error: "Failed to update agent" };
    }
}
