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
    type: 'call-outcome' | 'sms-reply' | 'sms-delivery' | 'email-opened' | 'email-clicked';
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
    created_at: string;
    updated_at: string;
}
