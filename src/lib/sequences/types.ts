// Framework-agnostic input types for the sequence core functions.
// Kept free of `server-only` so client components / forms can import the types.

export type RevalidateFn = (path: string) => void;

export interface CoreOpts {
    /** Optional Next.js revalidatePath, injected by the server-action adapters. */
    revalidate?: RevalidateFn;
}

export interface CreateSequenceInput {
    name: string;
    description?: string | null;
    trigger_type?: string;
    urgency_tier?: string;
    /** Already-parsed object (the FormData adapter parses the JSON string). */
    trigger_conditions?: any | null;
    generation_mode?: string; // "static" | "dynamic"
    max_touchpoints?: number;
    agentId?: string | null;
    /**
     * Enable the call-aware SMS auto-reply chatbot for this sequence. When
     * omitted, it defaults to true if an outbound agent is bound (the agent's
     * SMS persona drives replies), false otherwise.
     */
    enable_chatbot_mode?: boolean;
}

export interface UpdateSequenceInput {
    name?: string;
    description?: string | null;
    trigger_type?: string;
    urgency_tier?: string;
    trigger_conditions?: any;
    /** Re-bind (or unbind) the outbound agent that drives voice + SMS. */
    agentId?: string | null;
}

export interface StepInput {
    channel: string; // "sms" | "email" | "voice"
    delay_minutes?: number;
    delay_type?: string;
    content?: any | null;
    skip_conditions?: any | null;
    on_success?: any | null;
    on_failure?: any | null;
    enable_ai_mutation?: boolean;
    mutation_instructions?: string | null;
}

export type UpdateStepInput = Partial<StepInput>;

export interface CoreResult {
    success: boolean;
    error?: string;
    [k: string]: any;
}
