// ─── TENANT PROFILE ───

export interface TenantProfile {
    industry: string;
    sub_industry: string;
    business_description: string;
    website: string;
    service_area: { cities: string[]; zip_codes: string[]; radius_miles: number };
    job_types: { name: string; urgency_tier: string; avg_ticket: string; keywords: string }[];
    typical_job_value: string;
    brand_voice: string;
    custom_phrases: string;
    greeting_style: string;
    timezone: string;
    business_hours: Record<string, { open: string; close: string; closed: boolean }>;
    after_hours_behavior: string;
    emergency_phone: string;
    lead_sources: string[];
    primary_goal: string;
    qualification_criteria: string;
}

// ─── AI ANALYSIS ───

export interface AIFieldMeta {
    confidence: "high" | "medium" | "low";
    aiGenerated: boolean;
    userEdited: boolean;
}

export interface AIAnalysisResult {
    success: boolean;
    profile: Partial<TenantProfile> | null;
    fieldMeta: Record<string, AIFieldMeta>;
    error?: string;
}

// ─── ONBOARDING STEP ───

export interface OnboardingStep {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
}

// ─── COMPONENT PROPS ───

export interface OnboardingWizardProps {
    clientId: string;
    clientName: string;
    initialProfile: Record<string, unknown> | null;
}

export interface StepProps {
    form: TenantProfile;
    fieldMeta: Record<string, AIFieldMeta>;
    updateField: <K extends keyof TenantProfile>(field: K, value: TenantProfile[K]) => void;
    resetFieldToAI: (field: keyof TenantProfile) => void;
}
