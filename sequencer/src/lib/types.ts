/**
 * Type definitions for the sequencer engine
 * Mirrors the database schema from type-b-schema.sql
 */

// ═══════════════════════════════════════════════════════════════════
// VAPI Umbrella Types
// ═══════════════════════════════════════════════════════════════════

export interface VapiUmbrella {
    id: string;
    name: string;
    umbrella_type: 'shared' | 'dedicated';
    vapi_api_key_encrypted: string;
    vapi_org_id: string | null;
    concurrency_limit: number;
    current_concurrency: number;
    max_tenants: number | null;
    is_active: boolean;
    last_webhook_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TenantVapiAssignment {
    id: string;
    tenant_id: string;
    umbrella_id: string;
    assigned_at: string;
    assigned_by: string | null;
    tenant_concurrency_cap: number | null;
    priority_weight: number;
    is_active: boolean;
    created_at: string;
}

export interface UmbrellaMapping {
    umbrellaId: string;
    umbrellaType: 'shared' | 'dedicated';
    vapiApiKey: string;
    vapiOrgId: string | null;
    concurrencyLimit: number;
    tenantCap: number | null;
    priorityWeight: number;
}

// ═══════════════════════════════════════════════════════════════════
// Tenant Types
// ═══════════════════════════════════════════════════════════════════

export interface TenantProfile {
    id: string;
    tenant_id: string;
    industry: string;
    sub_industry: string | null;
    service_area: {
        cities?: string[];
        zip_codes?: string[];
        radius_miles?: number;
    } | null;
    timezone: string;
    job_types: Array<{
        name: string;
        urgency_tier: 'critical' | 'high' | 'medium' | 'low';
        avg_ticket: number;
        keywords: string[];
    }>;
    brand_voice: 'casual' | 'professional' | 'friendly';
    custom_phrases: {
        always_mention?: string[];
        never_say?: string[];
    } | null;
    business_hours: {
        weekdays?: { start: string; end: string };
        saturday?: { start: string; end: string };
        sunday?: { start: string; end: string };
        emergency_24_7?: boolean;
    } | null;
    primary_goal: string | null;
    lead_sources: Array<{
        source: string;
        urgency_multiplier: number;
        connected: boolean;
    }> | null;
    onboarding_transcript: any;
    onboarding_completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TenantTwilioAccount {
    id: string;
    tenant_id: string;
    account_type: 'type_a_byoa' | 'type_b_subaccount';
    subaccount_sid: string | null;
    auth_token_encrypted: string | null;
    external_account_sid: string | null;
    messaging_service_sid: string | null;
    friendly_name: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Sequence Types
// ═══════════════════════════════════════════════════════════════════

export type UrgencyTier = 'critical' | 'high' | 'medium' | 'low';
export type ChannelType = 'sms' | 'email' | 'voice';
export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'replied' | 'booked' | 'failed' | 'manual_stop';

export type MutationAggressiveness = 'conservative' | 'moderate' | 'aggressive';

export interface Sequence {
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    trigger_conditions: {
        lead_source?: string[];
        job_type_keywords?: string[];
        urgency_tier?: UrgencyTier;
        custom_field_matches?: Record<string, any>;
    };
    urgency_tier: UrgencyTier;
    max_attempts: number;
    sequence_timeout_hours: number;
    respect_business_hours: boolean;
    generated_by_ai: boolean;
    generation_prompt: any;
    is_active: boolean;
    // Phase 3: Adaptive Mutation
    enable_adaptive_mutation: boolean;
    mutation_aggressiveness: MutationAggressiveness;
    created_at: string;
    updated_at: string;
}

export interface SequenceStep {
    id: string;
    sequence_id: string;
    step_order: number;
    channel: ChannelType;
    delay_seconds: number;
    delay_type: 'after_previous' | 'after_enrollment' | 'specific_time';
    specific_time: string | null;
    content: SmsContent | EmailContent | VoiceContent;
    skip_conditions: {
        skip_if?: string[];
        only_if?: string[];
        time_window?: { not_before: string; not_after: string };
    } | null;
    on_success: { action: 'continue' | 'jump_to_step' | 'end_sequence'; target_step?: number } | null;
    on_failure: { action: 'retry_after_seconds' | 'skip' | 'end_sequence'; retry_delay?: number } | null;
    // Phase 3: Adaptive Mutation
    enable_ai_mutation: boolean;
    mutation_instructions: string | null;
    created_at: string;
}

export interface SmsContent {
    body: string;
}

export interface EmailContent {
    subject: string;
    body_html: string;
    body_text: string;
}

export interface VoiceContent {
    vapi_assistant_id?: string;
    first_message: string;
    system_prompt: string;
    transfer_number?: string;
}

export interface SequenceEnrollment {
    id: string;
    tenant_id: string;
    sequence_id: string;
    contact_id: string;
    status: EnrollmentStatus;
    current_step_order: number;
    enrolled_at: string;
    next_step_at: string | null;
    completed_at: string | null;
    total_attempts: number;
    calls_made: number;
    sms_sent: number;
    emails_sent: number;
    contact_replied: boolean;
    contact_answered_call: boolean;
    appointment_booked: boolean;
    enrollment_source: string | null;
    custom_variables: Record<string, any>;
    created_at: string;
    updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Job Payloads (for BullMQ queues)
// ═══════════════════════════════════════════════════════════════════

export interface SmsJobPayload {
    tenantId: string;
    contactPhone: string;
    body: string;
    enrollmentId: string;
    stepId: string;
}

export interface EmailJobPayload {
    tenantId: string;
    contactEmail: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    enrollmentId: string;
    stepId: string;
}

export interface VapiJobPayload {
    tenantId: string;
    contactPhone: string;
    assistantConfig: VoiceContent;
    enrollmentId: string;
    stepId: string;
    urgencyPriority: number;
    retryCount?: number;
}

export interface EventJobPayload {
    type: 'call-outcome' | 'sms-reply' | 'sms-delivery' | 'email-opened' | 'email-clicked' | 'email-bounced';
    tenantId: string;
    umbrellaId?: string;
    enrollmentId?: string;
    stepId?: string;
    // Type-specific fields
    callId?: string;
    duration?: number;
    disposition?: string;
    transcript?: string;
    appointmentBooked?: boolean;
    messageBody?: string;
    deliveryStatus?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Contact Types
// ═══════════════════════════════════════════════════════════════════

export interface Contact {
    id: string;
    client_id: string;
    phone: string;
    email: string | null;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    total_calls: number;
    last_call_at: string | null;
    conversation_summary: string | null;
    custom_fields: Record<string, any> | null;
    created_at: string;
    updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Contact Interaction Types (Cross-Channel Memory)
// ═══════════════════════════════════════════════════════════════════

export type InteractionChannel = 'sms' | 'email' | 'voice';
export type InteractionDirection = 'outbound' | 'inbound';
export type InteractionOutcome =
    | 'delivered' | 'replied' | 'answered' | 'voicemail'
    | 'no_answer' | 'bounced' | 'opened' | 'clicked' | 'failed';
export type InteractionSentiment =
    | 'positive' | 'negative' | 'neutral' | 'objection' | 'interested' | 'confused';
export type InteractionIntent =
    | 'interested' | 'not_interested' | 'stop' | 'reschedule' | 'question' | 'unknown';

export interface ContactInteraction {
    id: string;
    client_id: string;
    contact_id: string;
    enrollment_id: string | null;
    step_id: string | null;

    channel: InteractionChannel;
    direction: InteractionDirection;

    content_body: string | null;
    content_subject: string | null;
    content_summary: string | null;

    outcome: InteractionOutcome | null;
    sentiment: InteractionSentiment | null;
    intent: InteractionIntent | null;

    call_duration_seconds: number | null;
    call_disposition: string | null;
    appointment_booked: boolean;
    objections_raised: string[] | null;
    key_topics: string[] | null;

    provider_id: string | null;
    created_at: string;

    // Phase 2: Emotional Intelligence
    emotional_analysis: EmotionalAnalysis | Record<string, any> | null;
    engagement_score: number | null;
}

export interface ConversationContext {
    // Last interaction (any channel)
    last_interaction: {
        channel: InteractionChannel;
        direction: InteractionDirection;
        summary: string;
        outcome: string | null;
        time_ago: string;
        created_at: string;
    } | null;

    // Last call details
    last_call: {
        summary: string;
        disposition: string | null;
        duration_seconds: number | null;
        objections: string[];
        key_topics: string[];
        transcript_excerpt: string;
        was_answered: boolean;
    } | null;

    // Last SMS reply from contact
    last_sms_reply: {
        body: string;
        intent: string | null;
        sentiment: string | null;
        time_ago: string;
    } | null;

    // Last email details
    last_email: {
        subject: string | null;
        status: string | null;
    } | null;

    // Aggregate counts
    interaction_count: {
        total: number;
        calls: number;
        sms: number;
        emails: number;
        inbound: number;
        outbound: number;
    };

    // Computed
    overall_sentiment: InteractionSentiment;
    objections_history: string[];
    key_topics_history: string[];
    days_since_first_contact: number;
    last_channel_used: InteractionChannel | null;
    appointment_discussed: boolean;

    // Formatted timeline for voice agent injection
    formatted_timeline: string;

    // Last emotional analysis (from EI layer, Phase 2)
    last_emotional_analysis: EmotionalAnalysis | null;
}

// ═══════════════════════════════════════════════════════════════════
// Emotional Intelligence Types
// ═══════════════════════════════════════════════════════════════════

export type PrimaryEmotion =
    | 'excited' | 'interested' | 'neutral' | 'hesitant'
    | 'frustrated' | 'confused' | 'angry' | 'dismissive';

export type ObjectionType =
    | 'price' | 'timing' | 'competitor' | 'authority' | 'need' | 'trust' | 'urgency';

export type ObjectionSeverity = 'mild' | 'moderate' | 'strong';

export type BuyingSignalStrength = 'weak' | 'moderate' | 'strong';

export type UrgencyLevel = 'immediate' | 'soon' | 'flexible' | 'no_rush' | 'lost';

export type RecommendedAction =
    | 'escalate_to_human' | 'continue_sequence' | 'pause_and_notify'
    | 'fast_track' | 'end_sequence' | 'switch_channel' | 'address_objection';

export type RecommendedTone =
    | 'empathetic' | 'urgent' | 'casual' | 'professional' | 'reassuring';

export type SentimentTrend = 'warming' | 'stable' | 'cooling' | 'hot' | 'cold';

export interface DetectedObjection {
    type: ObjectionType;
    detail: string;
    severity: ObjectionSeverity;
}

export interface BuyingSignal {
    signal: string;
    strength: BuyingSignalStrength;
}

export interface EmotionalAnalysis {
    // Core emotions
    primary_emotion: PrimaryEmotion;
    emotion_confidence: number; // 0-1

    // Intent (replaces old classifyReplyIntent)
    intent: InteractionIntent | 'objection' | 'ready_to_buy' | 'needs_info';

    // Objections detected
    objections: DetectedObjection[];

    // Buying signals
    buying_signals: BuyingSignal[];

    // Urgency
    urgency_level: UrgencyLevel;

    // Action recommendation
    recommended_action: RecommendedAction;
    recommended_channel: ChannelType | 'any';
    recommended_tone: RecommendedTone;
    action_reason: string;

    // Flags
    needs_human_intervention: boolean;
    is_hot_lead: boolean;
    is_at_risk: boolean;
}

export interface TenantNotification {
    id: string;
    client_id: string;
    enrollment_id: string | null;
    contact_id: string | null;
    type: 'hot_lead' | 'needs_human' | 'objection_detected' | 'sentiment_drop' | 'appointment_booked' | 'sequence_completed' | 'escalation' | 'at_risk';
    title: string;
    body: string | null;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    read: boolean;
    read_at: string | null;
    dismissed: boolean;
    metadata: Record<string, any>;
    created_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Adaptive Mutation Types (Phase 3)
// ═══════════════════════════════════════════════════════════════════

export interface MutationResult {
    content: SmsContent | EmailContent | VoiceContent;
    reason: string;
    confidence: number; // 0-1
    model: string;
}

export interface StepMutation {
    id: string;
    enrollment_id: string;
    step_id: string;
    client_id: string;
    original_content: SmsContent | EmailContent | VoiceContent;
    mutated_content: SmsContent | EmailContent | VoiceContent;
    mutation_reason: string | null;
    mutation_model: string;
    confidence_score: number;
    aggressiveness: MutationAggressiveness;
    resulted_in_reply: boolean;
    resulted_in_conversion: boolean;
    created_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Self-Healing Types (Phase 4)
// ═══════════════════════════════════════════════════════════════════

export type FailureType =
    | 'sms_undelivered' | 'sms_failed'
    | 'email_bounced' | 'email_spam'
    | 'call_no_answer' | 'call_busy' | 'call_failed' | 'capacity_exhausted'
    | 'invalid_number' | 'landline_detected'
    | 'invalid_email' | 'no_contact_method';

export type HealingActionType =
    | 'switch_channel' | 'retry_alternative' | 'skip_and_advance'
    | 'inject_fallback_sms' | 'extend_delay' | 'end_sequence'
    | 'mark_invalid' | 'override_channel' | 'use_alternative_contact';

export type PhoneType = 'mobile' | 'landline' | 'voip' | 'unknown';

export interface HealingAction {
    type: HealingActionType;
    details: {
        new_channel?: ChannelType;
        new_content?: SmsContent | EmailContent | VoiceContent;
        new_phone?: string;
        new_email?: string;
        delay_seconds?: number;
        reason: string;
    };
}

export interface FailureContext {
    enrollmentId: string;
    stepId: string;
    clientId: string;
    contactId: string;
    step: SequenceStep;
    enrollment: SequenceEnrollment;
    contact: Contact;
    failureType: FailureType;
    errorDetails: any;
    failureHistory: FailureRecord[];
}

export interface FailureRecord {
    channel: ChannelType;
    failure_type: FailureType;
    step_order: number;
    timestamp: string;
}

export interface HealingLogEntry {
    id: string;
    enrollment_id: string;
    step_id: string | null;
    client_id: string;
    failure_type: FailureType;
    failure_details: any;
    healing_action: HealingActionType;
    healing_details: any;
    healing_succeeded: boolean | null;
    created_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Outcome-Based Learning Types (Phase 5)
// ═══════════════════════════════════════════════════════════════════

export type SuggestionType =
    | 'remove_step' | 'add_step' | 'change_channel' | 'change_timing'
    | 'change_content' | 'reorder_steps' | 'split_test' | 'merge_sequences'
    | 'enable_mutation' | 'adjust_aggressiveness';

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'auto_applied' | 'expired';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type ConversionType = 'booked' | 'replied' | 'answered' | 'clicked';

export interface StepAnalytics {
    id: string;
    step_id: string;
    sequence_id: string;
    client_id: string;

    total_executions: number;
    total_delivered: number;
    total_failed: number;
    total_replies: number;
    total_conversions: number;

    reply_rate: number;
    conversion_rate: number;
    delivery_rate: number;
    avg_response_time_seconds: number;

    attributed_conversions: number;
    attribution_score: number;

    optimal_send_hour: number | null;
    optimal_send_day: number | null;
    hourly_response_rates: Record<string, number>;

    mutated_executions: number;
    mutated_conversions: number;
    mutated_conversion_rate: number;

    total_cost: number;
    cost_per_conversion: number;

    period_start: string;
    period_end: string;
    created_at: string;
    updated_at: string;
}

export interface SequenceAnalytics {
    id: string;
    sequence_id: string;
    client_id: string;

    total_enrollments: number;
    total_completions: number;
    total_conversions: number;
    total_opt_outs: number;

    completion_rate: number;
    conversion_rate: number;
    reply_rate: number;
    opt_out_rate: number;

    avg_time_to_conversion_hours: number;
    avg_steps_to_conversion: number;

    total_cost: number;
    cost_per_conversion: number;
    cost_per_enrollment: number;

    channel_effectiveness: Record<string, { sent: number; replied: number; rate: number }>;

    total_healed: number;
    healing_success_rate: number;

    period_start: string;
    period_end: string;
    created_at: string;
    updated_at: string;
}

export interface OptimizationSuggestion {
    id: string;
    sequence_id: string;
    client_id: string;
    suggestion_type: SuggestionType;
    title: string;
    description: string;
    expected_improvement: number | null;
    confidence: ConfidenceLevel;
    suggested_change: Record<string, any>;
    target_step_id: string | null;
    evidence: Record<string, any>;
    status: SuggestionStatus;
    accepted_at: string | null;
    dismissed_at: string | null;
    applied_result: Record<string, any> | null;
    created_at: string;
}

export interface StepVariant {
    id: string;
    step_id: string;
    sequence_id: string;
    client_id: string;
    variant_name: string;
    content: SmsContent | EmailContent | VoiceContent;
    traffic_weight: number;
    total_sent: number;
    total_replies: number;
    total_conversions: number;
    reply_rate: number;
    conversion_rate: number;
    is_winner: boolean;
    p_value: number | null;
    confidence_interval: { lower: number; upper: number } | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface IndustryBenchmark {
    id: string;
    industry: string;
    avg_conversion_rate: number;
    avg_reply_rate: number;
    avg_opt_out_rate: number;
    avg_time_to_conversion_hours: number;
    avg_steps_to_conversion: number;
    avg_cost_per_conversion: number;
    channel_benchmarks: Record<string, { reply_rate: number }>;
    optimal_step_count: number | null;
    optimal_sequence_duration_hours: number | null;
    top_channel_order: ChannelType[];
    sample_size: number;
    tenant_count: number;
    period_start: string;
    period_end: string;
}

export interface AttributionResult {
    enrollmentId: string;
    convertingStepId: string;
    conversionType: ConversionType;
    timeToConversionSeconds: number;
    stepAttributions: Array<{
        stepId: string;
        stepOrder: number;
        channel: ChannelType;
        weight: number;      // 0-1, multi-touch attribution weight
        touchType: 'first' | 'middle' | 'last' | 'only';
    }>;
}

export interface TimingRecommendation {
    stepId: string;
    currentHour: number | null;
    recommendedHour: number;
    recommendedDay: number;
    expectedImprovement: number;
    sampleSize: number;
}
