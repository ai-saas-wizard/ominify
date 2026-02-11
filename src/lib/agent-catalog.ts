// ═══════════════════════════════════════════════════════════
// AGENT CATALOG
// Central registry of all agent types Omnify supports.
// Each definition includes prompting metadata, sequence
// templates, override variables, and recommendation weights.
// ═══════════════════════════════════════════════════════════

// ─── TYPES ───

export type AgentCategory =
    | "inbound"
    | "outbound_follow_up"
    | "outbound_marketing"
    | "outbound_retention";

export type AgentTypeId =
    | "inbound_receptionist"
    | "lead_follow_up"
    | "appointment_reminder"
    | "no_show_recovery"
    | "review_collector"
    | "win_back_caller"
    | "lead_qualifier"
    | "upsell_cross_sell"
    | "event_promo_announcer"
    | "survey_collector"
    | "referral_requester";

export interface OverrideVariableDefinition {
    name: string;
    description: string;
    default_value: string;
    example: string;
}

export interface SequenceStepTemplate {
    step_order: number;
    channel: "sms" | "email" | "voice";
    delay_minutes: number;
    delay_type: "fixed_delay" | "after_previous";
    content_purpose: string;
    enable_ai_mutation: boolean;
    skip_conditions: {
        skip_if?: string[];
        only_if?: string[];
    } | null;
    on_success: { action: "continue" | "end_sequence" } | null;
    on_failure: { action: "retry_after_seconds" | "skip"; retry_delay?: number } | null;
}

export interface SequenceTemplate {
    name_template: string;
    description_template: string;
    trigger_type: "manual" | "webhook" | "form_submission" | "appointment_event" | "time_based";
    urgency_tier: "critical" | "high" | "medium" | "low";
    respect_business_hours: boolean;
    enable_adaptive_mutation: boolean;
    mutation_aggressiveness: "conservative" | "moderate" | "aggressive";
    steps: SequenceStepTemplate[];
}

export interface AgentTypeDefinition {
    type_id: AgentTypeId;
    name: string;
    description: string;
    long_description: string;
    icon: string;
    category: AgentCategory;
    always_enabled: boolean;
    applicable_industries: string[] | "all";
    confidence_weight: number;
    required_tools: ("check_availability" | "book_appointment" | "endCall" | "transferCall")[];
    suggested_voice_id: string;
    suggested_voice_name: string;
    default_max_duration_seconds: number;
    override_variables: OverrideVariableDefinition[];
    sequence_template: SequenceTemplate | null;
    background_sound: string;
    voicemail_detection: boolean;
}

export interface SuggestedAgent {
    type_id: AgentTypeId | string;
    name: string;
    description: string;
    category: AgentCategory;
    enabled: boolean;
    confidence: number;
    confidence_label: "highly_recommended" | "recommended" | "optional";
    icon: string;
    voice_id: string;
    voice_name: string;
    sequence_summary: string | null;
    override_variables: OverrideVariableDefinition[];
    custom_instructions: string | null;
    is_custom: boolean;
}

// ─── CATALOG ───

export const AGENT_CATALOG: AgentTypeDefinition[] = [
    // ──────────────── 1. INBOUND RECEPTIONIST ────────────────
    {
        type_id: "inbound_receptionist",
        name: "Inbound Receptionist",
        description: "Handles all incoming calls, answers questions, and books appointments",
        long_description: "Your 24/7 virtual receptionist. Answers incoming calls with your brand voice, understands caller needs, checks appointment availability, books appointments, and transfers urgent calls to your team.",
        icon: "Phone",
        category: "inbound",
        always_enabled: true,
        applicable_industries: "all",
        confidence_weight: 1.0,
        required_tools: ["check_availability", "book_appointment", "endCall", "transferCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 600,
        override_variables: [
            { name: "customer_name", description: "Caller's name if known", default_value: "", example: "John Smith" },
            { name: "customer_context", description: "Previous interaction history", default_value: "New caller", example: "RETURNING CALLER: Last called about plumbing repair on Jan 15" },
        ],
        sequence_template: null,
        background_sound: "office",
        voicemail_detection: false,
    },

    // ──────────────── 2. LEAD FOLLOW-UP SPECIALIST ────────────────
    {
        type_id: "lead_follow_up",
        name: "Lead Follow-Up Specialist",
        description: "Calls new leads within 5 minutes of form submission",
        long_description: "Speed-to-lead is everything. This agent calls new leads within minutes, references the specific service they inquired about, qualifies their needs, and books an appointment. Uses a 5-step multi-channel sequence.",
        icon: "Zap",
        category: "outbound_follow_up",
        always_enabled: false,
        applicable_industries: "all",
        confidence_weight: 0.9,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 300,
        override_variables: [
            { name: "lead_source", description: "Where the lead came from", default_value: "your website", example: "Google Ads" },
            { name: "ad_campaign", description: "Specific ad campaign that generated the lead", default_value: "", example: "Summer HVAC Special" },
            { name: "form_submission_data", description: "What the lead submitted on the form", default_value: "", example: "Interested in AC installation, 3-bedroom house" },
            { name: "customer_name", description: "Lead's name from form", default_value: "", example: "Sarah Johnson" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Lead Follow-Up",
            description_template: "Automated follow-up sequence for new leads. Reaches out within minutes across multiple channels.",
            trigger_type: "webhook",
            urgency_tier: "critical",
            respect_business_hours: false,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "moderate",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 0,
                    delay_type: "fixed_delay",
                    content_purpose: "Immediate SMS introducing the business and letting the lead know a specialist will call them shortly. Mention their inquiry if known.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 5,
                    delay_type: "after_previous",
                    content_purpose: "First outbound call. Reference their inquiry, ask about needs, qualify, and try to book an appointment. Be warm and helpful.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "retry_after_seconds", retry_delay: 3600 },
                },
                {
                    step_order: 3,
                    channel: "sms",
                    delay_minutes: 1440,
                    delay_type: "after_previous",
                    content_purpose: "Follow-up SMS if call was not answered. Include a direct booking link or offer to call at a specific time.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 4,
                    channel: "email",
                    delay_minutes: 2880,
                    delay_type: "after_previous",
                    content_purpose: "Follow-up email with detailed service info, testimonials, and clear call-to-action to book.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 5,
                    channel: "voice",
                    delay_minutes: 4320,
                    delay_type: "after_previous",
                    content_purpose: "Final follow-up call. Reference previous attempts. Last effort to connect and assist.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied", "contact_answered_call"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 3. APPOINTMENT REMINDER ────────────────
    {
        type_id: "appointment_reminder",
        name: "Appointment Reminder",
        description: "Confirms upcoming appointments and reduces no-shows",
        long_description: "Proactively reaches out before scheduled appointments. SMS reminder 24 hours before, confirmation call 4 hours before. Handles rescheduling on the spot.",
        icon: "CalendarCheck",
        category: "outbound_follow_up",
        always_enabled: false,
        applicable_industries: ["home_services", "healthcare", "legal", "automotive", "professional_services"],
        confidence_weight: 0.85,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 180,
        override_variables: [
            { name: "appointment_date", description: "Date of the upcoming appointment", default_value: "your upcoming appointment", example: "January fifteenth" },
            { name: "appointment_time", description: "Time of the appointment", default_value: "", example: "two PM" },
            { name: "service_type", description: "Type of service booked", default_value: "your appointment", example: "AC maintenance" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Mrs. Johnson" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Appointment Reminder",
            description_template: "SMS reminder 24 hours before, voice confirmation 4 hours before.",
            trigger_type: "appointment_event",
            urgency_tier: "high",
            respect_business_hours: true,
            enable_adaptive_mutation: false,
            mutation_aggressiveness: "conservative",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 0,
                    delay_type: "fixed_delay",
                    content_purpose: "SMS reminder about tomorrow's appointment. Include date, time, service type, and option to reply to reschedule.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 1200,
                    delay_type: "after_previous",
                    content_purpose: "Confirmation call. Verify the customer is still planning to attend. Offer to reschedule if needed.",
                    enable_ai_mutation: false,
                    skip_conditions: { skip_if: ["contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 4. NO-SHOW RECOVERY ────────────────
    {
        type_id: "no_show_recovery",
        name: "No-Show Recovery",
        description: "Re-engages customers who missed their appointments",
        long_description: "When a customer doesn't show up, this agent reaches out to understand why and reschedule. Gentle SMS 30 min after, follow-up call 2 hours later, rebooking email at 24 hours.",
        icon: "UserX",
        category: "outbound_retention",
        always_enabled: false,
        applicable_industries: ["home_services", "healthcare", "legal", "automotive", "professional_services", "restaurant"],
        confidence_weight: 0.75,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 240,
        override_variables: [
            { name: "missed_appointment_date", description: "Date of the missed appointment", default_value: "today", example: "January fifteenth" },
            { name: "service_type", description: "Service that was booked", default_value: "your appointment", example: "dental cleaning" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Mr. Williams" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - No-Show Recovery",
            description_template: "Re-engagement after missed appointments. SMS, voice call, and email to reschedule.",
            trigger_type: "appointment_event",
            urgency_tier: "high",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "moderate",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 30,
                    delay_type: "fixed_delay",
                    content_purpose: "Gentle SMS checking in. 'We missed you today. Would you like to reschedule?' No blame, just helpful.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 120,
                    delay_type: "after_previous",
                    content_purpose: "Follow-up call to reschedule. Be understanding, ask if something came up, offer alternative times.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "retry_after_seconds", retry_delay: 7200 },
                },
                {
                    step_order: 3,
                    channel: "email",
                    delay_minutes: 1440,
                    delay_type: "after_previous",
                    content_purpose: "Email with easy rebooking link, available times, and a welcome-back note.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 5. REVIEW COLLECTOR ────────────────
    {
        type_id: "review_collector",
        name: "Review Collector",
        description: "Asks happy customers to leave Google reviews",
        long_description: "After service completion, reaches out to collect Google reviews. SMS at 3 days, personal call at 5 days, email at 7 days. Gauges satisfaction first and only asks for a review if the customer is happy.",
        icon: "Star",
        category: "outbound_marketing",
        always_enabled: false,
        applicable_industries: "all",
        confidence_weight: 0.8,
        required_tools: ["endCall"],
        suggested_voice_id: "jsCqWAovK2LkecY7zXl4",
        suggested_voice_name: "Freya",
        default_max_duration_seconds: 180,
        override_variables: [
            { name: "service_completed_date", description: "When the service was completed", default_value: "recently", example: "last Tuesday" },
            { name: "service_type", description: "What service was performed", default_value: "your recent service", example: "kitchen remodel" },
            { name: "review_link", description: "Direct link to Google review page", default_value: "", example: "https://g.page/r/..." },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Sarah" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Review Collection",
            description_template: "SMS, voice call, and email to collect Google reviews after service completion.",
            trigger_type: "manual",
            urgency_tier: "low",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "conservative",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 4320,
                    delay_type: "fixed_delay",
                    content_purpose: "Friendly SMS thanking them and asking if they'd share their experience with a Google review. Include review link.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 2880,
                    delay_type: "after_previous",
                    content_purpose: "Personal call to check satisfaction. If happy, ask for a Google review. If unhappy, listen and offer to resolve. Do NOT push if unhappy.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["contact_replied"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 3,
                    channel: "email",
                    delay_minutes: 2880,
                    delay_type: "after_previous",
                    content_purpose: "Final email with direct Google review link, thank-you message, and how reviews help the business.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "off",
        voicemail_detection: true,
    },

    // ──────────────── 6. WIN-BACK SPECIALIST ────────────────
    {
        type_id: "win_back_caller",
        name: "Win-Back Specialist",
        description: "Re-engages customers who haven't booked in 90+ days",
        long_description: "Identifies dormant customers and re-engages them with personalized outreach. References their last service, offers seasonal promotions or maintenance reminders. Multi-channel sequence over 7 days.",
        icon: "Heart",
        category: "outbound_retention",
        always_enabled: false,
        applicable_industries: ["home_services", "healthcare", "automotive", "restaurant", "retail", "professional_services"],
        confidence_weight: 0.7,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 240,
        override_variables: [
            { name: "last_service_date", description: "Date of their last service", default_value: "a while ago", example: "about six months ago" },
            { name: "last_service_type", description: "What service they last received", default_value: "your last service", example: "annual furnace inspection" },
            { name: "days_since_last_visit", description: "Number of days since last interaction", default_value: "", example: "120" },
            { name: "special_offer", description: "Any promotional offer to include", default_value: "", example: "15% off your next service" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Mike" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Win-Back Campaign",
            description_template: "Re-engagement sequence for dormant customers. Multi-channel over 7 days.",
            trigger_type: "time_based",
            urgency_tier: "medium",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "moderate",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 0,
                    delay_type: "fixed_delay",
                    content_purpose: "Re-engagement SMS. 'We miss you!' tone. Reference last service and mention it's time for maintenance. Include special offer if available.",
                    enable_ai_mutation: true,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 4320,
                    delay_type: "after_previous",
                    content_purpose: "Personal call to reconnect. Reference last service, ask if they need anything, mention seasonal relevance. Try to book appointment.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "retry_after_seconds", retry_delay: 14400 },
                },
                {
                    step_order: 3,
                    channel: "email",
                    delay_minutes: 5760,
                    delay_type: "after_previous",
                    content_purpose: "Email with maintenance tips relevant to their last service, testimonials, and returning-customer offer with booking link.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 7. LEAD QUALIFIER ────────────────
    {
        type_id: "lead_qualifier",
        name: "Lead Qualifier",
        description: "Pre-qualifies leads from ad sources before human follow-up",
        long_description: "Receives leads from Google Ads, Facebook, or other sources and makes an immediate qualification call. Asks about budget, timeline, needs, and service area. Qualified leads get fast-tracked; unqualified leads get a polite thank-you.",
        icon: "Filter",
        category: "outbound_follow_up",
        always_enabled: false,
        applicable_industries: ["home_services", "real_estate", "legal", "automotive", "professional_services"],
        confidence_weight: 0.8,
        required_tools: ["check_availability", "book_appointment", "endCall", "transferCall"],
        suggested_voice_id: "TxGEqnHWrfWFTfGW9XjX",
        suggested_voice_name: "Josh",
        default_max_duration_seconds: 300,
        override_variables: [
            { name: "lead_source", description: "Which ad platform generated the lead", default_value: "online", example: "Google Ads" },
            { name: "ad_campaign", description: "Specific campaign name", default_value: "", example: "Emergency Plumbing - Houston" },
            { name: "form_data", description: "Data from the lead form submission", default_value: "", example: "Looking for kitchen renovation, budget $20K-$30K" },
            { name: "customer_name", description: "Lead's name", default_value: "", example: "David Chen" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Lead Qualification",
            description_template: "Immediate lead qualification. Voice call within minutes of lead submission.",
            trigger_type: "webhook",
            urgency_tier: "critical",
            respect_business_hours: false,
            enable_adaptive_mutation: false,
            mutation_aggressiveness: "conservative",
            steps: [
                {
                    step_order: 1,
                    channel: "voice",
                    delay_minutes: 2,
                    delay_type: "fixed_delay",
                    content_purpose: "Immediate qualification call. Introduce yourself, reference their inquiry, ask about needs, timeline, budget. Determine qualification. If qualified, book or transfer. If not, thank politely.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "retry_after_seconds", retry_delay: 1800 },
                },
                {
                    step_order: 2,
                    channel: "sms",
                    delay_minutes: 30,
                    delay_type: "after_previous",
                    content_purpose: "Follow-up SMS if call was not answered. Brief introduction and offer to call at a better time.",
                    enable_ai_mutation: false,
                    skip_conditions: { skip_if: ["contact_answered_call", "appointment_booked"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 8. UPSELL SPECIALIST ────────────────
    {
        type_id: "upsell_cross_sell",
        name: "Upsell Specialist",
        description: "Follows up with targeted offers for complementary services",
        long_description: "After service completion, identifies opportunities for complementary or premium services. For example, after AC repair, it might suggest an annual maintenance plan. Uses customer history for personalized recommendations.",
        icon: "TrendingUp",
        category: "outbound_marketing",
        always_enabled: false,
        applicable_industries: ["home_services", "healthcare", "automotive", "retail", "professional_services"],
        confidence_weight: 0.65,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 240,
        override_variables: [
            { name: "last_service", description: "Service the customer recently received", default_value: "your recent service", example: "AC repair" },
            { name: "recommended_service", description: "Service being recommended", default_value: "a complementary service", example: "annual maintenance plan" },
            { name: "offer_details", description: "Special offer details", default_value: "", example: "20% off if you sign up this week" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Lisa" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Upsell Outreach",
            description_template: "Targeted follow-up for complementary services after a completed job.",
            trigger_type: "manual",
            urgency_tier: "low",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "moderate",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 0,
                    delay_type: "fixed_delay",
                    content_purpose: "Brief SMS mentioning their recent service and introducing the complementary service. Friendly, not pushy.",
                    enable_ai_mutation: true,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 4320,
                    delay_type: "after_previous",
                    content_purpose: "Personal call to discuss the recommendation. Reference recent service, explain benefit, answer questions, offer to schedule.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "office",
        voicemail_detection: true,
    },

    // ──────────────── 9. PROMO ANNOUNCER ────────────────
    {
        type_id: "event_promo_announcer",
        name: "Promo Announcer",
        description: "Outreach for seasonal promotions, events, and special offers",
        long_description: "Broadcasts promotions, seasonal campaigns, and events to your customer base. SMS blast for immediate reach, voice calls for high-value contacts, email for detailed offers.",
        icon: "Megaphone",
        category: "outbound_marketing",
        always_enabled: false,
        applicable_industries: "all",
        confidence_weight: 0.6,
        required_tools: ["check_availability", "book_appointment", "endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 180,
        override_variables: [
            { name: "event_name", description: "Name of the event or promotion", default_value: "a special offer", example: "Summer AC Tune-Up Special" },
            { name: "event_date", description: "When the event/promotion runs", default_value: "", example: "through the end of July" },
            { name: "promo_code", description: "Promotional code if applicable", default_value: "", example: "SUMMER25" },
            { name: "offer_details", description: "Details of the offer", default_value: "", example: "25% off AC tune-ups" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "valued customer" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Promo Campaign",
            description_template: "Multi-channel promotional campaign for events and special offers.",
            trigger_type: "manual",
            urgency_tier: "medium",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "aggressive",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 0,
                    delay_type: "fixed_delay",
                    content_purpose: "Promotional SMS announcing the offer. Brief, exciting, with clear value and any promo code.",
                    enable_ai_mutation: true,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 1440,
                    delay_type: "after_previous",
                    content_purpose: "Follow-up call for engaged contacts. Mention the promotion, offer to book at the promotional rate.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked"] },
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 3,
                    channel: "email",
                    delay_minutes: 1440,
                    delay_type: "after_previous",
                    content_purpose: "Detailed promotional email with offer details, testimonials, urgency, and a booking link.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["appointment_booked", "contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "off",
        voicemail_detection: true,
    },

    // ──────────────── 10. SURVEY COLLECTOR ────────────────
    {
        type_id: "survey_collector",
        name: "Survey Collector",
        description: "Collects post-service satisfaction feedback via phone survey",
        long_description: "Calls customers after service completion to conduct a brief satisfaction survey. 3-5 structured questions about their experience. Flags negative feedback for immediate team follow-up.",
        icon: "ClipboardCheck",
        category: "outbound_retention",
        always_enabled: false,
        applicable_industries: ["home_services", "healthcare", "automotive", "professional_services"],
        confidence_weight: 0.55,
        required_tools: ["endCall"],
        suggested_voice_id: "jsCqWAovK2LkecY7zXl4",
        suggested_voice_name: "Freya",
        default_max_duration_seconds: 180,
        override_variables: [
            { name: "service_date", description: "When the service was performed", default_value: "recently", example: "last Thursday" },
            { name: "service_type", description: "What service was performed", default_value: "your recent service", example: "water heater installation" },
            { name: "technician_name", description: "Name of the technician", default_value: "our team", example: "Mike" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Mrs. Anderson" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Post-Service Survey",
            description_template: "Single-call satisfaction survey after service completion.",
            trigger_type: "manual",
            urgency_tier: "low",
            respect_business_hours: true,
            enable_adaptive_mutation: false,
            mutation_aggressiveness: "conservative",
            steps: [
                {
                    step_order: 1,
                    channel: "voice",
                    delay_minutes: 2880,
                    delay_type: "fixed_delay",
                    content_purpose: "Brief satisfaction survey. Ask about overall satisfaction (1-5), quality of work, professionalism, would they recommend, anything to improve. Thank them. Flag issues for human follow-up.",
                    enable_ai_mutation: false,
                    skip_conditions: null,
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "off",
        voicemail_detection: true,
    },

    // ──────────────── 11. REFERRAL AGENT ────────────────
    {
        type_id: "referral_requester",
        name: "Referral Agent",
        description: "Asks satisfied customers for referrals",
        long_description: "Reaches out to happy customers 7-10 days after service to ask for referrals. SMS introduction followed by a personal call. Can mention referral incentives if configured.",
        icon: "Users",
        category: "outbound_marketing",
        always_enabled: false,
        applicable_industries: "all",
        confidence_weight: 0.6,
        required_tools: ["endCall"],
        suggested_voice_id: "EXAVITQu4vr4xnSDxMaL",
        suggested_voice_name: "Sarah",
        default_max_duration_seconds: 180,
        override_variables: [
            { name: "service_type", description: "Service the customer received", default_value: "your recent service", example: "bathroom renovation" },
            { name: "referral_incentive", description: "What the customer gets for referring", default_value: "", example: "a $50 credit toward your next service" },
            { name: "customer_name", description: "Customer's name", default_value: "", example: "Tom" },
        ],
        sequence_template: {
            name_template: "{{business_name}} - Referral Request",
            description_template: "Automated referral request targeting satisfied customers.",
            trigger_type: "manual",
            urgency_tier: "low",
            respect_business_hours: true,
            enable_adaptive_mutation: true,
            mutation_aggressiveness: "conservative",
            steps: [
                {
                    step_order: 1,
                    channel: "sms",
                    delay_minutes: 10080,
                    delay_type: "fixed_delay",
                    content_purpose: "Friendly SMS asking if they know anyone who might need similar services. Mention referral incentive. Keep it casual and grateful.",
                    enable_ai_mutation: true,
                    skip_conditions: null,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                },
                {
                    step_order: 2,
                    channel: "voice",
                    delay_minutes: 4320,
                    delay_type: "after_previous",
                    content_purpose: "Personal call to ask for referrals. Thank them, ask if they know friends/family/neighbors who need similar services. Mention incentive. Keep warm and brief.",
                    enable_ai_mutation: true,
                    skip_conditions: { skip_if: ["contact_replied"] },
                    on_success: { action: "end_sequence" },
                    on_failure: { action: "skip" },
                },
            ],
        },
        background_sound: "off",
        voicemail_detection: true,
    },
];

// ─── HELPERS ───

export function getAgentTypeDefinition(typeId: string): AgentTypeDefinition | undefined {
    return AGENT_CATALOG.find((a) => a.type_id === typeId);
}

export function getAgentsByCategory(category: AgentCategory): AgentTypeDefinition[] {
    return AGENT_CATALOG.filter((a) => a.category === category);
}

export function getApplicableAgents(industry: string): AgentTypeDefinition[] {
    return AGENT_CATALOG.filter(
        (a) => a.applicable_industries === "all" || a.applicable_industries.includes(industry)
    );
}

export function buildSequenceSummary(template: SequenceTemplate): string {
    const channels = template.steps.map((s) => {
        switch (s.channel) {
            case "sms": return "SMS";
            case "email": return "Email";
            case "voice": return "Voice";
            default: return s.channel;
        }
    });
    return `${template.steps.length} steps: ${channels.join(" \u2192 ")}`;
}

export function buildSuggestedAgentFromDefinition(
    def: AgentTypeDefinition,
    confidence: number,
    enabled: boolean
): SuggestedAgent {
    const confidenceLabel: SuggestedAgent["confidence_label"] =
        confidence >= 0.8 ? "highly_recommended" : confidence >= 0.6 ? "recommended" : "optional";

    return {
        type_id: def.type_id,
        name: def.name,
        description: def.description,
        category: def.category,
        enabled,
        confidence,
        confidence_label: confidenceLabel,
        icon: def.icon,
        voice_id: def.suggested_voice_id,
        voice_name: def.suggested_voice_name,
        sequence_summary: def.sequence_template ? buildSequenceSummary(def.sequence_template) : null,
        override_variables: def.override_variables,
        custom_instructions: null,
        is_custom: false,
    };
}
