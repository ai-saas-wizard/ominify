"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Phone,
    PhoneOutgoing,
    ArrowLeft,
    Rocket,
    Building2,
    User,
    MapPin,
    Clock,
    Volume2,
    Calendar,
    ArrowRightLeft,
    Wand2,
    ChevronDown,
    ChevronRight,
    Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getModelLabel } from "@/lib/display-names";
import { getVertical } from "@/lib/verticals/registry";
import { VOICE_NAMES } from "../constants";
import { VoicePlayButton } from "@/components/ui/voice-selector";
import { RE_OUTBOUND_GOALS } from "@/lib/verticals/real-estate-investor/outbound-prompt-templates";
import { transferToolNameFor } from "@/lib/verticals/real-estate-investor/tools";
import type {
    REInvestorFormData,
    TransferSpecialist,
    VerticalAgentDef,
} from "@/lib/verticals/types";

interface VerticalReviewProps {
    verticalId: string;
    formData: REInvestorFormData;
    onDeploy: () => void;
    onBack: () => void;
    isDeploying?: boolean;
}

export function VerticalReview({
    verticalId,
    formData,
    onDeploy,
    onBack,
    isDeploying = false,
}: VerticalReviewProps) {
    const vertical = getVertical(verticalId);

    if (!vertical) {
        return (
            <div className="p-8 text-center text-red-600">
                Vertical not found
            </div>
        );
    }

    const inboundAgent = vertical.agents.find(
        (a) => a.direction === "inbound"
    );
    const outboundAgent = vertical.agents.find(
        (a) => a.direction === "outbound"
    );

    const goalLabel =
        RE_OUTBOUND_GOALS.find((g) => g.value === formData.outboundGoal)
            ?.label || formData.outboundGoal;
    const usedScenario =
        (formData.outboundScenario || "").trim().length >= 20;

    return (
        <div className="flex min-h-screen items-start justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-3xl"
            >
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={onBack}
                        disabled={isDeploying}
                        className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-50"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">
                        Review & Deploy
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Verify both agents below before deploying.
                    </p>
                </div>

                {/* Business Summary Card */}
                <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <Building2 className="h-4 w-4 text-gray-400" />
                        Business Summary
                    </h2>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <SummaryItem label="Company" value={formData.companyName} />
                        <SummaryItem label="Owner" value={formData.ownerName} />
                        <SummaryItem label="Markets" value={formData.markets} />
                        <SummaryItem
                            label="Deal Types"
                            value={formData.dealTypes
                                .map((dt) =>
                                    dt.replace(/_/g, " ").replace(/\band\b/gi, "&")
                                )
                                .join(", ")}
                        />
                        <SummaryItem
                            label="Timezone"
                            value={formatTimezone(formData.timezone)}
                        />
                        <SummaryItem
                            label="Appointments"
                            value={formatAppointmentType(formData.appointmentType)}
                        />
                        <SummaryItem
                            label="Contact"
                            value={formData.ownerEmail}
                        />
                        <SummaryItem
                            label="Callback Number"
                            value={formData.businessPhone}
                        />
                    </div>
                </div>

                {/* Inbound Agent Card */}
                {inboundAgent && (
                    <AgentReviewCard
                        accent="emerald"
                        icon={<Phone className="h-5 w-5 text-emerald-600" />}
                        title={`${formData.agentPersonaName} — ${inboundAgent.name}`}
                        description={inboundAgent.description}
                        badges={["Inbound", "Battle-tested Template"]}
                        agentDef={inboundAgent}
                        transfer={formData.inboundTransfer}
                        modelOverride={inboundAgent.llmModel}
                        handles={[
                            "Answers incoming calls with personalized greeting",
                            "Qualifies sellers across 16+ situations (foreclosure, divorce, inherited, tired landlord, etc.)",
                            "Collects property details (beds, baths, sqft, condition, mortgage)",
                            "Books appointments via Google Calendar",
                            "Handles mailing-list removals, vendor calls, and job inquiries",
                            "Transfers to a live person when asked \"are you AI?\" twice",
                        ]}
                    />
                )}

                {/* Outbound Agent Card */}
                {outboundAgent && (
                    <div className="mt-4">
                        <AgentReviewCard
                            accent="indigo"
                            icon={
                                <PhoneOutgoing className="h-5 w-5 text-indigo-600" />
                            }
                            title={`${formData.agentPersonaName} — ${outboundAgent.name}`}
                            description={outboundAgent.description}
                            badges={[
                                "Outbound",
                                usedScenario
                                    ? "Custom prompt (AI-generated)"
                                    : `Goal: ${goalLabel}`,
                            ]}
                            agentDef={outboundAgent}
                            transfer={formData.outboundTransfer}
                            modelOverride={outboundAgent.llmModel}
                            handles={outboundHandlesFor(
                                formData.outboundGoal,
                                formData.outboundTransfer.firstName ||
                                    "the team"
                            )}
                            extraSection={
                                <PromptPreview
                                    firstMessage={formData.outboundFirstMessage}
                                    systemPrompt={formData.outboundPrompt}
                                    scenario={
                                        usedScenario
                                            ? formData.outboundScenario
                                            : undefined
                                    }
                                />
                            }
                        />
                    </div>
                )}

                {/* Deploy Button */}
                <div className="mt-6 flex justify-end gap-3">
                    <Button
                        variant="outline"
                        onClick={onBack}
                        disabled={isDeploying}
                    >
                        Edit Details
                    </Button>
                    <Button
                        onClick={onDeploy}
                        disabled={isDeploying}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                        {isDeploying ? (
                            <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Deploying...
                            </>
                        ) : (
                            <>
                                <Rocket className="h-4 w-4" />
                                Deploy Both Agents
                            </>
                        )}
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── AGENT CARD ───

interface AgentReviewCardProps {
    accent: "emerald" | "indigo";
    icon: React.ReactNode;
    title: string;
    description: string;
    badges: string[];
    agentDef: VerticalAgentDef;
    transfer: TransferSpecialist;
    modelOverride: string;
    handles: string[];
    extraSection?: React.ReactNode;
}

function AgentReviewCard({
    accent,
    icon,
    title,
    description,
    badges,
    agentDef,
    transfer,
    modelOverride,
    handles,
    extraSection,
}: AgentReviewCardProps) {
    const voiceName = VOICE_NAMES[agentDef.voiceId] || "Custom";
    const accentBorder =
        accent === "emerald" ? "border-emerald-200" : "border-indigo-200";
    const accentBg = accent === "emerald" ? "bg-emerald-50" : "bg-indigo-50";
    const accentBadgeBg =
        accent === "emerald"
            ? "bg-emerald-50 text-emerald-600 ring-emerald-200"
            : "bg-indigo-50 text-indigo-600 ring-indigo-200";
    const accentDot =
        accent === "emerald" ? "bg-emerald-400" : "bg-indigo-400";

    const transferToolName = transferToolNameFor(transfer);

    return (
        <div
            className={cn(
                "rounded-xl border bg-white shadow-sm",
                accentBorder
            )}
        >
            <div className="p-5">
                {/* Header */}
                <div className="flex items-start gap-3">
                    <div
                        className={cn(
                            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl",
                            accentBg
                        )}
                    >
                        {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-gray-900">
                            {title}
                        </h3>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {description}
                        </p>
                    </div>
                </div>

                {/* Badges */}
                <div className="mt-3 flex flex-wrap gap-2">
                    {badges.map((b) => (
                        <span
                            key={b}
                            className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-medium ring-1",
                                accentBadgeBg
                            )}
                        >
                            {b}
                        </span>
                    ))}
                </div>

                {/* Agent Config Details */}
                <div className="mt-4 rounded-lg bg-gray-50 p-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex items-center gap-2">
                            <Volume2 className="h-3.5 w-3.5 text-gray-400" />
                            <div className="flex items-center gap-1.5">
                                <span className="text-gray-400">Voice: </span>
                                <span className="text-gray-700">{voiceName}</span>
                                <VoicePlayButton voiceId={agentDef.voiceId} />
                            </div>
                        </div>
                        <DetailItem
                            icon={Calendar}
                            label="Calendar"
                            value="Google Calendar"
                        />
                        <DetailItem
                            icon={ArrowRightLeft}
                            label="Transfer"
                            value={
                                transfer.firstName
                                    ? `${transfer.firstName} (${transfer.role || "specialist"}) — ${
                                          transfer.mode === "warm-summary"
                                              ? "warm + summary"
                                              : "cold"
                                      }`
                                    : "Not configured"
                            }
                        />
                        <DetailItem
                            icon={Target}
                            label="Transfer tool"
                            value={transferToolName}
                            mono
                        />
                        <DetailItem
                            icon={Clock}
                            label="Max Duration"
                            value={`${Math.round(agentDef.maxDurationSeconds / 60)} min`}
                        />
                        <DetailItem
                            icon={MapPin}
                            label="Model"
                            value={getModelLabel(modelOverride)}
                        />
                    </div>
                </div>

                {/* What this agent handles */}
                <div className="mt-4">
                    <h4 className="text-xs font-semibold text-gray-600">
                        What this agent handles:
                    </h4>
                    <ul className="mt-2 space-y-1 text-xs text-gray-500">
                        {handles.map((h) => (
                            <li key={h} className="flex items-start gap-1.5">
                                <span
                                    className={cn(
                                        "mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                                        accentDot
                                    )}
                                />
                                {h}
                            </li>
                        ))}
                    </ul>
                </div>

                {extraSection ? <div className="mt-4">{extraSection}</div> : null}
            </div>
        </div>
    );
}

// ─── PROMPT PREVIEW (collapsible) ───

function PromptPreview({
    firstMessage,
    systemPrompt,
    scenario,
}: {
    firstMessage: string;
    systemPrompt: string;
    scenario?: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100"
            >
                <span className="flex items-center gap-1.5">
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                    )}
                    View prompt + first message
                </span>
                <span className="text-[10px] font-normal text-gray-400">
                    {systemPrompt.length.toLocaleString()} characters
                </span>
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-3 px-4 py-3 text-xs">
                            {scenario ? (
                                <div>
                                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-purple-600">
                                        <Wand2 className="h-3 w-3" />
                                        Generated from your scenario
                                    </div>
                                    <p className="whitespace-pre-wrap rounded-md border border-purple-200 bg-purple-50/40 p-2 text-gray-700">
                                        {scenario}
                                    </p>
                                </div>
                            ) : null}

                            <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    First message
                                </div>
                                <p className="whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-2 font-mono text-gray-800">
                                    {firstMessage || "(empty)"}
                                </p>
                            </div>

                            <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    System prompt
                                </div>
                                <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-gray-800">
                                    {systemPrompt || "(empty)"}
                                </pre>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── HELPERS ───

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="text-xs text-gray-400">{label}</span>
            <p className="mt-0.5 text-sm text-gray-700 capitalize">{value}</p>
        </div>
    );
}

function DetailItem({
    icon: Icon,
    label,
    value,
    mono,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-gray-400" />
            <div>
                <span className="text-gray-400">{label}: </span>
                <span
                    className={cn(
                        "text-gray-700",
                        mono && "font-mono text-[11px]"
                    )}
                >
                    {value}
                </span>
            </div>
        </div>
    );
}

function outboundHandlesFor(goal: string, transferFirstName: string): string[] {
    switch (goal) {
        case "re_engage_prior_offer":
            return [
                "Calls back sellers who got an offer but didn't move forward",
                "Pitches the prior offer if it exists in contact_data — never invents a number",
                "Handles counter-offers and routes them to your team",
                "Books a sit-down via Google Calendar when the seller is ready",
                `Warm-transfers to ${transferFirstName} when the seller asks for a human or counter-offers`,
            ];
        case "cold_outreach_motivated_seller":
            return [
                "First-touch outbound to motivated-seller leads",
                "Briefly qualifies the property (title, condition, decision-maker)",
                "Books an appointment with a buying specialist when the seller is open",
                `Warm-transfers to ${transferFirstName} when the seller wants to talk now`,
                "Removes uninterested sellers from the list cleanly",
            ];
        case "missed_appointment_followup":
            return [
                "Re-engages sellers who no-showed or cancelled an appointment",
                "Looks up the original appointment and reschedules it (not a duplicate)",
                "Handles cancellations with a two-step confirmation",
                `Warm-transfers to ${transferFirstName} when the seller wants to talk now`,
            ];
        case "custom":
        default:
            return [
                "Custom outbound flow you've defined",
                "Reads each seller's contact_data JSON at call time",
                "Books appointments via Google Calendar when relevant",
                `Warm-transfers to ${transferFirstName} on demand`,
                "Handles do-not-call requests cleanly",
            ];
    }
}

function formatAppointmentType(type: string): string {
    const map: Record<string, string> = {
        in_person: "In-Person Walkthrough",
        phone_only: "Phone Call Only",
        both: "Both",
    };
    return map[type] || type;
}

function formatTimezone(tz: string): string {
    const map: Record<string, string> = {
        "America/New_York": "Eastern",
        "America/Chicago": "Central",
        "America/Denver": "Mountain",
        "America/Los_Angeles": "Pacific",
        "America/Phoenix": "Arizona",
        "America/Anchorage": "Alaska",
        "Pacific/Honolulu": "Hawaii",
    };
    return map[tz] || tz;
}
