const VAPI_BASE_URL = 'https://api.vapi.ai';

// In a real multi-tenant app, this key would be fetched from the DB based on the logged-in client.
// For this MVP/Test, we use the env var which holds the "Test Type A" key.
const DEFAULT_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;

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
    startedAt: string;
    endedAt?: string;
    cost?: number;
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
        temperature?: number;
    };
    voice?: {
        provider: string;
        voiceId: string;
    };
    transcriber?: {
        provider: string;
        language?: string;
        model?: string;
    };
    server?: {
        url: string;
    };
    maxDurationSeconds?: number;
    backgroundSound?: string;
    endCallMessage?: string;
    voicemailMessage?: string;
    voicemailDetection?: any;
    metadata?: Record<string, any>;
    firstMessageMode?: string;
}

export async function createAssistant(
    payload: CreateAssistantPayload,
    apiKey?: string
): Promise<VapiAgent | null> {
    const token = apiKey || DEFAULT_KEY;
    if (!token) return null;

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            console.error("Failed to create assistant:", await res.text());
            return null;
        }

        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error (createAssistant):", error);
        return null;
    }
}

// ─── LIST AGENTS ───

export async function listAgents(apiKey?: string): Promise<VapiAgent[]> {
    const token = apiKey || DEFAULT_KEY;
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
    const token = apiKey || DEFAULT_KEY;
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
 * End/terminate an active call
 * Uses DELETE request to /call/{id} endpoint
 */
export async function endCall(callId: string, apiKey?: string): Promise<boolean> {
    const token = apiKey || DEFAULT_KEY;
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
    const token = apiKey || DEFAULT_KEY;
    if (!token) return null;

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
            console.error("Failed to update agent", await res.text());
            return null;
        }
        return await res.json();
    } catch (error) {
        console.error("Vapi Client Error:", error);
        return null;
    }
}

export async function listCalls(apiKey?: string, assistantId?: string): Promise<VapiCall[]> {
    const token = apiKey || DEFAULT_KEY;
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

export async function listPhoneNumbers(apiKey?: string): Promise<VapiPhoneNumber[]> {
    const key = apiKey || DEFAULT_KEY;
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
    // API endpoint for listing voices is currently not publicly documented or 404s.
    // Returning a curated list of supported voices from Vapi, ElevenLabs, and PlayHT.

    const fallbackVoices: VapiVoice[] = [
        // Vapi / 11Labs Curated
        { id: "v1", orgId: "builtin", name: "Rachel", provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" },
        { id: "v2", orgId: "builtin", name: "Sarah", provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL" },
        { id: "v3", orgId: "builtin", name: "Nova", provider: "11labs", voiceId: "flq6f7yk4E4fJM5XTYuZ" },
        { id: "v5", orgId: "builtin", name: "Clyde", provider: "11labs", voiceId: "2EiwWnXFnvU5JabPnv8n" },
        { id: "v6", orgId: "builtin", name: "Mimi", provider: "11labs", voiceId: "zrHiDhphv9ZnVXBqCLjf" },
        { id: "v7", orgId: "builtin", name: "Fin", provider: "11labs", voiceId: "D38z5RcWu1voky8WS1ja" },
        { id: "v8", orgId: "builtin", name: "Antoni", provider: "11labs", voiceId: "ErXwobaYiN019PkySvjV" },
        { id: "v9", orgId: "builtin", name: "Thomas", provider: "11labs", voiceId: "GBv7mTt5XypW72uTnlsJ" },
        { id: "v10", orgId: "builtin", name: "Charlie", provider: "11labs", voiceId: "IKne3meq5aSn9XLyUdCD" },
        { id: "v11", orgId: "builtin", name: "George", provider: "11labs", voiceId: "JBFqnCBsd6RMkjVDRZzb" },
        { id: "v12", orgId: "builtin", name: "Emily", provider: "11labs", voiceId: "LcfcDJNUP1GQjkzn1xUU" },
        { id: "v13", orgId: "builtin", name: "Elli", provider: "11labs", voiceId: "MF3mGyEYCl7XYWbV9V6O" },
        { id: "v14", orgId: "builtin", name: "Callum", provider: "11labs", voiceId: "N2lVS1w4EjpYW751KB27" },
        { id: "v15", orgId: "builtin", name: "Patrick", provider: "11labs", voiceId: "ODq5zmih8GrVes37Dizd" },
        { id: "v16", orgId: "builtin", name: "Harry", provider: "11labs", voiceId: "SOYHLrjzK2X1ezoPC6Cr" },
        { id: "v17", orgId: "builtin", name: "Liam", provider: "11labs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
        { id: "v18", orgId: "builtin", name: "Dorothy", provider: "11labs", voiceId: "ThT5KcBeYPX3keUQqHPh" },
        { id: "v19", orgId: "builtin", name: "Josh", provider: "11labs", voiceId: "TxGEqnHWrfWFTfGW9XjX" },
        { id: "v20", orgId: "builtin", name: "Arnold", provider: "11labs", voiceId: "VR6AewLTigWg4xSOukaG" },
        { id: "v21", orgId: "builtin", name: "Charlotte", provider: "11labs", voiceId: "XB0fDUnXU5powFXDhCwa" },
        { id: "v22", orgId: "builtin", name: "Matilda", provider: "11labs", voiceId: "XrExE9yKIg1WjnnlVkGX" },
        { id: "v23", orgId: "builtin", name: "James", provider: "11labs", voiceId: "ZQe5CZNOzWyzPSCn5a3c" },
        { id: "v24", orgId: "builtin", name: "Joseph", provider: "11labs", voiceId: "Zlb1dXrM653N07WRdFW3" },
        { id: "v25", orgId: "builtin", name: "Jeremy", provider: "11labs", voiceId: "bVMeCyTHyQQzRYoxJux8" },
        { id: "v26", orgId: "builtin", name: "Michael", provider: "11labs", voiceId: "6p7lBvQemFVs0evd2JOY" },
        { id: "v27", orgId: "builtin", name: "Ethan", provider: "11labs", voiceId: "g5CIjZEefAph4nQFvHAz" },
        { id: "v28", orgId: "builtin", name: "Gigi", provider: "11labs", voiceId: "jBpfuIE2acCO8z3wKNLl" },
        { id: "v29", orgId: "builtin", name: "Freya", provider: "11labs", voiceId: "jsCqWAovK2LkecY7zXl4" },
        { id: "v30", orgId: "builtin", name: "Grace", provider: "11labs", voiceId: "oWAxZDx7w5VEj9dCyTzz" },
        { id: "v31", orgId: "builtin", name: "Daniel", provider: "11labs", voiceId: "onwK4e9ZLuTAKqWW03F9" },
        { id: "v32", orgId: "builtin", name: "Serena", provider: "11labs", voiceId: "pMsXgVXv3BLzUgSXRplE" },
        { id: "v33", orgId: "builtin", name: "Adam", provider: "11labs", voiceId: "pNInz6obpgDQGcFmaJgB" },
        { id: "v34", orgId: "builtin", name: "Nicole", provider: "11labs", voiceId: "piTKgcLEGmPE4e6mEKli" },
        { id: "v35", orgId: "builtin", name: "Jessie", provider: "11labs", voiceId: "t0jbNlBVZ17f02VwhZDE" },
        { id: "v36", orgId: "builtin", name: "Ryan", provider: "11labs", voiceId: "wViXBPUzp2ZZj7Z1Zm36" },
        { id: "v37", orgId: "builtin", name: "Sam", provider: "11labs", voiceId: "yoZ06aMxZJJ28mfd3POQ" },
        { id: "v38", orgId: "builtin", name: "Glinda", provider: "11labs", voiceId: "z9fAny952GXov8kFbZ_D" },

        // OpenAI
        { id: "oa1", orgId: "builtin", name: "Alloy (OpenAI)", provider: "openai", voiceId: "alloy" },
        { id: "oa2", orgId: "builtin", name: "Echo (OpenAI)", provider: "openai", voiceId: "echo" },
        { id: "oa3", orgId: "builtin", name: "Fable (OpenAI)", provider: "openai", voiceId: "fable" },
        { id: "oa4", orgId: "builtin", name: "Onyx (OpenAI)", provider: "openai", voiceId: "onyx" },
        { id: "oa5", orgId: "builtin", name: "Nova (OpenAI)", provider: "openai", voiceId: "nova" },
        { id: "oa6", orgId: "builtin", name: "Shimmer (OpenAI)", provider: "openai", voiceId: "shimmer" },

        // PlayHT
        { id: "ph1", orgId: "builtin", name: "Jennifer (PlayHT)", provider: "playht", voiceId: "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json" },
        { id: "ph2", orgId: "builtin", name: "William (PlayHT)", provider: "playht", voiceId: "s3://voice-cloning-zero-shot/b936eR8-32a7-47G6-b0eF-dd6I0f59414e/male-cs/manifest.json" },
    ];

    return fallbackVoices;
}
