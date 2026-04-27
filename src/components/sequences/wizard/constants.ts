import type { GoalCard, WizardStep, HandoffTrigger } from "./types";

// ─── WIZARD STEPS ───

export const WIZARD_STEPS: WizardStep[] = [
    { label: "Goal", description: "What do you want to achieve?" },
    { label: "Channels", description: "How should we reach them?" },
    { label: "Handoff", description: "When should we hand it to you?" },
    { label: "Preview", description: "Watch your AI in action" },
];

// ─── GOAL CARDS ───

export const GOAL_CARDS: GoalCard[] = [
    {
        id: "missed_call_followup",
        title: "Follow up on missed calls",
        description: "Reach leads who called but didn't connect",
        icon: "phone-missed",
        defaults: {
            trigger_type: "missed_call",
            urgency_tier: "high",
            cadence: 4,
            duration: 2,
            success_conditions: ["appointment_booked"],
        },
    },
    {
        id: "dormant_reengagement",
        title: "Re-engage dormant leads",
        description: "Win back leads who went cold",
        icon: "user-round-search",
        defaults: {
            trigger_type: "manual",
            urgency_tier: "medium",
            cadence: 2,
            duration: 4,
            success_conditions: ["interest_expressed"],
        },
    },
    {
        id: "new_lead_nurture",
        title: "Nurture new leads",
        description: "Build relationship with fresh inbound leads",
        icon: "sprout",
        defaults: {
            trigger_type: "new_lead",
            urgency_tier: "medium",
            cadence: 3,
            duration: 3,
            success_conditions: ["appointment_booked", "interest_expressed"],
        },
    },
    {
        id: "post_appointment",
        title: "Post-appointment follow-up",
        description: "Stay top-of-mind after a visit or estimate",
        icon: "calendar-check",
        defaults: {
            trigger_type: "status_change",
            urgency_tier: "low",
            cadence: 1,
            duration: 4,
            success_conditions: ["next_steps_agreed"],
        },
    },
    {
        id: "win_back_quotes",
        title: "Win back lost quotes",
        description: "Re-engage leads who got a quote but didn't convert",
        icon: "receipt",
        defaults: {
            trigger_type: "manual",
            urgency_tier: "medium",
            cadence: 2,
            duration: 3,
            success_conditions: ["pricing_requested"],
        },
    },
    {
        id: "meta_ads_lead",
        title: "Meta Ads new lead",
        description: "Auto-enroll leads from Facebook & Instagram Lead Ads",
        icon: "megaphone",
        requires: "meta_ads",
        // Native Meta App Review pending — flip off once approved.
        comingSoon: true,
        defaults: {
            trigger_type: "meta_ads_lead",
            urgency_tier: "high",
            cadence: 4,
            duration: 2,
            success_conditions: ["appointment_booked", "interest_expressed"],
        },
    },
    {
        id: "google_ads_lead",
        title: "Google Ads new lead",
        description: "Auto-enroll leads from Google Lead Form Assets",
        icon: "target",
        requires: "google_ads",
        defaults: {
            trigger_type: "google_ads_lead",
            urgency_tier: "high",
            cadence: 4,
            duration: 2,
            success_conditions: ["appointment_booked", "interest_expressed"],
        },
    },
    {
        id: "custom",
        title: "Custom goal",
        description: "Describe what you want to achieve",
        icon: "pencil-line",
        defaults: {
            trigger_type: "manual",
            urgency_tier: "medium",
            cadence: 3,
            duration: 3,
            success_conditions: ["appointment_booked"],
        },
    },
];

// ─── SUCCESS CONDITIONS ───

export const SUCCESS_CONDITIONS = [
    { id: "appointment_booked", label: "When they book an appointment", example: '"Thursday morning works"' },
    { id: "interest_expressed", label: "When they express interest", example: '"Yeah I\'d like to know more"' },
    { id: "pricing_requested", label: "When they ask for a quote/pricing", example: '"How much for a full remodel?"' },
    { id: "next_steps_agreed", label: "When they agree to next steps", example: '"Sure, send me the details"' },
];

// ─── CADENCE LABELS ───

export const CADENCE_LABELS: Record<number, string> = {
    1: "Gentle",
    2: "Light",
    3: "Moderate",
    4: "Active",
    5: "Persistent",
};

// ─── DURATION OPTIONS ───

export const DURATION_OPTIONS = [
    { value: 1, label: "1 week" },
    { value: 2, label: "2 weeks" },
    { value: 3, label: "3 weeks" },
    { value: 4, label: "4 weeks" },
    { value: 6, label: "6 weeks" },
    { value: 8, label: "8 weeks" },
];

// ─── AFTER-SEQUENCE OPTIONS ───

export const AFTER_SEQUENCE_OPTIONS = [
    { value: "mark_cold", label: "Mark as cold" },
    { value: "reengage_weeks", label: "Re-engage automatically" },
    { value: "notify_personal", label: "Notify me to follow up personally" },
];

// ─── INDUSTRY HANDOFF PRESETS ───

export const INDUSTRY_HANDOFF_PRESETS: Record<string, HandoffTrigger[]> = {
    home_services: [
        { type: "preset", id: "in_person_estimate", label: "They need an in-person estimate or measurement" },
        { type: "preset", id: "pricing_not_configured", label: "They ask about pricing I haven't configured" },
        { type: "preset", id: "emergency_work", label: "They mention emergency or urgent work" },
        { type: "preset", id: "commercial_work", label: "They ask about commercial (not residential) work" },
    ],
    healthcare: [
        { type: "preset", id: "medical_symptoms", label: "They describe symptoms or medical concerns" },
        { type: "preset", id: "insurance_coverage", label: "They ask about insurance coverage" },
        { type: "preset", id: "reschedule_existing", label: "They need to reschedule an existing appointment" },
    ],
    general: [
        { type: "preset", id: "discount_request", label: "They ask for a discount or coupon code" },
        { type: "preset", id: "competitor_mention", label: "They mention a competitor" },
        { type: "preset", id: "complaint", label: "They have a complaint about past service" },
        { type: "preset", id: "specific_person", label: "They request a specific person by name" },
    ],
};

// ─── MAP INDUSTRY TO PRESET GROUPS ───

export function getHandoffPresetsForIndustry(industry: string): HandoffTrigger[] {
    const presets: HandoffTrigger[] = [];
    if (industry === "home_services" || industry === "automotive") {
        presets.push(...INDUSTRY_HANDOFF_PRESETS.home_services);
    } else if (industry === "healthcare") {
        presets.push(...INDUSTRY_HANDOFF_PRESETS.healthcare);
    }
    presets.push(...INDUSTRY_HANDOFF_PRESETS.general);
    return presets;
}
