"use client";

import { motion } from "framer-motion";
import {
    Phone,
    ArrowLeft,
    Rocket,
    Building2,
    User,
    MapPin,
    Clock,
    Volume2,
    Calendar,
    ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getVertical } from "@/lib/verticals/registry";
import { VOICE_NAMES } from "../constants";
import type { REInvestorFormData } from "@/lib/verticals/types";

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

    const agentDef = vertical.agents[0]; // Inbound receptionist
    const voiceName = VOICE_NAMES[agentDef.voiceId] || "Custom";

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-2xl"
            >
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={onBack}
                        disabled={isDeploying}
                        className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-50"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to form
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">
                        Review & Deploy
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Verify your setup and deploy your AI agent
                    </p>
                </div>

                {/* Business Summary Card */}
                <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <Building2 className="h-4 w-4 text-gray-400" />
                        Business Summary
                    </h2>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <SummaryItem
                            label="Company"
                            value={formData.companyName}
                        />
                        <SummaryItem
                            label="Owner"
                            value={formData.ownerName}
                        />
                        <SummaryItem
                            label="Markets"
                            value={formData.markets}
                        />
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
                    </div>
                </div>

                {/* Agent Card */}
                <div className="rounded-xl border border-emerald-200 bg-white shadow-sm">
                    <div className="p-5">
                        {/* Agent Header */}
                        <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                                <Phone className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-gray-900">
                                    {formData.agentPersonaName} — {agentDef.name}
                                </h3>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {agentDef.description}
                                </p>
                            </div>
                        </div>

                        {/* Agent Badges */}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-emerald-200">
                                Inbound
                            </span>
                            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10px] font-medium text-violet-600 ring-1 ring-violet-200">
                                Battle-tested Template
                            </span>
                        </div>

                        {/* Agent Config Details */}
                        <div className="mt-4 rounded-lg bg-gray-50 p-4">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <DetailItem
                                    icon={User}
                                    label="Persona"
                                    value={formData.agentPersonaName}
                                />
                                <DetailItem
                                    icon={Volume2}
                                    label="Voice"
                                    value={voiceName}
                                />
                                <DetailItem
                                    icon={Calendar}
                                    label="Calendar"
                                    value="Google Calendar"
                                />
                                <DetailItem
                                    icon={ArrowRightLeft}
                                    label="Transfer"
                                    value={formData.transferPhone}
                                />
                                <DetailItem
                                    icon={Clock}
                                    label="Max Duration"
                                    value={`${Math.round(agentDef.maxDurationSeconds / 60)} min`}
                                />
                                <DetailItem
                                    icon={MapPin}
                                    label="Model"
                                    value={agentDef.llmModel}
                                />
                            </div>
                        </div>

                        {/* What this agent does */}
                        <div className="mt-4">
                            <h4 className="text-xs font-semibold text-gray-600">
                                What this agent handles:
                            </h4>
                            <ul className="mt-2 space-y-1 text-xs text-gray-500">
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Answers all incoming calls with personalized greeting
                                </li>
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Qualifies sellers across 16+ situations (foreclosure, divorce, inherited, tired landlord, etc.)
                                </li>
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Collects property details (beds, baths, sqft, condition, mortgage)
                                </li>
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Books appointments via Google Calendar
                                </li>
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Handles mailing list removals, vendor calls, and job inquiries
                                </li>
                                <li className="flex items-start gap-1.5">
                                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                    Transfers to a live person when asked &quot;are you AI?&quot; twice
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

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
                                Deploy Agent
                            </>
                        )}
                    </Button>
                </div>
            </motion.div>
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
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-gray-400" />
            <div>
                <span className="text-gray-400">{label}: </span>
                <span className="text-gray-700">{value}</span>
            </div>
        </div>
    );
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
