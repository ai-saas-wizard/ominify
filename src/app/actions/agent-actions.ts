"use server";

import { updateAgent, getAgent, VapiAgent } from "@/lib/vapi";
import { revalidatePath } from "next/cache";
import { getClientVapiKey } from "@/lib/client-secrets";
import { supabase } from "@/lib/supabase";

export async function updateAgentAction(agentId: string, clientId: string, formData: FormData) {
    const name = formData.get("name") as string;
    const systemPrompt = formData.get("systemPrompt") as string;
    const modelId = formData.get("model") as string;
    const voiceId = formData.get("voiceId") as string;

    // The SMS prompt, first message + shared context live in our DB
    // (agent_config), NOT on VAPI. shared_context is the offer/context the
    // sequencer feeds into every generated SMS. Persist them separately when the
    // SMS tab submitted them. agentId here is the VAPI assistant id → match the
    // row by vapi_id.
    if (
        formData.has("smsPrompt") ||
        formData.has("smsFirstMessage") ||
        formData.has("sharedContext")
    ) {
        const { data: row } = await supabase
            .from("agents")
            .select("agent_config")
            .eq("vapi_id", agentId)
            .eq("client_id", clientId)
            .single();
        if (row) {
            const merged = { ...(row.agent_config || {}) } as Record<string, any>;
            if (formData.has("smsPrompt"))
                merged.sms_prompt = (formData.get("smsPrompt") as string) || "";
            if (formData.has("smsFirstMessage"))
                merged.sms_first_message =
                    (formData.get("smsFirstMessage") as string) || "";
            if (formData.has("sharedContext"))
                merged.shared_context =
                    (formData.get("sharedContext") as string) || "";
            await supabase
                .from("agents")
                .update({ agent_config: merged })
                .eq("vapi_id", agentId)
                .eq("client_id", clientId);
        }
        // SMS-only save: no VAPI fields present → return after the DB write.
        if (!name && !systemPrompt && !modelId && !voiceId) {
            revalidatePath(`/client/${clientId}/agents/${agentId}`);
            return { success: true };
        }
    }

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
        // Keep agent_config.voice_prompt (read by the sequencer for voice
        // context) in sync with the system prompt just written to VAPI —
        // otherwise it goes permanently stale after Role & Prompt edits.
        if (systemPrompt) {
            const { data: row } = await supabase
                .from("agents")
                .select("agent_config")
                .eq("vapi_id", agentId)
                .eq("client_id", clientId)
                .single();
            if (row) {
                await supabase
                    .from("agents")
                    .update({
                        agent_config: {
                            ...(row.agent_config || {}),
                            voice_prompt: systemPrompt,
                        },
                    })
                    .eq("vapi_id", agentId)
                    .eq("client_id", clientId);
            }
        }

        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}/agents/${agentId}`);
        return { success: true };
    } else {
        return { success: false, error: "Failed to update agent" };
    }
}
