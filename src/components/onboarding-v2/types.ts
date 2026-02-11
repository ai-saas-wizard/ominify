import type {
    AgentTypeId,
    AgentCategory,
    OverrideVariableDefinition,
    SuggestedAgent,
} from "@/lib/agent-catalog";
import type { AIFieldMeta } from "@/components/onboarding/types";

// ─── ONBOARDING V2 STATE ───

export type OnboardingV2Phase =
    | "url_input"
    | "analyzing"
    | "marketplace"
    | "deploying"
    | "success";

export interface OnboardingV2State {
    phase: OnboardingV2Phase;
    websiteUrl: string;
    businessName: string;
    industry: string;
    tenantProfile: Record<string, unknown> | null;
    suggestedAgents: SuggestedAgent[];
    chatMessages: ChatMessage[];
    deploymentProgress: DeploymentProgress | null;
}

// ─── AI ANALYSIS V2 RESULT ───

export interface AIAnalysisV2Result {
    success: boolean;
    profile: Record<string, unknown> | null;
    fieldMeta: Record<string, AIFieldMeta>;
    agentSuggestions: SuggestedAgent[];
    businessName: string;
    industry: string;
    error?: string;
}

// ─── CHAT ───

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    function_calls?: FunctionCallResult[];
    timestamp: string;
}

export interface FunctionCallResult {
    function_name: string;
    arguments: Record<string, unknown>;
    result: string;
}

export interface AgentModification {
    modification_id: string;
    agent_type_id: string;
    modification_type: "create" | "update" | "remove" | "enable" | "disable";
    changes: Record<string, unknown>;
    timestamp: string;
}

// ─── DEPLOYMENT ───

export interface DeploymentProgress {
    totalAgents: number;
    completedAgents: number;
    currentAgent: string | null;
    steps: DeploymentStep[];
    error: string | null;
}

export interface DeploymentStep {
    id: string;
    agentTypeId: string;
    label: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    substeps: DeploymentSubstep[];
}

export interface DeploymentSubstep {
    label: string;
    status: "pending" | "in_progress" | "completed" | "failed";
}

export interface DeploymentResult {
    success: boolean;
    agents: DeployedAgent[];
    error?: string;
}

export interface DeployedAgent {
    type_id: string;
    name: string;
    agent_id: string | null;
    vapi_id: string | null;
    sequence_id: string | null;
    error: string | null;
}

// ─── COMPONENT PROPS ───

export interface OnboardingV2WizardProps {
    clientId: string;
    clientName: string;
    initialProfile: Record<string, unknown> | null;
}

// Re-export for convenience
export type { AgentTypeId, AgentCategory, OverrideVariableDefinition, SuggestedAgent, AIFieldMeta };
