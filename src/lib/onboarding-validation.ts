import type { TenantProfile } from "@/components/onboarding/types";

// ─── TYPES ───

export type FieldTier = "agent_critical" | "recommended" | "optional";

export interface ValidationError {
    field: string;
    message: string;
    tier: FieldTier;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}

// ─── VALIDATE PROFILE ───

export function validateProfile(form: TenantProfile): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Agent-critical fields (block deployment if empty)
    if (!form.industry || form.industry.trim() === "") {
        errors.push({ field: "industry", message: "Industry is required for agent configuration", tier: "agent_critical" });
    }
    if (!form.business_description || form.business_description.trim().length < 10) {
        errors.push({ field: "business_description", message: "Business description must be at least 10 characters", tier: "agent_critical" });
    }
    if (!form.brand_voice || form.brand_voice.trim() === "") {
        errors.push({ field: "brand_voice", message: "Brand voice is required for agent personality", tier: "agent_critical" });
    }
    if (!form.timezone || form.timezone.trim() === "") {
        errors.push({ field: "timezone", message: "Timezone is required for scheduling", tier: "agent_critical" });
    }
    if (!form.primary_goal || form.primary_goal.trim() === "") {
        errors.push({ field: "primary_goal", message: "Primary goal is required for agent behavior", tier: "agent_critical" });
    }

    // Business hours: at least one day must be open
    const hoursResult = validateBusinessHours(form.business_hours);
    if (hoursResult.allClosed) {
        errors.push({ field: "business_hours", message: "At least one business day must have hours set", tier: "agent_critical" });
    }
    for (const day of hoursResult.invalidRanges) {
        errors.push({ field: "business_hours", message: `${day}: closing time must be after opening time`, tier: "agent_critical" });
    }

    // Conditional: emergency_phone required if after_hours_behavior is emergency_forward
    if (form.after_hours_behavior === "emergency_forward") {
        if (!form.emergency_phone || form.emergency_phone.trim() === "") {
            errors.push({ field: "emergency_phone", message: "Emergency phone is required when forwarding after-hours calls", tier: "agent_critical" });
        } else {
            const phoneResult = validatePhoneNumber(form.emergency_phone);
            if (!phoneResult.valid) {
                errors.push({ field: "emergency_phone", message: phoneResult.error!, tier: "agent_critical" });
            }
        }
    }

    // Recommended fields (show warnings, don't block)
    if (!form.job_types || form.job_types.length === 0) {
        warnings.push({ field: "job_types", message: "Adding job types helps agents understand your services", tier: "recommended" });
    }
    if (!form.service_area?.cities || form.service_area.cities.length === 0) {
        warnings.push({ field: "service_area", message: "Adding service cities helps agents with location context", tier: "recommended" });
    }
    if (!form.greeting_style || form.greeting_style.trim() === "") {
        warnings.push({ field: "greeting_style", message: "A greeting style helps agents sound consistent", tier: "recommended" });
    }
    if (!form.lead_sources || form.lead_sources.length === 0) {
        warnings.push({ field: "lead_sources", message: "Selecting lead sources helps with lead tracking", tier: "recommended" });
    }

    return { valid: errors.length === 0, errors, warnings };
}

// ─── VALIDATE PHONE NUMBER ───

export function validatePhoneNumber(phone: string): { valid: boolean; formatted: string; error?: string } {
    if (!phone || phone.trim() === "") {
        return { valid: true, formatted: "" };
    }

    const cleaned = phone.replace(/[^\d+]/g, "");
    const match = cleaned.match(/^\+?1?(\d{10})$/);

    if (!match) {
        return {
            valid: false,
            formatted: phone,
            error: "Please enter a valid 10-digit US phone number",
        };
    }

    return { valid: true, formatted: `+1${match[1]}` };
}

// ─── VALIDATE BUSINESS HOURS ───

export function validateBusinessHours(
    hours: Record<string, { open: string; close: string; closed: boolean }>
): { allClosed: boolean; invalidRanges: string[] } {
    const entries = Object.entries(hours);
    const allClosed = entries.every(([, h]) => h.closed);
    const invalidRanges: string[] = [];

    for (const [day, h] of entries) {
        if (!h.closed && h.open && h.close && h.open >= h.close) {
            invalidRanges.push(day);
        }
    }

    return { allClosed, invalidRanges };
}

// ─── SANITIZE FOR PROMPT ───

const FIELD_MAX_LENGTHS: Record<string, number> = {
    business_description: 2000,
    greeting_style: 500,
};

export function sanitizeForPrompt(text: string, field?: string): string {
    if (!text) return text;

    let sanitized = text;

    // Strip template markers that could break prompt structure
    sanitized = sanitized.replace(/\{\{.*?\}\}/g, "");

    // Collapse excessive whitespace
    sanitized = sanitized.replace(/\s{3,}/g, "  ");

    // Truncate if field has a max length
    if (field && FIELD_MAX_LENGTHS[field]) {
        sanitized = sanitized.slice(0, FIELD_MAX_LENGTHS[field]);
    }

    return sanitized.trim();
}
