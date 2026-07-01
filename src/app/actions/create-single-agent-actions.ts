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
import {
    buildREInboundTools,
    buildREOutboundTools,
} from "@/lib/verticals/real-estate-investor/tools";
import {
    RE_STRUCTURED_DATA_SCHEMA,
    RE_STRUCTURED_DATA_PROMPT,
} from "@/lib/verticals/real-estate-investor/sheets-schema";
import { buildRESmsStarter } from "@/lib/verticals/real-estate-investor/sms-prompt-templates";
import { buildSaaSOutboundTools } from "@/lib/verticals/saas/tools";
import {
    SAAS_STRUCTURED_OUTPUT_SCHEMA,
    SAAS_STRUCTURED_OUTPUT_PROMPT,
} from "@/lib/verticals/saas/structured-output";
import { buildSaaSSmsStarter } from "@/lib/verticals/saas/sms-prompt-templates";
import { getCalendarToolIdsForClient } from "@/app/actions/umbrella-tools-actions";
import { getREStructuredOutputIdForClient } from "@/app/actions/umbrella-structured-outputs-actions";
import { getAppUrl } from "@/lib/app-url";
import { formatVapiError } from "@/lib/vapi-errors";
import type { REInvestorFormData, SaaSFormData } from "@/lib/verticals/types";
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
      }
    | {
          kind: "vertical_re_outbound";
          agentName: string;
          formData: REInvestorFormData;
      }
    | {
          kind: "vertical_saas_outbound";
          agentName: string;
          formData: SaaSFormData;
      };

export interface CreateSingleAgentResult {
    success: boolean;
    agentId?: string;
    vapiId?: string;
    error?: string;
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

    if (input.kind === "vertical_re_outbound") {
        return createREOutboundAgent(clientId, input, vapiKey, appUrl);
    }

    if (input.kind === "vertical_saas_outbound") {
        return createSaaSOutboundAgent(clientId, input, vapiKey, appUrl);
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

        const { data: assistant, error: vapiErr } = await createAssistant(
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
            console.error("[CREATE SINGLE AGENT] VAPI rejected generic assistant:", {
                status: vapiErr?.status,
                body: vapiErr?.body,
            });
            return { success: false, error: formatVapiError(vapiErr) };
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
        const calendarToolIds = await getCalendarToolIdsForClient(clientId);
        const reStructuredOutputId =
            await getREStructuredOutputIdForClient(clientId);
        const tools = buildREInboundTools(clientId, appUrl, formData, {
            calendarToolIds: calendarToolIds ?? undefined,
        });
        const toolIdRefs = calendarToolIds
            ? Object.values(calendarToolIds).filter(
                  (v): v is string => !!v
              )
            : [];

        const { data: assistant, error: vapiErr } = await createAssistant(
            {
                name: agentName,
                firstMessage,
                model: {
                    provider: "openai",
                    model: agentDef.llmModel,
                    messages: [{ role: "system", content: systemPrompt }],
                    tools: [...tools, { type: "endCall" }],
                    ...(toolIdRefs.length > 0 ? { toolIds: toolIdRefs } : {}),
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
                // UMBRELLA: attach the global per-umbrella RE structured output.
                // CUSTOM (or umbrella bootstrap not yet run): fall back to the
                // inline analysisPlan so extraction still happens.
                ...(reStructuredOutputId
                    ? {
                          artifactPlan: {
                              structuredOutputIds: [reStructuredOutputId],
                          },
                      }
                    : {
                          analysisPlan: {
                              structuredDataSchema: RE_STRUCTURED_DATA_SCHEMA,
                              structuredDataPrompt: RE_STRUCTURED_DATA_PROMPT,
                              minMessagesThreshold: 5,
                          },
                      }),
            },
            vapiKey
        );

        if (!assistant) {
            console.error("[CREATE SINGLE AGENT] VAPI rejected RE inbound assistant:", {
                status: vapiErr?.status,
                body: vapiErr?.body,
            });
            return { success: false, error: formatVapiError(vapiErr) };
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
                    transfer: {
                        first_name: formData.inboundTransfer.firstName,
                        role: formData.inboundTransfer.role,
                        phone: formData.inboundTransfer.phone,
                        mode: formData.inboundTransfer.mode,
                    },
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

// ─── REAL ESTATE OUTBOUND PATH ───

async function createREOutboundAgent(
    clientId: string,
    input: Extract<CreateSingleAgentInput, { kind: "vertical_re_outbound" }>,
    vapiKey: string,
    appUrl: string
): Promise<CreateSingleAgentResult> {
    const vertical = getVertical("real_estate_investor");
    if (!vertical)
        return { success: false, error: "Vertical definition not found" };

    const agentDef = vertical.agents.find(
        (a) => a.id === "re_outbound_follow_up"
    );
    if (!agentDef)
        return { success: false, error: "Outbound agent definition not found" };

    const { formData, agentName } = input;

    if (!formData.outboundPrompt || !formData.outboundFirstMessage) {
        return {
            success: false,
            error: "Outbound prompt or first message is empty",
        };
    }

    try {
        const calendarToolIds = await getCalendarToolIdsForClient(clientId);
        const reStructuredOutputId =
            await getREStructuredOutputIdForClient(clientId);
        const tools = buildREOutboundTools(clientId, appUrl, formData, {
            calendarToolIds: calendarToolIds ?? undefined,
        });
        const toolIdRefs = calendarToolIds
            ? Object.values(calendarToolIds).filter(
                  (v): v is string => !!v
              )
            : [];

        const { data: assistant, error: vapiErr } = await createAssistant(
            {
                name: agentName,
                firstMessage: formData.outboundFirstMessage,
                model: {
                    provider: "openai",
                    model: agentDef.llmModel,
                    messages: [
                        { role: "system", content: formData.outboundPrompt },
                    ],
                    tools: [...tools, { type: "endCall" }],
                    ...(toolIdRefs.length > 0 ? { toolIds: toolIdRefs } : {}),
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
                voicemailDetection: {
                    provider: "twilio",
                    enabled: true,
                    voicemailDetectionTypes: [
                        "machine_end_beep",
                        "machine_end_silence",
                    ],
                },
                metadata: {
                    clientId,
                    agentType: "outbound",
                    agentCategory: agentDef.category,
                    templateVersion: "vertical-re-outbound-v1-adhoc",
                },
                ...(reStructuredOutputId
                    ? {
                          artifactPlan: {
                              structuredOutputIds: [reStructuredOutputId],
                          },
                      }
                    : {
                          analysisPlan: {
                              structuredDataSchema: RE_STRUCTURED_DATA_SCHEMA,
                              structuredDataPrompt: RE_STRUCTURED_DATA_PROMPT,
                              minMessagesThreshold: 5,
                          },
                      }),
            },
            vapiKey
        );

        if (!assistant) {
            console.error("[CREATE SINGLE AGENT] VAPI rejected RE outbound assistant:", {
                status: vapiErr?.status,
                body: vapiErr?.body,
            });
            return { success: false, error: formatVapiError(vapiErr) };
        }

        const { data: agent, error: insertError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: assistant.id,
                name: agentName,
                agent_type: "outbound",
                agent_type_id: agentDef.id,
                agent_config: {
                    voice_id: agentDef.voiceId,
                    voice_name: "Sam (RE)",
                    vertical: "real_estate_investor",
                    persona_name: formData.agentPersonaName,
                    markets: formData.markets,
                    deal_types: formData.dealTypes,
                    appointment_type: formData.appointmentType,
                    transfer: {
                        first_name: formData.outboundTransfer.firstName,
                        role: formData.outboundTransfer.role,
                        phone: formData.outboundTransfer.phone,
                        mode: formData.outboundTransfer.mode,
                    },
                    business_phone: formData.businessPhone,
                    outbound_goal: formData.outboundGoal,
                    outbound_scenario: formData.outboundScenario || null,
                    // Dual-channel messaging assets. The sequencer reads these
                    // (via getAgentMessaging) to adapt persona per channel for
                    // any sequence bound to this agent; without them every SMS
                    // path falls back to a generic AI persona. Mirrors
                    // deployVerticalAgents — reuses buildRESmsStarter, so the
                    // SMS prompt is built from the same context as voice unless
                    // the operator edited it on the SMS-config phase.
                    voice_prompt: formData.outboundPrompt,
                    voice_first_message: formData.outboundFirstMessage,
                    ...(() => {
                        const sms =
                            formData.smsPrompt && formData.smsFirstMessage
                                ? {
                                      smsPrompt: formData.smsPrompt,
                                      smsFirstMessage: formData.smsFirstMessage,
                                  }
                                : buildRESmsStarter(
                                      formData.outboundGoal,
                                      formData
                                  );
                        return {
                            sms_prompt: sms.smsPrompt,
                            sms_first_message: sms.smsFirstMessage,
                        };
                    })(),
                    shared_context: {
                        company_name: formData.companyName,
                        persona_name: formData.agentPersonaName,
                        markets: formData.markets,
                        deal_types: formData.dealTypes,
                        appointment_type: formData.appointmentType,
                        goal: formData.outboundGoal,
                    },
                },
                auto_created: false,
                template_version: "vertical-re-outbound-v1-adhoc",
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
        console.error("[CREATE SINGLE AGENT] RE outbound error:", error);
        return {
            success: false,
            error: error.message || "Unexpected error creating outbound agent",
        };
    }
}

// ─── SAAS OUTBOUND PATH ───

async function createSaaSOutboundAgent(
    clientId: string,
    input: Extract<CreateSingleAgentInput, { kind: "vertical_saas_outbound" }>,
    vapiKey: string,
    appUrl: string
): Promise<CreateSingleAgentResult> {
    const vertical = getVertical("saas_companies");
    const agentDef = vertical?.agents.find(
        (a) => a.id === "saas_outbound_sales"
    );
    if (!vertical || !agentDef)
        return { success: false, error: "SaaS outbound agent definition not found" };

    const { formData, agentName } = input;

    if (!formData.outboundPrompt || !formData.outboundFirstMessage) {
        return {
            success: false,
            error: "Outbound prompt or first message is empty",
        };
    }

    try {
        // Umbrella-scoped calendar tools (null for CUSTOM → inline). SaaS uses
        // INLINE structured output (no umbrella-global resource), so the agent
        // always carries the SaaS analysisPlan.
        const calendarToolIds = await getCalendarToolIdsForClient(clientId);
        const tools = buildSaaSOutboundTools(clientId, appUrl, formData, {
            calendarToolIds: calendarToolIds ?? undefined,
        });
        const toolIdRefs = calendarToolIds
            ? Object.values(calendarToolIds).filter(
                  (v): v is string => !!v
              )
            : [];

        const { data: assistant, error: vapiErr } = await createAssistant(
            {
                name: agentName,
                firstMessage: formData.outboundFirstMessage,
                model: {
                    provider: "openai",
                    model: agentDef.llmModel,
                    messages: [
                        { role: "system", content: formData.outboundPrompt },
                    ],
                    tools: [...tools, { type: "endCall" }],
                    ...(toolIdRefs.length > 0 ? { toolIds: toolIdRefs } : {}),
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
                voicemailDetection: {
                    provider: "twilio",
                    enabled: true,
                    voicemailDetectionTypes: [
                        "machine_end_beep",
                        "machine_end_silence",
                    ],
                },
                metadata: {
                    clientId,
                    agentType: "outbound",
                    agentCategory: agentDef.category,
                    templateVersion: "vertical-saas-outbound-v1-adhoc",
                },
                analysisPlan: {
                    structuredDataSchema: SAAS_STRUCTURED_OUTPUT_SCHEMA,
                    structuredDataPrompt: SAAS_STRUCTURED_OUTPUT_PROMPT,
                    minMessagesThreshold: 5,
                },
            },
            vapiKey
        );

        if (!assistant) {
            console.error("[CREATE SINGLE AGENT] VAPI rejected SaaS outbound assistant:", {
                status: vapiErr?.status,
                body: vapiErr?.body,
            });
            return { success: false, error: formatVapiError(vapiErr) };
        }

        const { data: agent, error: insertError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: assistant.id,
                name: agentName,
                agent_type: "outbound",
                agent_type_id: agentDef.id,
                agent_config: {
                    voice_id: agentDef.voiceId,
                    voice_name: `${formData.agentPersonaName} (SaaS)`,
                    vertical: "saas_companies",
                    persona_name: formData.agentPersonaName,
                    product_one_liner: formData.productOneLiner,
                    icp: formData.icpDescription,
                    demo_type: formData.demoType,
                    transfer: {
                        first_name: formData.outboundTransfer.firstName,
                        role: formData.outboundTransfer.role,
                        phone: formData.outboundTransfer.phone,
                        mode: formData.outboundTransfer.mode,
                    },
                    business_phone: formData.businessPhone,
                    outbound_goal: formData.outboundGoal,
                    outbound_scenario: formData.outboundScenario || null,
                    // Dual-channel messaging assets. The sequencer reads these
                    // (via getAgentMessaging) to adapt persona per channel for
                    // any sequence bound to this agent; without them every SMS
                    // path falls back to a generic AI persona. Mirrors
                    // deploySaaSAgents — reuses buildSaaSSmsStarter, so the SMS
                    // prompt is built from the same context as voice unless the
                    // operator edited it on the SMS-config phase.
                    voice_prompt: formData.outboundPrompt,
                    voice_first_message: formData.outboundFirstMessage,
                    ...(() => {
                        const sms =
                            formData.smsPrompt && formData.smsFirstMessage
                                ? {
                                      smsPrompt: formData.smsPrompt,
                                      smsFirstMessage: formData.smsFirstMessage,
                                  }
                                : buildSaaSSmsStarter(
                                      formData.outboundGoal,
                                      formData
                                  );
                        return {
                            sms_prompt: sms.smsPrompt,
                            sms_first_message: sms.smsFirstMessage,
                        };
                    })(),
                    shared_context: {
                        company_name: formData.companyName,
                        product_one_liner: formData.productOneLiner,
                        icp: formData.icpDescription,
                        value_props: formData.valueProps,
                        common_objections: formData.commonObjections || null,
                        pricing_summary: formData.pricingSummary || null,
                        persona_name: formData.agentPersonaName,
                        demo_type: formData.demoType,
                        goal: formData.outboundGoal,
                    },
                },
                auto_created: false,
                template_version: "vertical-saas-outbound-v1-adhoc",
            })
            .select("id")
            .single();

        if (insertError) {
            console.error(
                "[CREATE SINGLE AGENT] SaaS DB insert failed:",
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
        console.error("[CREATE SINGLE AGENT] SaaS outbound error:", error);
        return {
            success: false,
            error: error.message || "Unexpected error creating outbound agent",
        };
    }
}
