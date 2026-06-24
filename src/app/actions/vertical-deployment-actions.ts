"use server";

import { supabase } from "@/lib/supabase";
import { createAssistant } from "@/lib/vapi";
import { formatVapiError } from "@/lib/vapi-errors";
import { getClientVapiKey } from "@/lib/client-secrets";
import { revalidatePath } from "next/cache";
import { getAllAgentDefaultSettings } from "./agent-default-settings-actions";
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
import { buildSaaSOutboundTools } from "@/lib/verticals/saas/tools";
import {
    SAAS_STRUCTURED_OUTPUT_SCHEMA,
    SAAS_STRUCTURED_OUTPUT_PROMPT,
} from "@/lib/verticals/saas/structured-output";
import { buildSaaSSmsStarter } from "@/lib/verticals/saas/sms-prompt-templates";
import { buildRESmsStarter } from "@/lib/verticals/real-estate-investor/sms-prompt-templates";
import { getCalendarToolIdsForClient } from "./umbrella-tools-actions";
import { getREStructuredOutputIdForClient } from "./umbrella-structured-outputs-actions";
import type { REInvestorFormData, SaaSFormData } from "@/lib/verticals/types";
import type { DeploymentResult } from "@/components/onboarding-v2/types";
import type { CreateAssistantPayload } from "@/lib/vapi";

// ═══════════════════════════════════════════════════════════
// VERTICAL DEPLOYMENT
// Deploys pre-configured agents from a targeted vertical.
// NO GPT calls — static prompt templates with form data interpolation.
// ═══════════════════════════════════════════════════════════

export async function deployVerticalAgents(
    clientId: string,
    formData: REInvestorFormData
): Promise<DeploymentResult> {
    try {
        const vertical = getVertical("real_estate_investor");
        if (!vertical) {
            return {
                success: false,
                agents: [],
                error: "Vertical definition not found",
            };
        }

        // 1. Fetch client basic fields + decrypted VAPI key
        const { data: client } = await supabase
            .from("clients")
            .select("id, name, account_type")
            .eq("id", clientId)
            .single();

        const clientVapiKey = await getClientVapiKey(clientId);
        if (!client || !clientVapiKey) {
            return {
                success: false,
                agents: [],
                error: "Client or VAPI key not found",
            };
        }

        const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        // 2. Save tenant profile
        const profileData = {
            industry: "real_estate",
            sub_industry: "investor_flipper",
            business_description: `${formData.companyName} - Real estate investment company specializing in ${formData.dealTypes.join(", ")}`,
            website: "",
            service_area: JSON.stringify({
                cities: formData.markets
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                zip_codes: [],
                radius_miles: 50,
            }),
            timezone: formData.timezone,
            brand_voice: "friendly",
            emergency_phone: formData.inboundTransfer.phone,
            primary_goal: "book_appointment",
            onboarding_vertical: "real_estate_investor",
        };

        // Upsert tenant profile
        const { error: profileError } = await supabase
            .from("tenant_profiles")
            .upsert(
                {
                    client_id: clientId,
                    ...profileData,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "client_id" }
            );

        if (profileError) {
            console.error(
                "[VERTICAL] Profile save error:",
                profileError
            );
            return {
                success: false,
                agents: [],
                error: `Failed to save profile: ${profileError.message}`,
            };
        }

        // 3. Fetch default settings for both inbound and outbound agents
        const defaultSettings = await getAllAgentDefaultSettings();

        // 3b. Resolve umbrella-scoped calendar tool IDs (UMBRELLA only).
        // Returns null for CUSTOM accounts → tools fall through to inline.
        const calendarToolIds = await getCalendarToolIdsForClient(clientId);
        const calendarToolIdRefs = calendarToolIds
            ? Object.values(calendarToolIds).filter(
                  (v): v is string => !!v
              )
            : [];

        // 3c. Resolve umbrella-scoped RE structured output ID (UMBRELLA only).
        // Null for CUSTOM accounts → analysisPlan falls through to inline.
        const reStructuredOutputId =
            await getREStructuredOutputIdForClient(clientId);

        // 4. Deploy each agent defined on the vertical (inbound + outbound)
        const deployedAgents: DeploymentResult["agents"] = [];

        for (const agentDef of vertical.agents) {
            const isOutbound = agentDef.direction === "outbound";
            const agentName = `${formData.companyName} - ${agentDef.name}`;

            // 4a. Build prompt
            //    - Inbound: static template interpolation
            //    - Outbound: user-edited prompt from the onboarding outbound-config phase
            let systemPrompt: string;
            let firstMessage: string;
            if (isOutbound) {
                if (!formData.outboundPrompt || !formData.outboundFirstMessage) {
                    deployedAgents.push({
                        type_id: agentDef.id,
                        name: agentName,
                        agent_id: null,
                        vapi_id: null,
                        sequence_id: null,
                        error: "Outbound prompt or first message is empty",
                        failedAt: "prompt",
                    });
                    continue;
                }
                systemPrompt = formData.outboundPrompt;
                firstMessage = formData.outboundFirstMessage;
            } else {
                const built = buildREInboundPrompt(formData);
                systemPrompt = built.systemPrompt;
                firstMessage = built.firstMessage;
            }

            // 4b. Tools — calendar surface is identical for both directions, but
            // the transferCall uses direction-specific specialist config.
            // For UMBRELLA clients, calendar tools live on the umbrella's VAPI
            // account and are referenced via `toolIds` below — the builder
            // returns transfer-only when calendarToolIds is supplied.
            const builderOpts = {
                calendarToolIds: calendarToolIds ?? undefined,
            };
            const tools = isOutbound
                ? buildREOutboundTools(clientId, appUrl, formData, builderOpts)
                : buildREInboundTools(clientId, appUrl, formData, builderOpts);

            // 4c. Defaults source depends on direction
            const directionDefaults = isOutbound
                ? defaultSettings?.outbound
                : defaultSettings?.inbound;

            // 4d. Build VAPI payload
            const vapiPayload = buildVerticalVapiPayload(
                directionDefaults?.settings || null,
                {
                    name: agentName,
                    systemPrompt,
                    firstMessage,
                    tools,
                    toolIds: calendarToolIdRefs,
                    voiceId: agentDef.voiceId,
                    voiceProvider: agentDef.voiceProvider,
                    voiceModel: agentDef.voiceModel,
                    voiceConfig: agentDef.voiceConfig,
                    llmModel: agentDef.llmModel,
                    llmTemperature: agentDef.llmTemperature,
                    llmMaxTokens: agentDef.llmMaxTokens,
                    transcriberModel: agentDef.transcriberModel,
                    firstMessageMode: agentDef.firstMessageMode,
                    maxDurationSeconds: agentDef.maxDurationSeconds,
                    startSpeakingPlan: agentDef.startSpeakingPlan,
                    stopSpeakingPlan: agentDef.stopSpeakingPlan,
                    endCallPhrases: agentDef.endCallPhrases,
                    clientId,
                    agentType: agentDef.direction,
                    agentCategory: agentDef.category,
                    templateVersion: "vertical-re-v1",
                    appUrl,
                    reStructuredOutputId,
                    voicemailDetection: isOutbound
                        ? {
                              provider: "twilio",
                              enabled: true,
                              voicemailDetectionTypes: [
                                  "machine_end_beep",
                                  "machine_end_silence",
                              ],
                          }
                        : undefined,
                    voicemailMessage: isOutbound
                        ? undefined
                        : `You've reached ${formData.companyName}. Please leave a message and we will get back to you as soon as possible.`,
                    endCallMessage: isOutbound
                        ? undefined
                        : "Thank you for calling. Have a great day!",
                }
            );

            // 4e. Create VAPI assistant (per-agent try/catch so one failure doesn't abort the other)
            let vapiAssistant: { id: string } | null = null;
            let vapiErr: { status: number; body: string } | undefined;
            try {
                const result = await createAssistant(vapiPayload, clientVapiKey);
                vapiAssistant = result.data;
                vapiErr = result.error;
            } catch (thrown: any) {
                console.error(
                    `[VERTICAL] VAPI creation threw for ${agentDef.id}:`,
                    thrown
                );
                deployedAgents.push({
                    type_id: agentDef.id,
                    name: agentName,
                    agent_id: null,
                    vapi_id: null,
                    sequence_id: null,
                    error: thrown?.message || "VAPI assistant creation failed",
                    failedAt: "vapi",
                });
                continue;
            }

            if (!vapiAssistant) {
                console.error(
                    `[VERTICAL] VAPI rejected ${agentDef.id}:`,
                    { status: vapiErr?.status, body: vapiErr?.body }
                );
                deployedAgents.push({
                    type_id: agentDef.id,
                    name: agentName,
                    agent_id: null,
                    vapi_id: null,
                    sequence_id: null,
                    error: formatVapiError(vapiErr),
                    failedAt: "vapi",
                });
                continue;
            }

            // 4f. Save agent row to DB
            const transferConfig = isOutbound
                ? formData.outboundTransfer
                : formData.inboundTransfer;
            const agentConfig: Record<string, any> = {
                voice_id: agentDef.voiceId,
                voice_name: "Sam (RE)",
                vertical: "real_estate_investor",
                persona_name: formData.agentPersonaName,
                markets: formData.markets,
                deal_types: formData.dealTypes,
                appointment_type: formData.appointmentType,
                transfer: {
                    first_name: transferConfig.firstName,
                    role: transferConfig.role,
                    phone: transferConfig.phone,
                    mode: transferConfig.mode,
                },
                business_phone: formData.businessPhone,
            };
            if (isOutbound) {
                agentConfig.outbound_goal = formData.outboundGoal;
                agentConfig.outbound_scenario = formData.outboundScenario || null;
                // Persist the voice + SMS channel prompts and the shared offer
                // context so the sequencer can adapt personality per channel for
                // sequences bound to this agent. The SMS prompt is built from the
                // same context as the voice prompt unless the user edited it.
                agentConfig.voice_prompt = formData.outboundPrompt;
                agentConfig.voice_first_message = formData.outboundFirstMessage;
                const reSms =
                    formData.smsPrompt && formData.smsFirstMessage
                        ? {
                              smsPrompt: formData.smsPrompt,
                              smsFirstMessage: formData.smsFirstMessage,
                          }
                        : buildRESmsStarter(formData.outboundGoal, formData);
                agentConfig.sms_prompt = reSms.smsPrompt;
                agentConfig.sms_first_message = reSms.smsFirstMessage;
                agentConfig.shared_context = {
                    company_name: formData.companyName,
                    persona_name: formData.agentPersonaName,
                    markets: formData.markets,
                    deal_types: formData.dealTypes,
                    appointment_type: formData.appointmentType,
                    goal: formData.outboundGoal,
                };
            }

            const { data: agentRecord, error: agentError } = await supabase
                .from("agents")
                .insert({
                    client_id: clientId,
                    vapi_id: vapiAssistant.id,
                    name: agentName,
                    agent_type: agentDef.direction,
                    agent_type_id: agentDef.id,
                    agent_config: agentConfig,
                    auto_created: true,
                    template_version: "vertical-re-v1",
                })
                .select("id")
                .single();

            if (agentError) {
                console.error(
                    `[VERTICAL] Agent save error for ${agentDef.id}:`,
                    agentError
                );
            }

            deployedAgents.push({
                type_id: agentDef.id,
                name: agentName,
                agent_id: agentRecord?.id || null,
                vapi_id: vapiAssistant.id,
                sequence_id: null,
                error: agentError ? `DB save failed: ${agentError.message}` : null,
                failedAt: agentError ? "db" : null,
            });
        }

        const anyDeployed = deployedAgents.some((a) => !a.error);
        if (!anyDeployed) {
            return {
                success: false,
                agents: deployedAgents,
                error: "Failed to create any agents",
            };
        }

        // 5. Mark onboarding complete
        await supabase
            .from("tenant_profiles")
            .update({
                onboarding_completed: true,
                onboarding_completed_at: new Date().toISOString(),
                onboarding_version: "vertical-re-v1",
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        // 6. Revalidate paths
        revalidatePath(`/client/${clientId}/onboarding`);
        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}`);

        return {
            success: true,
            agents: deployedAgents,
        };
    } catch (err: any) {
        console.error("[VERTICAL] Deployment error:", err);
        return {
            success: false,
            agents: [],
            error: err.message || "Unexpected deployment error",
        };
    }
}

// ═══════════════════════════════════════════════════════════
// SAAS COMPANIES VERTICAL DEPLOYMENT (outbound-only)
// Deploys a single outbound sales agent that books demos. Mirrors the RE
// outbound path: user-edited prompt + static tools, NO GPT call at deploy.
// ═══════════════════════════════════════════════════════════

export async function deploySaaSAgents(
    clientId: string,
    formData: SaaSFormData
): Promise<DeploymentResult> {
    try {
        const vertical = getVertical("saas_companies");
        const agentDef = vertical?.agents.find(
            (a) => a.direction === "outbound"
        );
        if (!vertical || !agentDef) {
            return {
                success: false,
                agents: [],
                error: "SaaS vertical definition not found",
            };
        }

        // 1. Fetch client + decrypted VAPI key
        const { data: client } = await supabase
            .from("clients")
            .select("id, name, account_type")
            .eq("id", clientId)
            .single();

        const clientVapiKey = await getClientVapiKey(clientId);
        if (!client || !clientVapiKey) {
            return {
                success: false,
                agents: [],
                error: "Client or VAPI key not found",
            };
        }

        const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        // 2. Validate the user-edited outbound prompt
        if (!formData.outboundPrompt || !formData.outboundFirstMessage) {
            return {
                success: false,
                agents: [],
                error: "Outbound prompt or first message is empty",
            };
        }

        // 3. Save tenant profile
        const { error: profileError } = await supabase
            .from("tenant_profiles")
            .upsert(
                {
                    client_id: clientId,
                    industry: "saas",
                    sub_industry: "b2b_saas",
                    business_description:
                        formData.productOneLiner ||
                        `${formData.companyName} - SaaS company`,
                    website: "",
                    timezone: formData.timezone,
                    brand_voice: "professional",
                    emergency_phone: formData.outboundTransfer.phone,
                    primary_goal: "book_appointment",
                    onboarding_vertical: "saas_companies",
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "client_id" }
            );

        if (profileError) {
            console.error("[VERTICAL SAAS] Profile save error:", profileError);
            return {
                success: false,
                agents: [],
                error: `Failed to save profile: ${profileError.message}`,
            };
        }

        // 4. Defaults + umbrella-scoped calendar tools (null for CUSTOM → inline)
        const defaultSettings = await getAllAgentDefaultSettings();
        const calendarToolIds = await getCalendarToolIdsForClient(clientId);
        const calendarToolIdRefs = calendarToolIds
            ? Object.values(calendarToolIds).filter(
                  (v): v is string => !!v
              )
            : [];

        // 5. Tools (calendar + warm/cold transfer to human closer)
        const tools = buildSaaSOutboundTools(clientId, appUrl, formData, {
            calendarToolIds: calendarToolIds ?? undefined,
        });

        const agentName = `${formData.companyName} - ${agentDef.name}`;

        // 6. Build VAPI payload (inline SaaS structured output via analysisPlan)
        const vapiPayload = buildVerticalVapiPayload(
            defaultSettings?.outbound?.settings || null,
            {
                name: agentName,
                systemPrompt: formData.outboundPrompt,
                firstMessage: formData.outboundFirstMessage,
                tools,
                toolIds: calendarToolIdRefs,
                voiceId: agentDef.voiceId,
                voiceProvider: agentDef.voiceProvider,
                voiceModel: agentDef.voiceModel,
                voiceConfig: agentDef.voiceConfig,
                llmModel: agentDef.llmModel,
                llmTemperature: agentDef.llmTemperature,
                llmMaxTokens: agentDef.llmMaxTokens,
                transcriberModel: agentDef.transcriberModel,
                firstMessageMode: agentDef.firstMessageMode,
                maxDurationSeconds: agentDef.maxDurationSeconds,
                startSpeakingPlan: agentDef.startSpeakingPlan,
                stopSpeakingPlan: agentDef.stopSpeakingPlan,
                endCallPhrases: agentDef.endCallPhrases,
                clientId,
                agentType: agentDef.direction,
                agentCategory: agentDef.category,
                templateVersion: "vertical-saas-v1",
                appUrl,
                reStructuredOutputId: null,
                analysisSchema: SAAS_STRUCTURED_OUTPUT_SCHEMA,
                analysisPrompt: SAAS_STRUCTURED_OUTPUT_PROMPT,
                voicemailDetection: {
                    provider: "twilio",
                    enabled: true,
                    voicemailDetectionTypes: [
                        "machine_end_beep",
                        "machine_end_silence",
                    ],
                },
            }
        );

        // 7. Create VAPI assistant
        const deployedAgents: DeploymentResult["agents"] = [];
        let vapiAssistant: { id: string } | null = null;
        let vapiErr: { status: number; body: string } | undefined;
        try {
            const result = await createAssistant(vapiPayload, clientVapiKey);
            vapiAssistant = result.data;
            vapiErr = result.error;
        } catch (thrown: any) {
            console.error(
                `[VERTICAL SAAS] VAPI creation threw for ${agentDef.id}:`,
                thrown
            );
            return {
                success: false,
                agents: [
                    {
                        type_id: agentDef.id,
                        name: agentName,
                        agent_id: null,
                        vapi_id: null,
                        sequence_id: null,
                        error:
                            thrown?.message || "VAPI assistant creation failed",
                        failedAt: "vapi",
                    },
                ],
                error: thrown?.message || "VAPI assistant creation failed",
            };
        }

        if (!vapiAssistant) {
            console.error(`[VERTICAL SAAS] VAPI rejected ${agentDef.id}:`, {
                status: vapiErr?.status,
                body: vapiErr?.body,
            });
            return {
                success: false,
                agents: [
                    {
                        type_id: agentDef.id,
                        name: agentName,
                        agent_id: null,
                        vapi_id: null,
                        sequence_id: null,
                        error: formatVapiError(vapiErr),
                        failedAt: "vapi",
                    },
                ],
                error: formatVapiError(vapiErr),
            };
        }

        // 8. Save agent row
        const agentConfig: Record<string, any> = {
            voice_id: agentDef.voiceId,
            voice_name: `${formData.agentPersonaName} (SaaS)`,
            vertical: "saas_companies",
            persona_name: formData.agentPersonaName,
            product_one_liner: formData.productOneLiner,
            icp: formData.icpDescription,
            demo_type: formData.demoType,
            outbound_goal: formData.outboundGoal,
            outbound_scenario: formData.outboundScenario || null,
            transfer: {
                first_name: formData.outboundTransfer.firstName,
                role: formData.outboundTransfer.role,
                phone: formData.outboundTransfer.phone,
                mode: formData.outboundTransfer.mode,
            },
            business_phone: formData.businessPhone,
            // Voice + SMS channel prompts and the shared offer context. The
            // sequencer reads these to adapt personality per channel for any
            // sequence bound to this agent. SMS prompt is built from the same
            // context as the voice prompt unless the user edited it on the
            // SMS-config phase.
            voice_prompt: formData.outboundPrompt,
            voice_first_message: formData.outboundFirstMessage,
            ...(() => {
                const sms =
                    formData.smsPrompt && formData.smsFirstMessage
                        ? {
                              smsPrompt: formData.smsPrompt,
                              smsFirstMessage: formData.smsFirstMessage,
                          }
                        : buildSaaSSmsStarter(formData.outboundGoal, formData);
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
        };

        const { data: agentRecord, error: agentError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: vapiAssistant.id,
                name: agentName,
                agent_type: agentDef.direction,
                agent_type_id: agentDef.id,
                agent_config: agentConfig,
                auto_created: true,
                template_version: "vertical-saas-v1",
            })
            .select("id")
            .single();

        if (agentError) {
            console.error(
                `[VERTICAL SAAS] Agent save error for ${agentDef.id}:`,
                agentError
            );
        }

        deployedAgents.push({
            type_id: agentDef.id,
            name: agentName,
            agent_id: agentRecord?.id || null,
            vapi_id: vapiAssistant.id,
            sequence_id: null,
            error: agentError
                ? `Agent created in VAPI but DB save failed: ${agentError.message}`
                : null,
            failedAt: agentError ? "db" : null,
        });

        // 9. Gate completion on a successful agent save. If the VAPI assistant
        // was created but the DB row failed, do NOT mark onboarding complete —
        // the assistant exists but isn't usably recorded. Mirrors
        // deployVerticalAgents, which early-returns before marking complete
        // when no agent fully deploys.
        const anyDeployed = deployedAgents.some((a) => !a.error);
        if (!anyDeployed) {
            return {
                success: false,
                agents: deployedAgents,
                error:
                    deployedAgents[0]?.error ||
                    "Agent created in VAPI but failed to save",
            };
        }

        // 10. Mark onboarding complete
        await supabase
            .from("tenant_profiles")
            .update({
                onboarding_completed: true,
                onboarding_completed_at: new Date().toISOString(),
                onboarding_version: "vertical-saas-v1",
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        // 11. Revalidate paths
        revalidatePath(`/client/${clientId}/onboarding`);
        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}`);

        return {
            success: true,
            agents: deployedAgents,
        };
    } catch (err: any) {
        console.error("[VERTICAL SAAS] Deployment error:", err);
        return {
            success: false,
            agents: [],
            error: err.message || "Unexpected deployment error",
        };
    }
}

// ─── VERTICAL-SPECIFIC VAPI PAYLOAD BUILDER ───
// Builds the full VAPI payload with Samantha's exact voice/model/transcriber settings.
// Falls back to these settings even if no DB defaults exist.

function buildVerticalVapiPayload(
    defaults: Record<string, any> | null,
    overrides: {
        name: string;
        systemPrompt: string;
        firstMessage: string;
        tools: any[];
        toolIds?: string[];
        voiceId: string;
        voiceProvider: string;
        voiceModel: string;
        voiceConfig: {
            speed: number;
            stability: number;
            similarityBoost: number;
            style?: number;
            useSpeakerBoost?: boolean;
        };
        llmModel: string;
        llmTemperature: number;
        llmMaxTokens: number;
        transcriberModel: string;
        firstMessageMode: string;
        maxDurationSeconds: number;
        startSpeakingPlan?: any;
        stopSpeakingPlan?: any;
        endCallPhrases: string[];
        clientId: string;
        agentType: string;
        agentCategory: string;
        templateVersion: string;
        appUrl: string;
        voicemailDetection?: {
            provider: string;
            enabled: boolean;
            voicemailDetectionTypes: string[];
        };
        voicemailMessage?: string;
        endCallMessage?: string;
        reStructuredOutputId?: string | null;
        // Inline analysisPlan schema/prompt used when no global structured-output
        // ID is attached. Defaults to the RE schema for back-compat; SaaS passes
        // its own schema so the outbound agent extracts SaaS sales fields.
        analysisSchema?: Record<string, unknown>;
        analysisPrompt?: string;
    }
): CreateAssistantPayload {
    // Build the payload with Samantha's exact settings as the base,
    // then overlay any DB defaults that exist
    const basePayload: CreateAssistantPayload = {
        name: overrides.name,
        firstMessage: overrides.firstMessage,
        model: {
            provider: "openai",
            model: overrides.llmModel,
            messages: [
                { role: "system", content: overrides.systemPrompt },
            ],
            tools: [...overrides.tools, { type: "endCall" }],
            ...(overrides.toolIds && overrides.toolIds.length > 0
                ? { toolIds: overrides.toolIds }
                : {}),
            temperature: overrides.llmTemperature,
            maxTokens: overrides.llmMaxTokens,
        },
        voice: {
            provider: overrides.voiceProvider,
            voiceId: overrides.voiceId,
            model: overrides.voiceModel,
            speed: overrides.voiceConfig.speed,
            stability: overrides.voiceConfig.stability,
            similarityBoost: overrides.voiceConfig.similarityBoost,
            style: overrides.voiceConfig.style,
            useSpeakerBoost: overrides.voiceConfig.useSpeakerBoost,
        },
        transcriber: {
            provider: "deepgram",
            language: "en",
            model: overrides.transcriberModel,
            numerals: true,
        },
        server: {
            url: `${overrides.appUrl}/api/webhooks/vapi`,
            timeoutSeconds: 20,
        },
        serverMessages: ["status-update", "end-of-call-report"],
        clientMessages: [],
        recordingEnabled: true,
        endCallFunctionEnabled: true,
        dialKeypadFunctionEnabled: true,
        firstMessageMode: overrides.firstMessageMode,
        maxDurationSeconds: overrides.maxDurationSeconds,
        endCallPhrases: overrides.endCallPhrases,
        startSpeakingPlan: overrides.startSpeakingPlan,
        stopSpeakingPlan: overrides.stopSpeakingPlan,
        messagePlan: {
            idleMessages: ["Are you still there?"],
        },
        metadata: {
            clientId: overrides.clientId,
            agentType: overrides.agentType,
            agentCategory: overrides.agentCategory,
            templateVersion: overrides.templateVersion,
        },
        // UMBRELLA: attach the global per-umbrella RE structured output via
        // artifactPlan.structuredOutputIds. CUSTOM (or umbrella bootstrap not
        // yet run): fall back to the inline analysisPlan so extraction still
        // happens.
        ...(overrides.reStructuredOutputId
            ? {
                  artifactPlan: {
                      structuredOutputIds: [overrides.reStructuredOutputId],
                  },
              }
            : {
                  analysisPlan: {
                      structuredDataSchema:
                          overrides.analysisSchema ?? RE_STRUCTURED_DATA_SCHEMA,
                      structuredDataPrompt:
                          overrides.analysisPrompt ?? RE_STRUCTURED_DATA_PROMPT,
                      minMessagesThreshold: 5,
                  },
              }),
        ...(overrides.voicemailDetection
            ? { voicemailDetection: overrides.voicemailDetection }
            : {}),
        ...(overrides.voicemailMessage
            ? { voicemailMessage: overrides.voicemailMessage }
            : {}),
        ...(overrides.endCallMessage
            ? { endCallMessage: overrides.endCallMessage }
            : {}),
    };

    // If DB defaults exist, overlay non-critical settings from them
    // but PRESERVE the vertical's specific voice/model/prompt
    if (defaults) {
        return {
            ...defaults,
            ...basePayload,
            // Preserve base model but allow DB to set other model options
            model: {
                ...defaults.model,
                ...basePayload.model,
            },
            // Preserve base voice — this is the proven config
            voice: basePayload.voice,
        } as CreateAssistantPayload;
    }

    return basePayload;
}
