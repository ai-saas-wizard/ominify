// ─── VERTICAL SYSTEM TYPES ───

/**
 * Definition for a targeted industry vertical.
 * Each vertical is a pre-built, battle-tested onboarding path
 * with static prompt templates and pre-configured agents.
 */
export interface VerticalDefinition {
    id: string;
    name: string;
    description: string;
    icon: string; // lucide icon name
    tagline: string;
    badge: string;
    formSections: VerticalFormSection[];
    agents: VerticalAgentDef[];
}

export interface VerticalFormSection {
    id: string;
    title: string;
    description?: string;
    fields: VerticalFormFieldDef[];
}

export interface VerticalFormFieldDef {
    key: string;
    label: string;
    type:
        | "text"
        | "email"
        | "textarea"
        | "select"
        | "single-select"
        | "multi-select"
        | "phone"
        | "timezone";
    required: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
    defaultValue?: string;
    helpText?: string;
}

export interface VerticalAgentDef {
    id: string;
    name: string;
    direction: "inbound" | "outbound";
    category: "inbound" | "outbound_follow_up" | "outbound_marketing" | "outbound_retention";
    description: string;
    icon: string;
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
    startSpeakingPlan?: {
        waitSeconds: number;
        smartEndpointingPlan?: {
            provider: string;
            waitFunction?: string;
        };
    };
    stopSpeakingPlan?: {
        numWords: number;
    };
    endCallPhrases: string[];
}

// ─── VERTICAL FORM DATA ───

/**
 * Data collected from the vertical onboarding form.
 * This is the generic shape — each vertical uses the same structure
 * but collects different fields via its definition.
 */
export interface VerticalFormData {
    verticalId: string;
    // Collected fields stored as key-value pairs
    fields: Record<string, string | string[]>;
}

/**
 * Typed form data specific to Real Estate Investor vertical.
 * Used by prompt builders and deployment actions.
 */
export interface REInvestorFormData {
    companyName: string;
    ownerName: string;
    ownerEmail: string;
    agentPersonaName: string;
    markets: string;
    dealTypes: string[];
    timezone: string;
    appointmentType: string;
    transferPhone: string;
    businessPhone: string;
}

// ─── VALIDATION ───

export interface VerticalValidationError {
    field: string;
    message: string;
    severity: "error" | "warning";
}

export interface VerticalValidationResult {
    valid: boolean;
    errors: VerticalValidationError[];
}
