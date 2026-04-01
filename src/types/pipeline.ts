// ─── Pipeline Types ────────────────────────────────────────────────────────

export interface Pipeline {
    id: string;
    client_id: string;
    name: string;
    description: string | null;
    color: string;
    is_default: boolean;
    position: number;
    created_at: string;
    updated_at: string;
    contact_count?: number;
}

export interface PipelineStage {
    id: string;
    client_id: string;
    pipeline_id: string;
    name: string;
    color: string;
    position: number;
    is_default: boolean;
    is_terminal: boolean;
    created_at: string;
}

export interface PipelineContact {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    pipeline_contact_id: string;
    stage_id: string | null;
    moved_at: string | null;
    moved_by: string | null;
    engagement_score: number | null;
    sentiment_trend: string | null;
    conversation_summary: string | null;
    last_call_at: string | null;
    total_calls: number;
    custom_fields: Record<string, any>;
    created_at: string;
    enrollment: {
        id: string;
        status: string;
        source: string;
        sequence_name: string | null;
    } | null;
}

export interface PipelineStageRule {
    id: string;
    stage_id: string;
    sequence_id: string;
    sequence_name?: string;
    conditions: Record<string, any>;
    priority: number;
    is_active: boolean;
    created_at: string;
}

export interface PipelineAssignmentRule {
    id: string;
    pipeline_id: string;
    conditions: Record<string, any>;
    priority: number;
    is_active: boolean;
    created_at: string;
}

export interface PipelineAutomation {
    id: string;
    client_id: string;
    trigger_pipeline_id: string;
    trigger_stage_id: string;
    target_pipeline_id: string;
    target_stage_id: string | null;
    is_active: boolean;
    created_at: string;
    trigger_pipeline_name?: string;
    trigger_stage_name?: string;
    target_pipeline_name?: string;
    target_stage_name?: string;
}

export interface PipelineContactHistory {
    id: string;
    pipeline_contact_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    moved_by: string;
    moved_at: string;
    from_stage_name?: string;
    to_stage_name?: string;
}

export interface ClientApiKey {
    id: string;
    client_id: string;
    key_prefix: string;
    name: string | null;
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
}

// ─── Rule Condition Types ──────────────────────────────────────────────────

export type ConditionOperator = "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";

export interface RuleCondition {
    field: string;
    operator: ConditionOperator;
    value: any;
}
