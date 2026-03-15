"use server";

import { supabase } from "@/lib/supabase";
import { createAssistant } from "@/lib/vapi";
import { revalidatePath } from "next/cache";
import { getAllAgentDefaultSettings } from "./agent-default-settings-actions";
import { getVertical } from "@/lib/verticals/registry";
import { buildREInboundPrompt } from "@/lib/verticals/real-estate-investor/prompts";
import { buildREInboundTools } from "@/lib/verticals/real-estate-investor/tools";
import {
    RE_STRUCTURED_DATA_SCHEMA,
    RE_STRUCTURED_DATA_PROMPT,
} from "@/lib/verticals/real-estate-investor/sheets-schema";
import type { REInvestorFormData } from "@/lib/verticals/types";
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

        // 1. Fetch client for VAPI key
        const { data: client } = await supabase
            .from("clients")
            .select("id, name, vapi_key, account_type")
            .eq("id", clientId)
            .single();

        if (!client?.vapi_key) {
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
            emergency_phone: formData.transferPhone,
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

        // 3. Fetch default settings for inbound agent
        const defaultSettings = await getAllAgentDefaultSettings();
        const inboundDefaults = defaultSettings?.inbound;

        // 4. Build prompt from static template (NO GPT call)
        const { systemPrompt, firstMessage } =
            buildREInboundPrompt(formData);

        // 5. Build tools
        const tools = buildREInboundTools(clientId, appUrl, formData);

        // 6. Get agent definition from vertical
        const agentDef = vertical.agents[0]; // Inbound receptionist

        // 7. Build VAPI payload — matching Samantha's exact config
        const vapiPayload = buildVerticalVapiPayload(
            inboundDefaults?.settings || null,
            {
                name: `${formData.companyName} - ${agentDef.name}`,
                systemPrompt,
                firstMessage,
                tools,
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
                agentType: "inbound",
                agentCategory: "inbound",
                templateVersion: "vertical-re-v1",
                appUrl,
            }
        );

        // 8. Create VAPI assistant
        let vapiAssistant: { id: string } | null = null;
        try {
            vapiAssistant = await createAssistant(
                vapiPayload,
                client.vapi_key
            );
        } catch (vapiError: any) {
            console.error("[VERTICAL] VAPI creation error:", vapiError);
            return {
                success: false,
                agents: [
                    {
                        type_id: agentDef.id,
                        name: agentDef.name,
                        agent_id: null,
                        vapi_id: null,
                        sequence_id: null,
                        error: vapiError.message || "VAPI assistant creation failed",
                    },
                ],
                error: "Failed to create VAPI assistant",
            };
        }

        if (!vapiAssistant) {
            return {
                success: false,
                agents: [
                    {
                        type_id: agentDef.id,
                        name: agentDef.name,
                        agent_id: null,
                        vapi_id: null,
                        sequence_id: null,
                        error: "VAPI assistant creation returned null",
                    },
                ],
                error: "VAPI assistant creation returned null",
            };
        }

        // 9. Save agent to DB
        const { data: agentRecord, error: agentError } = await supabase
            .from("agents")
            .insert({
                client_id: clientId,
                vapi_id: vapiAssistant.id,
                name: `${formData.companyName} - ${agentDef.name}`,
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
                auto_created: true,
                template_version: "vertical-re-v1",
            })
            .select("id")
            .single();

        if (agentError) {
            console.error("[VERTICAL] Agent save error:", agentError);
        }

        // 10. Mark onboarding complete
        await supabase
            .from("tenant_profiles")
            .update({
                onboarding_completed: true,
                onboarding_completed_at: new Date().toISOString(),
                onboarding_version: "vertical-re-v1",
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        // 11. Revalidate paths
        revalidatePath(`/client/${clientId}/onboarding`);
        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}`);

        return {
            success: true,
            agents: [
                {
                    type_id: agentDef.id,
                    name: `${formData.companyName} - ${agentDef.name}`,
                    agent_id: agentRecord?.id || null,
                    vapi_id: vapiAssistant.id,
                    sequence_id: null,
                    error: null,
                },
            ],
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
        recordingEnabled: true,
        endCallFunctionEnabled: true,
        dialKeypadFunctionEnabled: true,
        firstMessageMode: overrides.firstMessageMode,
        maxDurationSeconds: overrides.maxDurationSeconds,
        endCallPhrases: overrides.endCallPhrases,
        startSpeakingPlan: overrides.startSpeakingPlan,
        stopSpeakingPlan: overrides.stopSpeakingPlan,
        voicemailDetection: {
            provider: "vapi",
            backoffPlan: {
                maxRetries: 6,
                startAtSeconds: 5,
                frequencySeconds: 5,
            },
            beepMaxAwaitSeconds: 0,
        },
        messagePlan: {
            idleMessages: ["Are you still there?"],
        },
        metadata: {
            clientId: overrides.clientId,
            agentType: overrides.agentType,
            agentCategory: overrides.agentCategory,
            templateVersion: overrides.templateVersion,
        },
        analysisPlan: {
            structuredDataSchema: RE_STRUCTURED_DATA_SCHEMA,
            structuredDataPrompt: RE_STRUCTURED_DATA_PROMPT,
            minMessagesThreshold: 5,
        },
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
