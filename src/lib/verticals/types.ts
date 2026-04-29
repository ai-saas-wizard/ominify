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
 * Outbound agent goal options for Real Estate vertical.
 * Each goal maps to a starter system prompt that the user can edit during onboarding.
 */
export type REOutboundGoal =
    | "re_engage_prior_offer"
    | "cold_outreach_motivated_seller"
    | "missed_appointment_followup"
    | "custom";

/**
 * VAPI transfer modes we surface to onboarding.
 * - warm-summary: warm-transfer-wait-for-operator-to-speak-first-and-then-say-summary
 *                 (LLM briefs the operator before connecting the seller)
 * - cold: blind-transfer (connect immediately, no summary)
 */
export type TransferMode = "warm-summary" | "cold";

/**
 * Per-direction transfer specialist configuration.
 * Drives the transferCall tool's name (`${firstName.toLowerCase()}_transfer`),
 * destination phone, and transferPlan mode.
 */
export interface TransferSpecialist {
    firstName: string;          // e.g. "Gary" — used to derive `gary_transfer` tool name
    role: string;               // e.g. "lead manager" — surfaced in tool description + summary briefing
    phone: string;              // E.164 destination
    mode: TransferMode;
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
    businessPhone: string;
    // Per-agent transfer specialists. Inbound is collected on the main form;
    // outbound on the dedicated outbound-config phase so users can configure
    // each independently (e.g. inbound → owner; outbound → lead manager).
    inboundTransfer: TransferSpecialist;
    outboundTransfer: TransferSpecialist;
    // Outbound agent config (collected on a separate phase, not via formSections)
    outboundGoal: REOutboundGoal;
    outboundScenario: string;   // optional free-text scenario description for AI generation
    outboundPrompt: string;
    outboundFirstMessage: string;
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
