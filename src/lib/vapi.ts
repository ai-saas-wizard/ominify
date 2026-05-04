import "server-only";

const VAPI_BASE_URL = 'https://api.vapi.ai';

// Every VAPI call must explicitly pass an apiKey resolved from the tenant's
// encrypted credentials via getClientVapiKey() (CUSTOM clients) or the umbrella
// key (UMBRELLA clients). There is no fallback: if a caller doesn't have a key,
// the call returns empty/null. The previous `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
// fallback was removed because a) NEXT_PUBLIC_ env vars ship to the browser,
// and b) a "default" write-capable key is a cross-tenant footgun.

export interface VapiAgent {
    id: string;
    name: string;
    orgId: string;
    voice?: {
        voiceId: string;
        provider: string;
    };
    model?: {
        model: string;
        provider: string;
        systemPrompt?: string;
        messages?: any[];
    };
    createdAt: string;
    updatedAt: string;
}

export interface VapiCall {
    id: string;
    assistantId: string;
    customer?: {
        number: string;
    };
    status: string;
    endedReason?: string;
    transcript?: string;
    recordingUrl?: string;
    analysis?: {
        summary?: string;
        structuredData?: any;
    };
    messages?: Array<{
        role: string;
        message: string;
        time?: number;
    }>;
    startedAt?: string;
    endedAt?: string;
    cost?: number;
    type?: string;
    durationSeconds?: number;
}

// ─── CREATE ASSISTANT ───

export interface CreateAssistantPayload {
    name: string;
    firstMessage?: string;
    model: {
        provider: string;
        model: string;
        messages: Array<{ role: string; content: string }>;
        tools?: any[];
        toolIds?: string[];
        temperature?: number;
        maxTokens?: number;
    };
    voice?: {
        provider: string;
        voiceId: string;
        model?: string;
        speed?: number;
        style?: number;
        stability?: number;
        similarityBoost?: number;
        useSpeakerBoost?: boolean;
    };
    transcriber?: {
        provider: string;
        language?: string;
        model?: string;
        numerals?: boolean;
    };
    server?: {
        url: string;
        timeoutSeconds?: number;
    };
    maxDurationSeconds?: number;
    backgroundSound?: string;
    endCallMessage?: string;
    voicemailMessage?: string;
    voicemailDetection?: any;
    metadata?: Record<string, any>;
    firstMessageMode?: string;
    recordingEnabled?: boolean;
    endCallFunctionEnabled?: boolean;
    endCallPhrases?: string[];
    dialKeypadFunctionEnabled?: boolean;
    messagePlan?: {
        idleMessages?: string[];
    };
    startSpeakingPlan?: {
        waitSeconds?: number;
        smartEndpointingPlan?: {
            provider?: string;
            waitFunction?: string;
        };
    };
    stopSpeakingPlan?: {
        numWords?: number;
        backoffSeconds?: number;
    };
    clientMessages?: string[];
    serverMessages?: string[];
    compliancePlan?: {
        hipaaEnabled?: boolean;
        pciEnabled?: boolean;
    };
    analysisPlan?: {
        summaryPrompt?: string;
        structuredDataSchema?: Record<string, any>;
        structuredDataPrompt?: string;
        successEvaluationPrompt?: string;
        successEvaluationRubric?: string;
        minMessagesThreshold?: number;
    };
    artifactPlan?: {
        structuredOutputIds?: string[];
        recordingEnabled?: boolean;
        videoRecordingEnabled?: boolean;
    };
}

export interface CreateAssistantResult {
    data: VapiAgent | null;
    error?: { status: number; body: string };
}

// VAPI rejects assistant names > 40 chars. Clip server-side as a final guard
// so a long companyName + suffix doesn't take down the wizard.
const MAX_ASSISTANT_NAME_LEN = 40;

export async function createAssistant(
    payload: CreateAssistantPayload,
    apiKey?: string
): Promise<CreateAssistantResult> {
    const token = apiKey;
    if (!token) {
        return {
            data: null,
            error: { status: 0, body: "No VAPI API key available" },
        };
    }

    const safePayload =
        payload.name && payload.name.length > MAX_ASSISTANT_NAME_LEN
            ? { ...payload, name: payload.name.slice(0, MAX_ASSISTANT_NAME_LEN) }
            : payload;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(safePayload),
        });

        if (!res.ok) {
            const body = await res.text();
            console.error("Failed to create assistant:", res.status, body);
            return { data: null, error: { status: res.status, body } };
        }

        return { data: await res.json() };
    } catch (error: any) {
        console.error("Vapi Client Error (createAssistant):", error);
        return {
            data: null,
            error: { status: 0, body: error?.message ?? "network error" },
        };
    }
}

// ─── LIST AGENTS ───

export async function listAgents(apiKey?: string): Promise<VapiAgent[]> {
    const token = apiKey;
    if (!token) return [];

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            next: { revalidate: 0 } // No cache for now
        } as any);

        if (!res.ok) {
            console.error("Failed to fetch agents", await res.text());
            return [];
        }

        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error:", error);
        return [];
    }
}

/**
 * Get org ID from agents list (used internally for syncing)
 */
export function getOrgIdFromAgents(agents: VapiAgent[]): string | null {
    if (agents.length > 0 && agents[0].orgId) {
        return agents[0].orgId;
    }
    return null;
}

export async function getAgent(id: string, apiKey?: string): Promise<VapiAgent | null> {
    const token = apiKey;
    if (!token) return null;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant/${id}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            next: { revalidate: 0 }
        } as any);

        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error:", error);
        return null;
    }
}

/**
 * Fetch a single call by ID from VAPI. Used to backfill missing timestamps
 * for rows where our webhook didn't capture `startedAt`/`endedAt`.
 */
export async function getCall(callId: string, apiKey?: string): Promise<VapiCall | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            next: { revalidate: 0 },
        } as any);
        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        console.error('Vapi Client Error (getCall):', error);
        return null;
    }
}

/**
 * End/terminate an active call
 * Uses DELETE request to /call/{id} endpoint
 */
export async function endCall(callId: string, apiKey?: string): Promise<boolean> {
    const token = apiKey;
    if (!token) return false;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            console.error("Failed to end call:", await res.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error("Vapi Client Error (endCall):", error);
        return false;
    }
}

export async function updateAgent(id: string, data: Partial<VapiAgent>, apiKey?: string): Promise<VapiAgent | null> {
    const token = apiKey;
    if (!token) {
        console.error("updateAgent: No VAPI API key available");
        return null;
    }

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant/${id}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Failed to update agent (${res.status}):`, errorText);
            return null;
        }
        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error:", error);
        return null;
    }
}

export async function listCalls(apiKey?: string, assistantId?: string): Promise<VapiCall[]> {
    const token = apiKey;
    if (!token) return [];

    try {
        // Fetch calls with high limit - Vapi returns up to 1000
        let url = `${VAPI_BASE_URL}/call?limit=1000`;
        if (assistantId) {
            url += `&assistantId=${assistantId}`;
        }

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            next: { revalidate: 30 }
        } as any);

        if (!res.ok) {
            console.error("Vapi API error:", res.status, await res.text());
            return [];
        }

        const data = await res.json();

        // Vapi returns an array of calls
        if (Array.isArray(data)) {
            return data;
        } else if (data.results && Array.isArray(data.results)) {
            return data.results;
        }

        return [];
    } catch (error) {
        console.error("Vapi Client Error:", error);
        return [];
    }
}
export interface VapiPhoneNumber {
    id: string;
    orgId: string;
    assistantId?: string;
    number: string;
    createdAt: string;
    updatedAt: string;
    name?: string;
    provider: string; // 'vapi' | 'twilio' | 'vonage'
}

// ─── IMPORT PHONE NUMBER ───

export interface ImportPhoneNumberPayload {
    twilioPhoneNumber: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    name?: string;
    assistantId?: string;
    serverUrl?: string;
}

export async function importPhoneNumber(
    payload: ImportPhoneNumberPayload,
    apiKey?: string
): Promise<{ data: VapiPhoneNumber | null; error?: string }> {
    const token = apiKey;
    if (!token) return { data: null, error: "No VAPI API key available" };

    try {
        const res = await fetch(`${VAPI_BASE_URL}/phone-number/import`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errorBody = await res.text();
            console.error("Failed to import phone number:", res.status, errorBody);
            return { data: null, error: `VAPI error (${res.status}): ${errorBody}` };
        }

        return { data: await res.json() };
    } catch (error: any) {
        console.error("Vapi Client Error (importPhoneNumber):", error);
        return { data: null, error: error.message || "Network error calling VAPI" };
    }
}

// ─── UPDATE PHONE NUMBER ───

export async function updatePhoneNumber(
    phoneNumberId: string,
    payload: { assistantId?: string | null; name?: string; serverUrl?: string },
    apiKey?: string
): Promise<VapiPhoneNumber | null> {
    const token = apiKey;
    if (!token) return null;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/phone-number/${phoneNumberId}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            console.error("Failed to update phone number:", await res.text());
            return null;
        }

        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error (updatePhoneNumber):", error);
        return null;
    }
}

// ─── DELETE PHONE NUMBER ───

export async function deleteVapiPhoneNumber(
    phoneNumberId: string,
    apiKey?: string
): Promise<boolean> {
    const token = apiKey;
    if (!token) return false;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/phone-number/${phoneNumberId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            console.error("Failed to delete phone number:", await res.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error("Vapi Client Error (deleteVapiPhoneNumber):", error);
        return false;
    }
}

// ─── LIST PHONE NUMBERS ───

export async function listPhoneNumbers(apiKey?: string): Promise<VapiPhoneNumber[]> {
    const key = apiKey;
    if (!key) return [];

    try {
        const res = await fetch(`${VAPI_BASE_URL}/phone-number`, {
            headers: {
                "Authorization": `Bearer ${key}`
            }
        });

        if (!res.ok) {
            return [];
        }

        return await res.json();
    } catch (error) {
        console.error("Error listing phone numbers:", error);
        return [];
    }
}

export interface VapiVoice {
    id: string;
    orgId: string;
    name: string;
    provider: string;
    model?: string;
    voiceId: string;
    gender?: string;
    accent?: string;
    previewUrl?: string;
}

export async function listVoices(apiKey?: string): Promise<VapiVoice[]> {
    const { VOICES } = await import("@/lib/voices");

    return VOICES.map((v, i) => ({
        id: `v${i + 1}`,
        orgId: "builtin",
        name: v.name,
        provider: v.provider,
        voiceId: v.voiceId,
        previewUrl: v.previewUrl,
    }));
}

// ─── REUSABLE TOOLS (VAPI /tool) ───
// Tools created here live in the VAPI account and can be referenced by any
// assistant via `model.toolIds`. Lets us define a tool once per umbrella
// instead of inlining identical JSON into every assistant's payload.

export interface VapiTool {
    id: string;
    orgId?: string;
    type: string;
    function?: {
        name?: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
    server?: { url: string; timeoutSeconds?: number };
    messages?: unknown[];
    createdAt?: string;
    updatedAt?: string;
}

export async function createTool(
    payload: Record<string, unknown>,
    apiKey: string
): Promise<VapiTool | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/tool`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            console.error("Failed to create tool:", res.status, await res.text());
            return null;
        }
        return (await res.json()) as VapiTool;
    } catch (error) {
        console.error("Vapi Client Error (createTool):", error);
        return null;
    }
}

export async function getTool(
    id: string,
    apiKey: string
): Promise<VapiTool | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/tool/${id}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) return null;
        return (await res.json()) as VapiTool;
    } catch (error) {
        console.error("Vapi Client Error (getTool):", error);
        return null;
    }
}

export async function listTools(apiKey: string): Promise<VapiTool[]> {
    if (!apiKey) return [];
    try {
        const res = await fetch(`${VAPI_BASE_URL}/tool`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? (data as VapiTool[]) : [];
    } catch (error) {
        console.error("Vapi Client Error (listTools):", error);
        return [];
    }
}

export async function deleteTool(
    id: string,
    apiKey: string
): Promise<boolean> {
    if (!apiKey) return false;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/tool/${id}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        return res.ok;
    } catch (error) {
        console.error("Vapi Client Error (deleteTool):", error);
        return false;
    }
}

// ─── STRUCTURED OUTPUTS (VAPI /structured-output) ───
// Created once per VAPI org and attached to assistants via
// `artifactPlan.structuredOutputIds`. Result lands at
// `call.artifact.structuredOutputs[id].result` on the end-of-call webhook.

export interface VapiStructuredOutput {
    id: string;
    orgId?: string;
    name: string;
    description?: string;
    type?: "ai" | "regex";
    schema?: Record<string, any>;
    assistantIds?: string[];
    workflowIds?: string[];
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateStructuredOutputPayload {
    name: string;
    description?: string;
    schema: Record<string, any>;
    type?: "ai" | "regex";
    assistantIds?: string[];
    workflowIds?: string[];
}

export async function createStructuredOutput(
    payload: CreateStructuredOutputPayload,
    apiKey: string
): Promise<VapiStructuredOutput | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/structured-output`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ type: "ai", ...payload }),
        });
        if (!res.ok) {
            console.error(
                "Failed to create structured output:",
                res.status,
                await res.text()
            );
            return null;
        }
        return (await res.json()) as VapiStructuredOutput;
    } catch (error) {
        console.error("Vapi Client Error (createStructuredOutput):", error);
        return null;
    }
}

export async function getStructuredOutput(
    id: string,
    apiKey: string
): Promise<VapiStructuredOutput | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/structured-output/${id}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) return null;
        return (await res.json()) as VapiStructuredOutput;
    } catch (error) {
        console.error("Vapi Client Error (getStructuredOutput):", error);
        return null;
    }
}

export async function updateStructuredOutput(
    id: string,
    payload: Partial<CreateStructuredOutputPayload>,
    apiKey: string
): Promise<VapiStructuredOutput | null> {
    if (!apiKey) return null;
    try {
        const res = await fetch(`${VAPI_BASE_URL}/structured-output/${id}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            console.error(
                "Failed to update structured output:",
                res.status,
                await res.text()
            );
            return null;
        }
        return (await res.json()) as VapiStructuredOutput;
    } catch (error) {
        console.error("Vapi Client Error (updateStructuredOutput):", error);
        return null;
    }
}
