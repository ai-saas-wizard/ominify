import type { VerticalDefinition } from "../types";

export const RE_DEAL_TYPES = [
    { value: "wholesale", label: "Wholesale" },
    { value: "fix_and_flip", label: "Fix & Flip" },
    { value: "buy_and_hold", label: "Buy & Hold" },
    { value: "creative_financing", label: "Creative Financing" },
    { value: "subject_to", label: "Subject-To" },
    { value: "novation", label: "Novation" },
    { value: "seller_financing", label: "Seller Financing" },
];

export const reInvestorDefinition: VerticalDefinition = {
    id: "real_estate_investor",
    name: "Real Estate Investor",
    description:
        "Pre-built AI agents for real estate investors and flippers. Battle-tested templates for handling seller calls, qualifying leads, and booking appointments.",
    icon: "Building2",
    tagline: "Buy & sell properties with AI voice agents",
    badge: "Battle-tested",

    formSections: [
        {
            id: "company",
            title: "Company Info",
            description: "Tell us about your business",
            fields: [
                {
                    key: "companyName",
                    label: "Company Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Tennessee Homebuyers",
                    helpText: "Your business name as you want the AI agent to say it",
                },
                {
                    key: "ownerName",
                    label: "Your Full Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., John Smith",
                },
                {
                    key: "ownerEmail",
                    label: "Your Email",
                    type: "email",
                    required: true,
                    placeholder: "e.g., john@company.com",
                },
                {
                    key: "agentPersonaName",
                    label: "AI Agent Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Sam",
                    defaultValue: "Sam",
                    helpText:
                        "The name your AI agent will use when answering calls",
                },
            ],
        },
        {
            id: "operations",
            title: "Operations",
            description: "Where and how you do business",
            fields: [
                {
                    key: "markets",
                    label: "Markets / Service Areas",
                    type: "textarea",
                    required: true,
                    placeholder:
                        "e.g., Nashville TN, Davidson County, 37201-37250",
                    helpText:
                        "Cities, counties, or zip codes you operate in. One per line or comma-separated.",
                },
                {
                    key: "dealTypes",
                    label: "Deal Types",
                    type: "multi-select",
                    required: true,
                    options: RE_DEAL_TYPES,
                    helpText: "Select all deal types your business handles",
                },
                {
                    key: "timezone",
                    label: "Timezone",
                    type: "timezone",
                    required: true,
                },
                {
                    key: "appointmentType",
                    label: "How do your team members meet with sellers?",
                    type: "single-select",
                    required: true,
                    options: [
                        { value: "in_person", label: "In-Person Walkthrough" },
                        { value: "phone_only", label: "Phone Call Only" },
                        { value: "both", label: "Both" },
                    ],
                    defaultValue: "in_person",
                    helpText: "Determines how the AI confirms appointments with sellers",
                },
            ],
        },
        {
            id: "inbound_transfer",
            title: "Inbound Transfer Specialist",
            description:
                "Who should the AI warm-transfer inbound calls to when a seller asks to speak to a human? The AI tool will be named after this person (e.g. \"gary_transfer\") and the AI will brief them on the call before connecting.",
            fields: [
                {
                    key: "inboundTransferFirstName",
                    label: "First name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Gary",
                    helpText:
                        "Used to name the transfer tool the AI invokes (gary_transfer, rhonda_transfer, etc.)",
                },
                {
                    key: "inboundTransferRole",
                    label: "Their role",
                    type: "text",
                    required: true,
                    placeholder: "e.g., lead manager",
                    helpText:
                        "Surfaced in the warm-transfer summary the AI speaks to them",
                },
                {
                    key: "inboundTransferPhone",
                    label: "Their phone number",
                    type: "phone",
                    required: true,
                    placeholder: "+1 (212) 555-1212",
                    helpText:
                        "Where inbound transfers route to. Include country code — e.g. +1 212 555 1212.",
                },
                {
                    key: "inboundTransferMode",
                    label: "Transfer style",
                    type: "single-select",
                    required: true,
                    options: [
                        {
                            value: "warm-summary",
                            label: "Warm transfer with AI-spoken summary (recommended)",
                        },
                        {
                            value: "cold",
                            label: "Cold transfer (connect immediately, no summary)",
                        },
                    ],
                    defaultValue: "warm-summary",
                    helpText:
                        "Warm transfers brief the operator on the call before connecting; cold transfers connect immediately.",
                },
            ],
        },
        {
            id: "callback",
            title: "Callback Number",
            description: "Number the AI leaves in voicemail messages",
            fields: [
                {
                    key: "businessPhone",
                    label: "Business Callback Number",
                    type: "phone",
                    required: true,
                    placeholder: "+1 (212) 555-1212",
                    helpText:
                        "Number the AI leaves in voicemail messages for callbacks. Include country code — e.g. +1 212 555 1212.",
                },
            ],
        },
    ],

    agents: [
        {
            id: "re_inbound_receptionist",
            name: "Inbound Receptionist",
            direction: "inbound",
            category: "inbound",
            description:
                "Answers incoming calls from motivated sellers. Qualifies leads, collects property details, handles 16+ seller situations with empathy, and books appointments via Google Calendar.",
            icon: "Phone",
            // Samantha's exact voice config
            voiceId: "ZRwrL4id6j1HPGFkeCzO",
            voiceProvider: "11labs",
            voiceModel: "eleven_flash_v2_5",
            voiceConfig: {
                speed: 1.1,
                stability: 0.4,
                similarityBoost: 0.6,
                style: 0.2,
                useSpeakerBoost: false,
            },
            llmModel: "gpt-4o-mini",
            llmTemperature: 0.65,
            llmMaxTokens: 250,
            transcriberModel: "nova-3",
            firstMessageMode: "assistant-speaks-first",
            maxDurationSeconds: 3083,
            startSpeakingPlan: {
                waitSeconds: 0.7,
                smartEndpointingPlan: {
                    provider: "livekit",
                    waitFunction:
                        "(20 + 500 * sqrt(x) + 2500 * x^3 + 700 + 4000 * max(0, x-0.5)) / 2",
                },
            },
            stopSpeakingPlan: {
                numWords: 3,
            },
            endCallPhrases: ["goodbye", "talk to you soon"],
        },
        {
            id: "re_outbound_follow_up",
            name: "Outbound Follow-Up",
            direction: "outbound",
            category: "outbound_follow_up",
            description:
                "Outbound calls to re-engage sellers, follow up on missed appointments, or run cold outreach. Reads each seller's contact_data JSON at call time, pitches a prior offer if known, transfers to a specialist on demand, and books appointments via Google Calendar.",
            icon: "PhoneOutgoing",
            // Mirror the inbound voice/transcriber config exactly (Samantha)
            voiceId: "ZRwrL4id6j1HPGFkeCzO",
            voiceProvider: "11labs",
            voiceModel: "eleven_flash_v2_5",
            voiceConfig: {
                speed: 1.1,
                stability: 0.4,
                similarityBoost: 0.6,
                style: 0.2,
                useSpeakerBoost: false,
            },
            llmModel: "gpt-4o-mini",
            llmTemperature: 0.65,
            llmMaxTokens: 250,
            transcriberModel: "nova-3",
            firstMessageMode: "assistant-speaks-first",
            maxDurationSeconds: 600,
            startSpeakingPlan: {
                waitSeconds: 0.7,
                smartEndpointingPlan: {
                    provider: "livekit",
                    waitFunction:
                        "(20 + 500 * sqrt(x) + 2500 * x^3 + 700 + 4000 * max(0, x-0.5)) / 2",
                },
            },
            stopSpeakingPlan: {
                numWords: 3,
            },
            endCallPhrases: ["goodbye", "talk to you soon"],
        },
    ],
};
