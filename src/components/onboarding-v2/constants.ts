// ═══════════════════════════════════════════════════════════
// ONBOARDING V2 CONSTANTS
// ═══════════════════════════════════════════════════════════

import type { AgentCategory } from "./types";

// ─── ANALYSIS THEATER STAGES ───

export const ANALYSIS_STAGES = [
    { label: "Scanning your website...", icon: "Globe", duration: 4000 },
    { label: "Analyzing your industry and services...", icon: "Building2", duration: 4000 },
    { label: "Identifying your customer journey...", icon: "Route", duration: 6000 },
    { label: "Designing your AI agents...", icon: "Bot", duration: 6000 },
    { label: "Configuring your campaigns...", icon: "Workflow", duration: 5000 },
];

// ─── CATEGORY DISPLAY ───

export const CATEGORY_CONFIG: Record<
    AgentCategory,
    { label: string; color: string; bgColor: string; borderColor: string }
> = {
    inbound: {
        label: "Inbound",
        color: "text-emerald-400",
        bgColor: "bg-emerald-400/10",
        borderColor: "border-emerald-400/20",
    },
    outbound_follow_up: {
        label: "Follow-Up",
        color: "text-blue-400",
        bgColor: "bg-blue-400/10",
        borderColor: "border-blue-400/20",
    },
    outbound_marketing: {
        label: "Marketing",
        color: "text-orange-400",
        bgColor: "bg-orange-400/10",
        borderColor: "border-orange-400/20",
    },
    outbound_retention: {
        label: "Retention",
        color: "text-purple-400",
        bgColor: "bg-purple-400/10",
        borderColor: "border-purple-400/20",
    },
};

// ─── CONFIDENCE DISPLAY ───

export const CONFIDENCE_CONFIG = {
    highly_recommended: {
        label: "Highly Recommended",
        color: "text-emerald-400",
        bgColor: "bg-emerald-400/10",
        borderColor: "border-emerald-400/30",
    },
    recommended: {
        label: "Recommended",
        color: "text-blue-400",
        bgColor: "bg-blue-400/10",
        borderColor: "border-blue-400/30",
    },
    optional: {
        label: "Optional",
        color: "text-zinc-400",
        bgColor: "bg-zinc-400/10",
        borderColor: "border-zinc-400/30",
    },
};

// ─── VOICE DISPLAY NAMES ───

export const VOICE_NAMES: Record<string, string> = {
    EXAVITQu4vr4xnSDxMaL: "Sarah",
    jsCqWAovK2LkecY7zXl4: "Freya",
    TxGEqnHWrfWFTfGW9XjX: "Josh",
    flq6f7yk4E4fJM5XTYuZ: "Nova",
};

// ─── ICON MAP ───
// Maps agent icon string names to lucide-react icon component names.
// Used by agent-card.tsx to dynamically render icons.

export const AGENT_ICONS = [
    "Phone",
    "Zap",
    "CalendarCheck",
    "UserX",
    "Star",
    "Heart",
    "Filter",
    "TrendingUp",
    "Megaphone",
    "ClipboardCheck",
    "Users",
    "Bot",
] as const;
