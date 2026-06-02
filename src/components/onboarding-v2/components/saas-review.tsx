"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    PhoneOutgoing,
    ArrowLeft,
    Rocket,
    Building2,
    Clock,
    Volume2,
    Calendar,
    ArrowRightLeft,
    ChevronDown,
    ChevronRight,
    Target,
    MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getModelLabel } from "@/lib/display-names";
import { getVertical } from "@/lib/verticals/registry";
import { VOICE_NAMES } from "../constants";
import { VoicePlayButton } from "@/components/ui/voice-selector";
import { SAAS_OUTBOUND_GOALS } from "@/lib/verticals/saas/outbound-prompt-templates";
import { transferToolNameFor } from "@/lib/verticals/saas/tools";
import type { SaaSFormData } from "@/lib/verticals/types";

interface SaaSReviewProps {
    formData: SaaSFormData;
    onDeploy: () => void;
    onBack: () => void;
    isDeploying?: boolean;
}

export function SaaSReview({
    formData,
    onDeploy,
    onBack,
    isDeploying = false,
}: SaaSReviewProps) {
    const vertical = getVertical("saas_companies");
    const agentDef = vertical?.agents.find((a) => a.direction === "outbound");

    if (!vertical || !agentDef) {
        return (
            <div className="p-8 text-center text-red-600">
                SaaS vertical not found
            </div>
        );
    }

    const goalLabel =
        SAAS_OUTBOUND_GOALS.find((g) => g.value === formData.outboundGoal)
            ?.label || formData.outboundGoal;
    const voiceName = VOICE_NAMES[agentDef.voiceId] || "Custom";
    const transfer = formData.outboundTransfer;
    const transferToolName = transferToolNameFor(transfer);

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
                        Verify your outbound sales agent before deploying.
                    </p>
                </div>

                {/* Business Summary */}
                <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <Building2 className="h-4 w-4 text-gray-400" />
                        Company Summary
                    </h2>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <SummaryItem label="Company" value={formData.companyName} />
                        <SummaryItem label="Owner" value={formData.ownerName} />
                        <SummaryItem
                            label="Product"
                            value={formData.productOneLiner}
                        />
                        <SummaryItem
                            label="Demo Type"
                            value={
                                formData.demoType === "phone"
                                    ? "Phone call"
                                    : "Zoom / video"
                            }
                        />
                        <SummaryItem
                            label="Timezone"
                            value={formData.timezone}
                        />
                        <SummaryItem
                            label="Callback Number"
                            value={formData.businessPhone}
                        />
                    </div>
                </div>

                {/* Outbound Agent Card */}
                <div className="rounded-xl border border-indigo-200 bg-white shadow-sm">
                    <div className="p-5">
                        <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                                <PhoneOutgoing className="h-5 w-5 text-indigo-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold text-gray-900">
                                    {formData.agentPersonaName} — {agentDef.name}
                                </h3>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {agentDef.description}
                                </p>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {["Outbound", `Goal: ${goalLabel}`].map((b) => (
                                <span
                                    key={b}
                                    className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-medium text-indigo-600 ring-1 ring-indigo-200"
                                >
                                    {b}
                                </span>
                            ))}
                        </div>

                        <div className="mt-4 rounded-lg bg-gray-50 p-4">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="flex items-center gap-2">
                                    <Volume2 className="h-3.5 w-3.5 text-gray-400" />
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-400">Voice: </span>
                                        <span className="text-gray-700">
                                            {voiceName}
                                        </span>
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
                                            ? `${transfer.firstName} (${transfer.role || "closer"}) — ${
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
                                    value={getModelLabel(agentDef.llmModel)}
                                />
                            </div>
                        </div>

                        <div className="mt-4">
                            <PromptPreview
                                firstMessage={formData.outboundFirstMessage}
                                systemPrompt={formData.outboundPrompt}
                            />
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

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="text-xs text-gray-400">{label}</span>
            <p className="mt-0.5 text-sm text-gray-700">{value}</p>
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

function PromptPreview({
    firstMessage,
    systemPrompt,
}: {
    firstMessage: string;
    systemPrompt: string;
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
