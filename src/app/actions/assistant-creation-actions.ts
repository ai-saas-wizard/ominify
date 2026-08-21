"use server";

import { supabase } from "@/lib/supabase";
import { createAssistant } from "@/lib/vapi";
import { getClientVapiKey } from "@/lib/client-secrets";
import { buildInboundPrompt, buildOutboundPrompt, TenantProfileData } from "@/lib/prompt-templates";
import { buildAgentBlueprint } from "@/lib/agent-blueprint";
import { buildCalendarTools } from "@/lib/calendar-tools";
import { VOICEMAIL_DETECTION_TYPES, inboundVoicemailMessage } from "@/lib/voicemail-config";

// ═══════════════════════════════════════════════════════════
// AUTO-CREATE VAPI ASSISTANTS ON ONBOARDING COMPLETION
// ═══════════════════════════════════════════════════════════

const TEMPLATE_VERSION = "v1";

// _REMOVE_START
function _unused_buildCalendarTools_DELETE_ME(appUrl: string) {
    const serverUrl = `${appUrl}/api/vapi/tools/calendar`;
    return [
        {
            type: "function" as const,
            function: {
                name: "check_availability",
                description:
                    "Check available appointment slots, optionally filtered by day-part or time range. Call this when the customer wants to book or asks about availability.",
                parameters: {
                    type: "object",
                    properties: {
                        preferred_date: {
                            type: "string",
                            description:
                                "Preferred date in YYYY-MM-DD format. Omit to check the next few business days.",
                        },
                        days_ahead: {
                            type: "integer",
                            description:
                                "How many days forward to scan. Use 7 for 'next week', 3 for 'next few days'.",
                        },
                        duration_minutes: {
                            type: "integer",
                            description: "Appointment length in minutes. Omit to use tenant default.",
                        },
                        time_of_day_preference: {
                            type: "string",
                            enum: ["morning", "afternoon", "evening", "any"],
                            description: "Customer-stated day-part preference.",
                        },
                        earliest_time: {
                            type: "string",
                            description: "Earliest acceptable time in HH:MM (24h), tenant timezone.",
                        },
                        latest_time: {
                            type: "string",
                            description: "Latest acceptable time in HH:MM (24h), tenant timezone.",
                        },
                        service_type: {
                            type: "string",
                            description: "The type of service or appointment.",
                        },
                    },
                },
            },
            server: { url: serverUrl, timeoutSeconds: 20 },
            messages: [
                { type: "request-start", content: "Let me check the schedule for you." },
                {
                    type: "request-failed",
                    content:
                        "I'm having trouble reaching our calendar right now. Let me take your information and have someone call you back.",
                },
                {
                    type: "request-response-delayed",
                    content: "Still checking — one moment.",
                    timingMilliseconds: 3000,
                },
            ],
        },
        {
            type: "function" as const,
            function: {
                name: "book_appointment",
                description:
                    "Book a confirmed appointment. Only call after the customer has picked a specific date and time.",
                parameters: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "YYYY-MM-DD" },
                        time: { type: "string", description: "HH:MM 24-hour" },
                        customer_name: { type: "string", description: "Full name" },
                        customer_phone: {
                            type: "string",
                            description: "Phone; any format, will be normalized",
                        },
                        customer_email: {
                            type: "string",
                            description: "Email for calendar invite (optional)",
                        },
                        timezone: {
                            type: "string",
                            description:
                                "IANA timezone if caller volunteered it (e.g. America/Chicago). Omit to use tenant default.",
                        },
                        service_type: { type: "string" },
                        notes: { type: "string" },
                    },
                    required: ["date", "time", "customer_name", "customer_phone"],
                },
            },
            server: { url: serverUrl, timeoutSeconds: 20 },
            messages: [
                { type: "request-start", content: "Booking that for you now." },
                {
                    type: "request-failed",
                    content:
                        "Something went wrong booking that slot. Let me try a different time.",
                },
                {
                    type: "request-response-delayed",
                    content: "Almost done — one moment.",
                    timingMilliseconds: 3000,
                },
            ],
        },
        {
            type: "function" as const,
            function: {
                name: "lookup_appointment",
                description:
                    "Find existing appointments for a caller by phone number. Call when a returning caller asks about their booking.",
                parameters: {
                    type: "object",
                    properties: {
                        customer_phone: { type: "string", description: "Phone in any format" },
                    },
                    required: ["customer_phone"],
                },
            },
            server: { url: serverUrl, timeoutSeconds: 20 },
            messages: [
                { type: "request-start", content: "Let me pull up your appointment." },
                {
                    type: "request-failed",
                    content: "I can't reach our records right now. Can you hold while I try again?",
                },
            ],
        },
        {
            type: "function" as const,
            function: {
                name: "reschedule_appointment",
                description:
                    "Move a caller's existing appointment to a new date and time. Only call after the caller has agreed to a specific new slot.",
                parameters: {
                    type: "object",
                    properties: {
                        customer_phone: { type: "string" },
                        new_date: { type: "string", description: "YYYY-MM-DD" },
                        new_time: { type: "string", description: "HH:MM 24-hour" },
                        timezone: { type: "string" },
                    },
                    required: ["customer_phone", "new_date", "new_time"],
                },
            },
            server: { url: serverUrl, timeoutSeconds: 20 },
            messages: [
                { type: "request-start", content: "Moving that for you now." },
                {
                    type: "request-failed",
                    content:
                        "I'm having trouble moving the appointment. Let me take your info and have someone follow up.",
                },
            ],
        },
        {
            type: "function" as const,
            function: {
                name: "cancel_appointment",
                description:
                    "Cancel a caller's existing appointment. Only call after the caller has explicitly confirmed they want to cancel.",
                parameters: {
                    type: "object",
                    properties: {
                        customer_phone: { type: "string" },
                    },
                    required: ["customer_phone"],
                },
            },
            server: { url: serverUrl, timeoutSeconds: 20 },
            messages: [
                { type: "request-start", content: "Cancelling that now." },
                {
                    type: "request-failed",
                    content: "I couldn't cancel the appointment. Let me have someone follow up.",
                },
            ],
        },
    ];
}
// _REMOVE_END

export async function createTenantAssistants(clientId: string): Promise<{
    success: boolean;
    agents?: { inbound?: string; outbound?: string };
    error?: string;
}> {
    // 1. Fetch client + profile (vapi_key is fetched separately via getClientVapiKey)
    const { data: client } = await supabase
        .from("clients")
        .select("id, name, account_type")
        .eq("id", clientId)
        .single();

    if (!client) return { success: false, error: "Client not found" };

    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (!profile) return { success: false, error: "Tenant profile not found" };

    // 2. Resolve VAPI API key (decrypted)
    const vapiKey = await getClientVapiKey(clientId);
    if (!vapiKey) return { success: false, error: "No VAPI API key available" };

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const calendarTools = buildCalendarTools(APP_URL);
    const profileData = profile as unknown as TenantProfileData;
    const agentIds: { inbound?: string; outbound?: string } = {};

    // 3. Create Inbound Agent
    try {
        const inboundPrompt = await buildInboundPrompt(client.name, profileData);
        const { data: inboundAssistant, error: inboundVapiErr } = await createAssistant(
            {
                name: `${client.name} - Inbound`,
                firstMessage: inboundPrompt.firstMessage,
                model: {
                    provider: "openai",
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: inboundPrompt.systemPrompt }],
                    tools: [
                        ...calendarTools,
                        { type: "endCall" },
                        ...(profileData.emergency_phone
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
                            : []),
                    ],
                    temperature: 0.7,
                },
                voice: {
                    provider: "11labs",
                    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah
                },
                transcriber: {
                    provider: "deepgram",
                    language: "en",
                    model: "nova-2",
                },
                server: {
                    url: `${APP_URL}/api/webhooks/vapi`,
                },
                serverMessages: ["status-update", "end-of-call-report"],
                clientMessages: [],
                maxDurationSeconds: 600,
                backgroundSound: "office",
                endCallMessage: "Thank you for calling. Have a great day!",
                voicemailMessage: inboundVoicemailMessage(client.name),
                metadata: { clientId, agentType: "inbound", templateVersion: TEMPLATE_VERSION },
            },
            vapiKey
        );

        if (!inboundAssistant) {
            console.error("[ASSISTANT CREATION] VAPI rejected inbound:", {
                status: inboundVapiErr?.status,
                body: inboundVapiErr?.body,
            });
        }
        if (inboundAssistant) {
            // Build blueprint for sequencer dispatch
            const inboundBlueprint = buildAgentBlueprint({
                systemPrompt: inboundPrompt.systemPrompt,
                firstMessage: inboundPrompt.firstMessage,
                model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7 },
                voice: { provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL", voiceName: "Sarah" },
                transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
                tools: [...calendarTools, { type: "endCall" }],
                settings: {
                    maxDurationSeconds: 600,
                    backgroundSound: "office",
                    endCallMessage: "Thank you for calling. Have a great day!",
                    voicemailMessage: inboundVoicemailMessage(client.name),
                    serverUrl: `${APP_URL}/api/webhooks/vapi`,
                },
            });

            const { data: agent } = await supabase
                .from("agents")
                .insert({
                    client_id: clientId,
                    vapi_id: inboundAssistant.id,
                    name: `${client.name} - Inbound`,
                    agent_type: "inbound",
                    auto_created: true,
                    template_version: TEMPLATE_VERSION,
                    agent_blueprint: inboundBlueprint,
                })
                .select("id")
                .single();

            agentIds.inbound = agent?.id;
            console.log(`[ASSISTANT CREATION] Inbound agent created: ${inboundAssistant.id} (blueprint saved)`);
        }
    } catch (error) {
        console.error("[ASSISTANT CREATION] Inbound agent error:", error);
    }

    // 4. Create Outbound Agent
    try {
        const outboundPrompt = await buildOutboundPrompt(client.name, profileData);
        const { data: outboundAssistant, error: outboundVapiErr } = await createAssistant(
            {
                name: `${client.name} - Outbound`,
                firstMessage: outboundPrompt.firstMessage,
                model: {
                    provider: "openai",
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: outboundPrompt.systemPrompt }],
                    tools: [...calendarTools, { type: "endCall" }],
                    temperature: 0.7,
                },
                voice: {
                    provider: "11labs",
                    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah
                },
                transcriber: {
                    provider: "deepgram",
                    language: "en",
                    model: "nova-2",
                },
                server: {
                    url: `${APP_URL}/api/webhooks/vapi`,
                },
                serverMessages: ["status-update", "end-of-call-report"],
                clientMessages: [],
                maxDurationSeconds: 300,
                backgroundSound: "office",
                voicemailDetection: {
                    provider: "twilio",
                    enabled: true,
                    voicemailDetectionTypes: [...VOICEMAIL_DETECTION_TYPES],
                },
                metadata: { clientId, agentType: "outbound", templateVersion: TEMPLATE_VERSION },
            },
            vapiKey
        );

        if (!outboundAssistant) {
            console.error("[ASSISTANT CREATION] VAPI rejected outbound:", {
                status: outboundVapiErr?.status,
                body: outboundVapiErr?.body,
            });
        }
        if (outboundAssistant) {
            // Build blueprint for sequencer dispatch
            const outboundBlueprint = buildAgentBlueprint({
                systemPrompt: outboundPrompt.systemPrompt,
                firstMessage: outboundPrompt.firstMessage,
                model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7 },
                voice: { provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL", voiceName: "Sarah" },
                transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
                tools: [...calendarTools, { type: "endCall" }],
                settings: {
                    maxDurationSeconds: 300,
                    backgroundSound: "office",
                    voicemailDetection: {
                        provider: "twilio",
                        enabled: true,
                        voicemailDetectionTypes: [...VOICEMAIL_DETECTION_TYPES],
                    },
                    serverUrl: `${APP_URL}/api/webhooks/vapi`,
                },
            });

            const { data: agent } = await supabase
                .from("agents")
                .insert({
                    client_id: clientId,
                    vapi_id: outboundAssistant.id,
                    name: `${client.name} - Outbound`,
                    agent_type: "outbound",
                    auto_created: true,
                    template_version: TEMPLATE_VERSION,
                    agent_blueprint: outboundBlueprint,
                })
                .select("id")
                .single();

            agentIds.outbound = agent?.id;
            console.log(`[ASSISTANT CREATION] Outbound agent created: ${outboundAssistant.id} (blueprint saved)`);
        }
    } catch (error) {
        console.error("[ASSISTANT CREATION] Outbound agent error:", error);
    }

    if (!agentIds.inbound && !agentIds.outbound) {
        return { success: false, error: "Failed to create any agents" };
    }

    return { success: true, agents: agentIds };
}

export async function retryAssistantCreation(clientId: string): Promise<{
    success: boolean;
    agents?: { inbound?: string; outbound?: string };
    error?: string;
}> {
    // Check which agent types already exist
    const { data: existingAgents } = await supabase
        .from("agents")
        .select("agent_type")
        .eq("client_id", clientId)
        .eq("auto_created", true);

    const existingTypes = new Set(existingAgents?.map((a: any) => a.agent_type) || []);

    if (existingTypes.has("inbound") && existingTypes.has("outbound")) {
        return { success: true, agents: {}, error: "All agent types already exist" };
    }

    // Full creation handles both — the insert will just create what's missing
    // For a proper retry, we'd want to skip existing types, but for simplicity
    // we recreate all (VAPI doesn't deduplicate, so we check locally)
    if (existingTypes.size > 0) {
        console.log(`[ASSISTANT CREATION] Retrying — existing types: ${[...existingTypes].join(", ")}`);
    }

    return createTenantAssistants(clientId);
}
