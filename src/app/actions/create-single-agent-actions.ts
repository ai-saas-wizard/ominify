"use server";

import { supabase } from "@/lib/supabase";
import { createAssistant } from "@/lib/vapi";
import { getClientVapiKey } from "@/lib/client-secrets";
import {
    buildInboundPrompt,
    buildOutboundPrompt,
    TenantProfileData,
} from "@/lib/prompt-templates";
import { buildAgentBlueprint } from "@/lib/agent-blueprint";
import { buildCalendarTools } from "@/lib/calendar-tools";
import { getVertical } from "@/lib/verticals/registry";
import { buildREInboundPrompt } from "@/lib/verticals/real-estate-investor/prompts";
import { buildREInboundTools } from "@/lib/verticals/real-estate-investor/tools";
import {
    RE_STRUCTURED_DATA_SCHEMA,
    RE_STRUCTURED_DATA_PROMPT,
} from "@/lib/verticals/real-estate-investor/sheets-schema";
import type { REInvestorFormData } from "@/lib/verticals/types";
import { revalidatePath } from "next/cache";

// ═══════════════════════════════════════════════════════════
// SINGLE-AGENT CREATION
// Used by the "New Agent" flow — adds one additional agent to a
// client that has already onboarded. Does NOT touch tenant_profiles
// or onboarding_completed.
// ═══════════════════════════════════════════════════════════

const TEMPLATE_VERSION = "v1-adhoc";

export type CreateSingleAgentInput =
    | {
          kind: "generic";
          agentType: "inbound" | "outbound";
          agentName: string;
      }
    | {
          kind: "vertical_re";
          agentName: string;
          formData: REInvestorFormData;
      };

export interface CreateSingleAgentResult {
    success: boolean;
    agentId?: string;
    vapiId?: string;
    error?: string;
}

function getAppUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000")
    );
}

export async function createSingleAgent(
    clientId: string,
    input: CreateSingleAgentInput
): Promise<CreateSingleAgentResult> {
    const { data: client } = await supabase
        .from("clients")
        .select("id, name")
        .eq("id", clientId)
        .single();

    if (!client) return { success: false, error: "Client not found" };

    const vapiKey = await getClientVapiKey(clientId);
    if (!vapiKey)
        return { success: false, error: "No VAPI API key available" };

    const appUrl = getAppUrl();

    if (input.kind === "generic") {
        return createGenericAgent(clientId, client.name, input, vapiKey, appUrl);
    }

    return createREAgent(clientId, input, vapiKey, appUrl);
}

// ─── GENERIC PATH ───

async function createGenericAgent(
    clientId: string,
    clientName: string,
    input: Extract<CreateSingleAgentInput, { kind: "generic" }>,
    vapiKey: string,
    appUrl: string
): Promise<CreateSingleAgentResult> {
    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (!profile)
        return {
            success: false,
            error: "Tenant profile not found. Complete onboarding before adding new agents.",
        };

    const profileData = profile as unknown as TenantProfileData;
    const calendarTools = buildCalendarTools(appUrl);
    const { agentType, agentName } = input;

    try {
        const prompt =
            agentType === "inbound"
                ? await buildInboundPrompt(clientName, profileData)
                : await buildOutboundPrompt(clientName, profileData);

        const transferTool =
            agentType === "inbound" && profileData.emergency_phone
                ? [
                      {
                          type: "transferCall" as const,
                          destinations: [
                              {
                                  type: "number" as const,
                                  number: profileData.emergency_phone,
                                  message: "Connecting you now.",
                              },
                          ],
                      },
                  ]
                : [];

        const assistant = await createAssistant(
            {
                name: agentName,
                firstMessage: prompt.firstMessage,
                model: {
                    provider: "openai",
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: prompt.systemPrompt }],
                    tools: [
                        ...calendarTools,
                        { type: "endCall" },
                        ...transferTool,
                    ],
                    temperature: 0.7,
                },
                voice: { provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL" },
                transcriber: {
                    provider: "deepgram",
                    language: "en",
                    model: "nova-2",
                },
                server: { url: `${appUrl}/api/webhooks/vapi` },
                serverMessages: ["status-update", "end-of-call-report"],
                clientMessages: [],
                maxDurationSeconds: agentType === "inbound" ? 600 : 300,
                backgroundSound: "office",
                ...(agentType === "inbound"
                    ? {
                          endCallMessage:
                              "Thank you for calling. Have a great day!",
                          voicemailMessage: `You've reached ${clientName}. Please leave a message and we will get back to you as soon as possible.`,
                      }
                    : {
                          voicemailDetection: {
                              provider: "twilio",
                              enabled: true,
                              voicemailDetectionTypes: [
                                  "machine_end_beep",
                                  "machine_end_silence",
                              ],
                          },
                      }),
                metadata: {
                    clientId,
                    agentType,
                    templateVersion: TEMPLATE_VERSION,
                },
            },
            vapiKey
        );

        if (!assistant) {
            return { success: false, error: "VAPI assistant creation failed" };
        }

        const blueprint = buildAgentBlueprint({
            systemPrompt: prompt.systemPrompt,
            firstMessage: prompt.firstMessage,
            model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7 },
            voice: {
                provider: "11labs",
                voiceId: "EXAVITQu4vr4xnSDxMaL",
                voiceName: "Sarah",
            },
            transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
            tools: [...calendarTools, { type: "endCall" }],
            settings: {
                maxDurationSeconds: agentType === "inbound" ? 600 : 300,
                backgroundSound: "office",
                ...(agentType === "inbound"
                    ? {
                          endCallMessage:
                              "Thank you for calling. Have a great day!",
                          voicemailMessage: `You've reached ${clientName}. Please leave a message and we will get back to you as soon as possible.`,
                      }
                    : {
                          voicemailDetection: {
                              provider: "twilio",
                              enabled: true,
                              voicemailDetectionTypes: [
                                  "machine_end_beep",
                                  "machine_end_silence",
                              ],
                          },
                      }),
                serverUrl: `${appUrl}/api/webhooks/vapi`,
            },
        });

        const { data: agent, error: insertError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: assistant.id,
                name: agentName,
                agent_type: agentType,
                auto_created: false,
                template_version: TEMPLATE_VERSION,
                agent_blueprint: blueprint,
            })
            .select("id")
            .single();

        if (insertError) {
            console.error(
                "[CREATE SINGLE AGENT] DB insert failed:",
                insertError
            );
            return {
                success: false,
                error: `Agent created on VAPI but DB save failed: ${insertError.message}`,
                vapiId: assistant.id,
            };
        }

        revalidatePath(`/client/${clientId}/agents`);
        return {
            success: true,
            agentId: agent?.id,
            vapiId: assistant.id,
        };
    } catch (error: any) {
        console.error("[CREATE SINGLE AGENT] Generic error:", error);
        return {
            success: false,
            error: error.message || "Unexpected error creating agent",
        };
    }
}

// ─── REAL ESTATE VERTICAL PATH ───

async function createREAgent(
    clientId: string,
    input: Extract<CreateSingleAgentInput, { kind: "vertical_re" }>,
    vapiKey: string,
    appUrl: string
): Promise<CreateSingleAgentResult> {
    const vertical = getVertical("real_estate_investor");
    if (!vertical)
        return { success: false, error: "Vertical definition not found" };

    const agentDef = vertical.agents[0];
    const { formData, agentName } = input;

    try {
        const { systemPrompt, firstMessage } = buildREInboundPrompt(formData);
        const tools = buildREInboundTools(clientId, appUrl, formData);

        const assistant = await createAssistant(
            {
                name: agentName,
                firstMessage,
                model: {
                    provider: "openai",
                    model: agentDef.llmModel,
                    messages: [{ role: "system", content: systemPrompt }],
                    tools: [...tools, { type: "endCall" }],
                    temperature: agentDef.llmTemperature,
                    maxTokens: agentDef.llmMaxTokens,
                },
                voice: {
                    provider: agentDef.voiceProvider,
                    voiceId: agentDef.voiceId,
                    model: agentDef.voiceModel,
                    speed: agentDef.voiceConfig.speed,
                    stability: agentDef.voiceConfig.stability,
                    similarityBoost: agentDef.voiceConfig.similarityBoost,
                    style: agentDef.voiceConfig.style,
                    useSpeakerBoost: agentDef.voiceConfig.useSpeakerBoost,
                },
                transcriber: {
                    provider: "deepgram",
                    language: "en",
                    model: agentDef.transcriberModel,
                    numerals: true,
                },
                server: {
                    url: `${appUrl}/api/webhooks/vapi`,
                    timeoutSeconds: 20,
                },
                serverMessages: ["status-update", "end-of-call-report"],
                clientMessages: [],
                recordingEnabled: true,
                endCallFunctionEnabled: true,
                dialKeypadFunctionEnabled: true,
                firstMessageMode: agentDef.firstMessageMode,
                maxDurationSeconds: agentDef.maxDurationSeconds,
                endCallPhrases: agentDef.endCallPhrases,
                startSpeakingPlan: agentDef.startSpeakingPlan,
                stopSpeakingPlan: agentDef.stopSpeakingPlan,
                messagePlan: { idleMessages: ["Are you still there?"] },
                metadata: {
                    clientId,
                    agentType: "inbound",
                    agentCategory: "inbound",
                    templateVersion: "vertical-re-v1-adhoc",
                },
                analysisPlan: {
                    structuredDataSchema: RE_STRUCTURED_DATA_SCHEMA,
                    structuredDataPrompt: RE_STRUCTURED_DATA_PROMPT,
                    minMessagesThreshold: 5,
                },
            },
            vapiKey
        );

        if (!assistant) {
            return { success: false, error: "VAPI assistant creation failed" };
        }

        const { data: agent, error: insertError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: assistant.id,
                name: agentName,
                agent_type: "inbound",
                agent_type_id: agentDef.id,
                agent_config: {
                    voice_id: agentDef.voiceId,
                    voice_name: "Sam (RE)",
                    vertical: "real_estate_investor",
                    persona_name: formData.agentPersonaName,
                    markets: formData.markets,
                    deal_types: formData.dealTypes,
                    appointment_type: formData.appointmentType,
                    transfer_phone: formData.transferPhone,
                    business_phone: formData.businessPhone,
                },
                auto_created: false,
                template_version: "vertical-re-v1-adhoc",
            })
            .select("id")
            .single();

        if (insertError) {
            console.error(
                "[CREATE SINGLE AGENT] DB insert failed:",
                insertError
            );
            return {
                success: false,
                error: `Agent created on VAPI but DB save failed: ${insertError.message}`,
                vapiId: assistant.id,
            };
        }

        revalidatePath(`/client/${clientId}/agents`);
        return {
            success: true,
            agentId: agent?.id,
            vapiId: assistant.id,
        };
    } catch (error: any) {
        console.error("[CREATE SINGLE AGENT] RE error:", error);
        return {
            success: false,
            error: error.message || "Unexpected error creating agent",
        };
    }
}
