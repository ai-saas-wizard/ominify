import type { VerticalDefinition } from "../types";

/**
 * How the demo is delivered. Drives appointment-confirmation wording in the
 * outbound prompt ("we'll send a Zoom link" vs "we'll give you a call").
 */
export const SAAS_DEMO_TYPES = [
    { value: "zoom", label: "Zoom / video call" },
    { value: "phone", label: "Phone call" },
];

/**
 * SaaS Companies vertical — OUTBOUND ONLY.
 *
 * A single battle-tested outbound sales agent that calls marketing-sourced
 * leads and books product demos on the calendar, warm-transferring hot leads
 * to a human closer. Mirrors the RE vertical's deploy architecture (static
 * prompt templates + form interpolation, NO GPT call at deploy time).
 *
 * The first account on this vertical is Omnify itself — Omnify selling Omnify.
 */
export const saasDefinition: VerticalDefinition = {
    id: "saas_companies",
    name: "SaaS Companies",
    description:
        "Pre-built outbound AI sales agent for SaaS companies. Calls marketing-sourced leads, qualifies fit, and books product demos — warm-transferring hot prospects to a human closer.",
    icon: "Rocket",
    tagline: "Book more demos with an AI SDR that calls your inbound leads",
    badge: "New",

    formSections: [
        {
            id: "company",
            title: "Company Info",
            description: "Tell us about your product",
            fields: [
                {
                    key: "companyName",
                    label: "Company Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Omnify",
                    helpText: "Your company name as you want the AI agent to say it",
                },
                {
                    key: "productOneLiner",
                    label: "What does your product do? (one sentence)",
                    type: "textarea",
                    required: true,
                    placeholder:
                        "e.g., Omnify is an AI voice platform that calls and qualifies your leads so you book more meetings.",
                    helpText:
                        "The agent uses this to explain your product in plain language.",
                },
                {
                    key: "ownerName",
                    label: "Your Full Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Bhavesh Bhatia",
                },
                {
                    key: "ownerEmail",
                    label: "Your Email",
                    type: "email",
                    required: true,
                    placeholder: "e.g., you@company.com",
                },
                {
                    key: "agentPersonaName",
                    label: "AI Agent Name",
                    type: "text",
                    required: true,
                    placeholder: "e.g., Alex",
                    defaultValue: "Alex",
                    helpText: "The name your AI agent uses on calls",
                },
            ],
        },
        {
            id: "pitch",
            title: "Pitch & Audience",
            description: "Who you're calling and why they should care",
            fields: [
                {
                    key: "icpDescription",
                    label: "Who are these leads?",
                    type: "textarea",
                    required: true,
                    placeholder:
                        "e.g., Founders and sales leaders at B2B companies who downloaded our guide or requested info from a marketing campaign.",
                    helpText:
                        "Describe the marketing-sourced leads the agent will call.",
                },
                {
                    key: "valueProps",
                    label: "Key talking points / value props",
                    type: "textarea",
                    required: true,
                    placeholder:
                        "e.g.\n- Books 30% more demos automatically\n- Calls every lead in under 60 seconds\n- Works 24/7, no SDR headcount",
                    helpText: "Top reasons a lead should take a demo. One per line.",
                },
                {
                    key: "commonObjections",
                    label: "Common objections (optional)",
                    type: "textarea",
                    required: false,
                    placeholder:
                        "e.g., 'We already have SDRs', 'Too expensive', 'AI sounds robotic'",
                    helpText: "Objections the agent should be ready to handle.",
                },
                {
                    key: "pricingSummary",
                    label: "Pricing summary (optional)",
                    type: "textarea",
                    required: false,
                    placeholder:
                        "e.g., Starts at $X/mo. Leave blank to have the agent defer pricing to the demo.",
                    helpText:
                        "If blank, the agent never quotes a price — it defers to the demo.",
                },
            ],
        },
        {
            id: "operations",
            title: "Demo & Operations",
            description: "How demos happen and where you operate",
            fields: [
                {
                    key: "demoType",
                    label: "How is the demo delivered?",
                    type: "single-select",
                    required: true,
                    options: SAAS_DEMO_TYPES,
                    defaultValue: "zoom",
                    helpText:
                        "Determines how the agent confirms the booked demo with the lead.",
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
                        "Number the AI leaves in voicemail for callbacks. Include country code — e.g. +1 212 555 1212.",
                },
            ],
        },
    ],

    agents: [
        {
            id: "saas_outbound_sales",
            name: "Outbound Sales Agent",
            direction: "outbound",
            category: "outbound_marketing",
            description:
                "Calls marketing-sourced leads, qualifies fit, and books product demos via Google Calendar. Reads each lead's contact_data JSON at call time, handles objections, and warm-transfers hot prospects to a human closer.",
            icon: "PhoneOutgoing",
            // Mirror the RE outbound voice/transcriber/model config (proven settings).
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
