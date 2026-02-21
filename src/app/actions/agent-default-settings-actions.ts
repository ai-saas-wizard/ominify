"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export interface AgentDefaultSettings {
    id: string;
    direction: "inbound" | "outbound";
    settings: Record<string, any>;
    updated_at: string;
}

// Hardcoded fallbacks from the JSON template files (excluding dynamic placeholder fields)
const INBOUND_FALLBACK: Record<string, any> = {
    voice: {
        model: "eleven_flash_v2_5",
        speed: 1.1,
        style: 0.2,
        provider: "11labs",
        stability: 0.4,
        similarityBoost: 0.6,
        useSpeakerBoost: false,
    },
    model: {
        model: "gpt-4o-mini",
        provider: "openai",
        maxTokens: 250,
        temperature: 0.65,
    },
    transcriber: { model: "nova-3", language: "en", numerals: true, provider: "deepgram" },
    recordingEnabled: true,
    endCallFunctionEnabled: true,
    endCallPhrases: ["goodbye", "talk to you soon"],
    dialKeypadFunctionEnabled: true,
    maxDurationSeconds: 3083,
    firstMessageMode: "assistant-speaks-first-with-model-generated-message",
    voicemailDetection: {
        provider: "vapi",
        backoffPlan: { maxRetries: 6, startAtSeconds: 5, frequencySeconds: 5 },
        beepMaxAwaitSeconds: 0,
    },
    messagePlan: { idleMessages: ["Are you still there?"] },
    stopSpeakingPlan: { numWords: 3 },
    server: { timeoutSeconds: 20 },
    clientMessages: [
        "transcript", "hang", "function-call", "speech-update",
        "metadata", "conversation-update", "status-update", "assistant.started",
    ],
    serverMessages: [
        "end-of-call-report", "status-update", "hang", "function-call",
        "conversation-update", "assistant.started", "transfer-update", "speech-update",
    ],
    compliancePlan: { hipaaEnabled: false, pciEnabled: false },
};

const OUTBOUND_FALLBACK: Record<string, any> = {
    voice: {
        model: "eleven_turbo_v2_5",
        speed: 1.1,
        provider: "11labs",
        stability: 0.2,
        similarityBoost: 0.75,
    },
    model: {
        model: "gpt-4o-mini",
        provider: "openai",
        temperature: 0.6,
    },
    transcriber: { model: "nova-2", language: "en", numerals: true, provider: "deepgram" },
    recordingEnabled: true,
    endCallFunctionEnabled: true,
    endCallPhrases: ["goodbye", "talk to you soon"],
    firstMessageMode: "assistant-waits-for-user",
    voicemailDetection: {
        provider: "vapi",
        backoffPlan: { maxRetries: 6, startAtSeconds: 5, frequencySeconds: 5 },
        beepMaxAwaitSeconds: 0,
    },
    messagePlan: { idleMessages: ["Are you still there?"] },
    startSpeakingPlan: {
        waitSeconds: 0.7,
        smartEndpointingPlan: {
            provider: "livekit",
        },
    },
    stopSpeakingPlan: { numWords: 3, backoffSeconds: 3 },
    server: { timeoutSeconds: 20 },
    clientMessages: [
        "transcript", "hang", "function-call", "speech-update",
        "metadata", "conversation-update", "status-update", "assistant.started",
    ],
    serverMessages: [
        "end-of-call-report", "status-update", "hang", "function-call",
        "conversation-update", "assistant.started", "transfer-update", "speech-update",
    ],
    compliancePlan: { hipaaEnabled: false, pciEnabled: false },
};

export async function getAgentDefaultSettings(
    direction: "inbound" | "outbound"
): Promise<AgentDefaultSettings | null> {
    const { data, error } = await supabase
        .from("agent_default_settings")
        .select("*")
        .eq("id", direction)
        .single();

    if (error || !data) {
        // Return fallback defaults
        const fallback = direction === "inbound" ? INBOUND_FALLBACK : OUTBOUND_FALLBACK;
        return { id: direction, direction, settings: fallback, updated_at: new Date().toISOString() };
    }
    return data as AgentDefaultSettings;
}

export async function getAllAgentDefaultSettings(): Promise<{
    inbound: AgentDefaultSettings | null;
    outbound: AgentDefaultSettings | null;
}> {
    const { data, error } = await supabase
        .from("agent_default_settings")
        .select("*");

    const inbound = data?.find((d: any) => d.id === "inbound") as AgentDefaultSettings | undefined;
    const outbound = data?.find((d: any) => d.id === "outbound") as AgentDefaultSettings | undefined;

    return {
        inbound: inbound || { id: "inbound", direction: "inbound", settings: INBOUND_FALLBACK, updated_at: new Date().toISOString() },
        outbound: outbound || { id: "outbound", direction: "outbound", settings: OUTBOUND_FALLBACK, updated_at: new Date().toISOString() },
    };
}

export async function updateAgentDefaultSettings(
    direction: "inbound" | "outbound",
    settings: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
        .from("agent_default_settings")
        .upsert(
            {
                id: direction,
                direction,
                settings,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
        );

    if (error) {
        console.error("[AGENT DEFAULTS] Failed to update:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/settings");
    return { success: true };
}
