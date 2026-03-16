import type { WalkthroughStep } from "./types";

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
    {
        id: "welcome",
        type: "welcome",
        title: "Welcome to your dashboard!",
        description:
            "Let's take a quick tour of your AI call center. This will only take a minute — you can skip anytime.",
    },
    {
        id: "sidebar-agents",
        type: "sidebar",
        targetId: "nav-agents",
        title: "Agents",
        description:
            "View and manage your AI voice agents. Each agent handles different types of calls — inbound, follow-up, or marketing.",
        icon: "Bot",
    },
    {
        id: "sidebar-contacts",
        type: "sidebar",
        targetId: "nav-contacts",
        title: "Contacts",
        description:
            "Your customer database. Import contacts, view call history, and manage your leads all in one place.",
        icon: "Users",
    },
    {
        id: "sidebar-analytics",
        type: "sidebar",
        targetId: "nav-analytics",
        title: "Analytics",
        description:
            "Track call performance, conversion rates, and agent effectiveness with real-time dashboards.",
        icon: "BarChart3",
    },
    {
        id: "sidebar-logs",
        type: "sidebar",
        targetId: "nav-logs",
        title: "Logs",
        description:
            "Full call logs with transcripts, recordings, and AI-generated summaries for every conversation.",
        icon: "FileText",
    },
    {
        id: "sidebar-billing",
        type: "sidebar",
        targetId: "nav-billing",
        title: "Billing",
        description:
            "Manage your subscription, view usage, and track your minute balance.",
        icon: "CreditCard",
    },
    {
        id: "sidebar-sequences",
        type: "sidebar",
        targetId: "nav-sequences",
        title: "Sequences",
        description:
            "Automated outbound calling campaigns. Set up multi-step call sequences to follow up with leads automatically.",
        icon: "GitBranch",
    },
    {
        id: "sidebar-phone-numbers",
        type: "sidebar",
        targetId: "nav-phone-numbers",
        title: "Phone Numbers",
        description:
            "Purchase and manage phone numbers. You'll need to register for 10DLC here to start making real calls.",
        icon: "Phone",
    },
    {
        id: "sidebar-settings",
        type: "sidebar",
        targetId: "nav-settings",
        title: "Settings",
        description:
            "Configure integrations (Google Calendar, Sheets), manage team members, set up webhooks, and customize contact fields.",
        icon: "Settings",
    },
    {
        id: "action-calendar",
        type: "action",
        title: "Connect Google Calendar",
        description:
            "Let your AI agents check availability and book appointments directly on your calendar.",
        icon: "Calendar",
        actionUrl: "/settings/integrations",
        actionLabel: "Connect Calendar",
    },
    {
        id: "action-sheets",
        type: "action",
        title: "Connect Google Sheets",
        description:
            "Automatically sync call data and lead information to Google Sheets for easy reporting.",
        icon: "Sheet",
        actionUrl: "/settings/integrations",
        actionLabel: "Connect Sheets",
    },
    {
        id: "action-10dlc",
        type: "action",
        title: "Register for 10DLC",
        description:
            "Required to make outbound calls. Verify your business identity to get carrier-approved for calling and texting.",
        icon: "Phone",
        actionUrl: "/phone-numbers",
        actionLabel: "Get Verified",
    },
    {
        id: "complete",
        type: "complete",
        title: "You're all set!",
        description:
            "Your AI call center is ready. Complete the setup steps above whenever you're ready to go live.",
    },
];
