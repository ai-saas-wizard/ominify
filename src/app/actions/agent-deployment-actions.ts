"use server";

import { supabase } from "@/lib/supabase";
import { createAssistant } from "@/lib/vapi";
import { getAgentTypeDefinition } from "@/lib/agent-catalog";
import { buildAgentPrompt } from "@/lib/agent-prompt-builders";
import { createAgentSequence } from "./auto-sequence-actions";
import { saveTenantProfile } from "./tenant-profile-actions";
import type { TenantProfileData } from "@/lib/prompt-templates";
import type { SuggestedAgent } from "@/lib/agent-catalog";
import type { DeploymentResult } from "@/components/onboarding-v2/types";
import { revalidatePath } from "next/cache";

// ═══════════════════════════════════════════════════════════
// AGENT FLEET DEPLOYMENT
// Deploys all enabled agents in parallel:
// 1. Save tenant profile
// 2. For each agent: generate prompt → create VAPI assistant → save to DB → create sequence
// 3. Mark onboarding complete
// ═══════════════════════════════════════════════════════════

const TEMPLATE_VERSION = "v2";

export async function deployAgentFleet(
    clientId: string,
    enabledAgents: SuggestedAgent[],
    profileFormData: FormData
): Promise<DeploymentResult> {
    // 1. Save tenant profile
    const saveResult = await saveTenantProfile(clientId, profileFormData);
    if (!saveResult) {
        return { success: false, agents: [], error: "Failed to save profile" };
    }

    // 2. Fetch client and profile
    const { data: client } = await supabase
        .from("clients")
        .select("id, name, vapi_key, account_type")
        .eq("id", clientId)
        .single();

    if (!client?.vapi_key) {
        return { success: false, agents: [], error: "Client or VAPI key not found" };
    }

    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (!profile) {
        return { success: false, agents: [], error: "Tenant profile not found" };
    }

    const profileData = profile as unknown as TenantProfileData;
    const APP_URL =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    // 3. Deploy all agents in parallel
    const deploymentPromises = enabledAgents.map(async (suggestedAgent) => {
        const agentDef = getAgentTypeDefinition(suggestedAgent.type_id);

        try {
            // Generate system prompt
            const promptResult = await buildAgentPrompt(
                suggestedAgent.type_id,
                client.name,
                profileData,
                suggestedAgent.custom_instructions || undefined
            );

            // Build VAPI tools
            const tools = buildToolsForAgent(agentDef, clientId, APP_URL, profileData.emergency_phone);

            // Create VAPI assistant
            const vapiAssistant = await createAssistant(
                {
                    name: `${client.name} - ${suggestedAgent.name}`,
                    firstMessage: promptResult.firstMessage,
                    model: {
                        provider: "openai",
                        model: "gpt-4o-mini",
                        messages: [{ role: "system", content: promptResult.systemPrompt }],
                        tools: [...tools, { type: "endCall" }],
                        temperature: 0.7,
                    },
                    voice: {
                        provider: "11labs",
                        voiceId: suggestedAgent.voice_id,
                    },
                    transcriber: {
                        provider: "deepgram",
                        language: "en",
                        model: "nova-2",
                    },
                    server: {
                        url: `${APP_URL}/api/webhooks/vapi`,
                    },
                    maxDurationSeconds: agentDef?.default_max_duration_seconds || 300,
                    backgroundSound: agentDef?.background_sound || "office",
                    voicemailDetection: agentDef?.voicemail_detection
                        ? {
                              provider: "twilio",
                              enabled: true,
                              voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
                          }
                        : undefined,
                    metadata: {
                        clientId,
                        agentType: suggestedAgent.type_id,
                        agentCategory: suggestedAgent.category,
                        templateVersion: TEMPLATE_VERSION,
                    },
                },
                client.vapi_key
            );

            if (!vapiAssistant) {
                return {
                    type_id: suggestedAgent.type_id,
                    name: suggestedAgent.name,
                    agent_id: null,
                    vapi_id: null,
                    sequence_id: null,
                    error: "VAPI assistant creation failed",
                };
            }

            // Save to agents table
            const { data: agent } = await supabase
                .from("agents")
                .insert({
                    client_id: clientId,
                    vapi_id: vapiAssistant.id,
                    name: `${client.name} - ${suggestedAgent.name}`,
                    agent_type: suggestedAgent.category === "inbound" ? "inbound" : "outbound",
                    agent_type_id: suggestedAgent.type_id,
                    agent_config: {
                        override_variables: suggestedAgent.override_variables,
                        voice_id: suggestedAgent.voice_id,
                        voice_name: suggestedAgent.voice_name,
                        custom_instructions: suggestedAgent.custom_instructions,
                    },
                    auto_created: true,
                    template_version: TEMPLATE_VERSION,
                })
                .select("id")
                .single();

            // Create auto-sequence if applicable
            let sequenceId: string | null = null;
            if (agentDef?.sequence_template && agent) {
                const seqResult = await createAgentSequence(
                    clientId,
                    agent.id,
                    vapiAssistant.id,
                    suggestedAgent.type_id,
                    client.name,
                    profileData
                );
                sequenceId = seqResult.sequenceId || null;
            }

            return {
                type_id: suggestedAgent.type_id,
                name: suggestedAgent.name,
                agent_id: agent?.id || null,
                vapi_id: vapiAssistant.id,
                sequence_id: sequenceId,
                error: null,
            };
        } catch (error) {
            console.error(`[DEPLOYMENT] Error deploying ${suggestedAgent.type_id}:`, error);
            return {
                type_id: suggestedAgent.type_id,
                name: suggestedAgent.name,
                agent_id: null,
                vapi_id: null,
                sequence_id: null,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    });

    const results = await Promise.allSettled(deploymentPromises);
    const agents = results.map((r) =>
        r.status === "fulfilled"
            ? r.value
            : {
                  type_id: "unknown",
                  name: "Unknown",
                  agent_id: null,
                  vapi_id: null,
                  sequence_id: null,
                  error: r.reason?.message || "Deployment failed",
              }
    );

    // 4. Mark onboarding complete
    await supabase
        .from("tenant_profiles")
        .update({
            onboarding_completed: true,
            onboarding_completed_at: new Date().toISOString(),
            onboarding_version: "v2",
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    // Revalidate paths
    revalidatePath(`/client/${clientId}/onboarding`);
    revalidatePath(`/client/${clientId}/agents`);
    revalidatePath(`/client/${clientId}/sequences`);
    revalidatePath(`/client/${clientId}`);

    const successCount = agents.filter((a) => a.agent_id !== null).length;

    return {
        success: successCount > 0,
        agents,
        error: successCount === 0 ? "All agent deployments failed" : undefined,
    };
}

// ─── TOOL BUILDER ───

function buildToolsForAgent(
    agentDef: ReturnType<typeof getAgentTypeDefinition>,
    clientId: string,
    appUrl: string,
    emergencyPhone: string
): unknown[] {
    if (!agentDef) return [];

    const tools: unknown[] = [];

    if (agentDef.required_tools.includes("check_availability")) {
        tools.push({
            type: "function",
            function: {
                name: "check_availability",
                description: "Check available appointment slots.",
                parameters: {
                    type: "object",
                    properties: {
                        preferred_date: {
                            type: "string",
                            description: "Date in YYYY-MM-DD format",
                        },
                        service_type: {
                            type: "string",
                            description: "Type of service",
                        },
                    },
                },
            },
            server: {
                url: `${appUrl}/api/vapi/tools/calendar?clientId=${clientId}`,
            },
        });
    }

    if (agentDef.required_tools.includes("book_appointment")) {
        tools.push({
            type: "function",
            function: {
                name: "book_appointment",
                description: "Book a confirmed appointment slot.",
                parameters: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Date in YYYY-MM-DD format" },
                        time: { type: "string", description: "Time in HH:MM format" },
                        customer_name: { type: "string", description: "Customer name" },
                        customer_phone: { type: "string", description: "Customer phone" },
                        service_type: { type: "string", description: "Service type" },
                        notes: { type: "string", description: "Additional notes" },
                    },
                    required: ["date", "time", "customer_name", "customer_phone"],
                },
            },
            server: {
                url: `${appUrl}/api/vapi/tools/calendar?clientId=${clientId}`,
            },
        });
    }

    if (agentDef.required_tools.includes("transferCall") && emergencyPhone) {
        tools.push({
            type: "transferCall",
            destinations: [
                {
                    type: "number",
                    number: emergencyPhone,
                    message: "Connecting you now.",
                },
            ],
        });
    }

    return tools;
}
