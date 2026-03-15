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
            ],
        },
        {
            id: "contact",
            title: "Contact & Routing",
            description: "How calls should be handled and escalated",
            fields: [
                {
                    key: "transferPhone",
                    label: "Escalation Phone Number",
                    type: "phone",
                    required: true,
                    placeholder: "e.g., (615) 647-9393",
                    helpText:
                        "Calls transfer here when a caller insists on speaking to a real person",
                },
                {
                    key: "businessPhone",
                    label: "Business Callback Number",
                    type: "phone",
                    required: true,
                    placeholder: "e.g., (615) 863-4486",
                    helpText:
                        "Number the AI leaves in voicemail messages for callbacks",
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
    ],
};
