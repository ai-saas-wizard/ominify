"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, X } from "lucide-react";
import Link from "next/link";
import { PathSelectionScreen } from "@/components/onboarding-v2/components/path-selection-screen";
import { VerticalForm } from "@/components/onboarding-v2/components/vertical-form";
import { VerticalOutboundConfig } from "@/components/onboarding-v2/components/vertical-outbound-config";
import { VerticalAgentSelect } from "./vertical-agent-select";
import { VerticalOutboundGoalSelect } from "./vertical-outbound-goal-select";
import { VerticalOutboundSharedForm } from "./vertical-outbound-shared-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    createSingleAgent,
    type CreateSingleAgentInput,
} from "@/app/actions/create-single-agent-actions";
import { RE_OUTBOUND_GOALS } from "@/lib/verticals/real-estate-investor/outbound-prompt-templates";
import type {
    REInvestorFormData,
    REOutboundGoal,
} from "@/lib/verticals/types";

type Phase =
    | "path_selection"
    | "generic_form"
    | "vertical_agent_select"
    | "vertical_inbound_form"
    | "vertical_outbound_goal_select"
    | "vertical_outbound_shared"
    | "vertical_outbound_config"
    | "deploying"
    | "error";

interface NewAgentWizardProps {
    clientId: string;
    clientName: string;
    tenantTimezone: string;
    outboundDefaults?: Partial<REInvestorFormData>;
}

const EMPTY_RE_FORM_DATA: REInvestorFormData = {
    companyName: "",
    ownerName: "",
    ownerEmail: "",
    agentPersonaName: "Sam",
    markets: "",
    dealTypes: [],
    timezone: "",
    appointmentType: "in_person",
    businessPhone: "",
    inboundTransfer: {
        firstName: "",
        role: "lead manager",
        phone: "",
        mode: "warm-summary",
    },
    outboundTransfer: {
        firstName: "",
        role: "lead manager",
        phone: "",
        mode: "warm-summary",
    },
    outboundGoal: "re_engage_prior_offer",
    outboundScenario: "",
    outboundPrompt: "",
    outboundFirstMessage: "",
};

export function NewAgentWizard({
    clientId,
    clientName,
    tenantTimezone,
    outboundDefaults,
}: NewAgentWizardProps) {
    const router = useRouter();
    const [phase, setPhase] = useState<Phase>("path_selection");
    const [selectedVerticalId, setSelectedVerticalId] = useState<string | null>(
        null
    );
    const [outboundFormData, setOutboundFormData] =
        useState<REInvestorFormData>(() => ({
            ...EMPTY_RE_FORM_DATA,
            companyName: outboundDefaults?.companyName ?? clientName,
            agentPersonaName:
                outboundDefaults?.agentPersonaName ??
                EMPTY_RE_FORM_DATA.agentPersonaName,
            markets: outboundDefaults?.markets ?? "",
            dealTypes: outboundDefaults?.dealTypes ?? [],
            timezone: outboundDefaults?.timezone ?? tenantTimezone,
            appointmentType:
                outboundDefaults?.appointmentType ??
                EMPTY_RE_FORM_DATA.appointmentType,
            businessPhone: outboundDefaults?.businessPhone ?? "",
            inboundTransfer:
                outboundDefaults?.inboundTransfer ??
                EMPTY_RE_FORM_DATA.inboundTransfer,
            outboundTransfer:
                outboundDefaults?.outboundTransfer ??
                EMPTY_RE_FORM_DATA.outboundTransfer,
        }));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const deploy = (input: CreateSingleAgentInput) => {
        setPhase("deploying");
        setErrorMessage(null);
        startTransition(async () => {
            const result = await createSingleAgent(clientId, input);
            if (!result.success || !result.vapiId) {
                setErrorMessage(result.error || "Failed to create agent");
                setPhase("error");
                return;
            }
            router.push(`/client/${clientId}/agents/${result.vapiId}`);
        });
    };

    const goalLabel = useMemo(() => {
        const found = RE_OUTBOUND_GOALS.find(
            (g) => g.value === outboundFormData.outboundGoal
        );
        return found?.shortLabel ?? "Outbound";
    }, [outboundFormData.outboundGoal]);

    const handleSelectVertical = (verticalId: string) => {
        setSelectedVerticalId(verticalId);
        setPhase("vertical_agent_select");
    };

    const handleSelectInbound = () => {
        setPhase("vertical_inbound_form");
    };

    const handleSelectOutbound = () => {
        setPhase("vertical_outbound_goal_select");
    };

    const handleSelectGoal = (goal: REOutboundGoal) => {
        setOutboundFormData((prev) => ({
            ...prev,
            outboundGoal: goal,
            // Clear any previously generated prompt so the next phase
            // re-derives the starter for the new goal.
            outboundPrompt: "",
            outboundFirstMessage: "",
        }));
        setPhase("vertical_outbound_shared");
    };

    const handleSharedFormContinue = (
        partial: Partial<REInvestorFormData>
    ) => {
        setOutboundFormData((prev) => ({ ...prev, ...partial }));
        setPhase("vertical_outbound_config");
    };

    const handleOutboundConfigContinue = (updated: REInvestorFormData) => {
        setOutboundFormData(updated);
        const agentName = `${updated.companyName} - ${goalLabel}`;
        deploy({
            kind: "vertical_re_outbound",
            formData: updated,
            agentName,
        });
    };

    return (
        <div className="fixed inset-0 z-50 overflow-auto bg-gray-50">
            {/* Close button */}
            <Link
                href={`/client/${clientId}/agents`}
                className="fixed right-6 top-6 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Cancel"
            >
                <X className="h-4 w-4" />
            </Link>

            {phase === "path_selection" && (
                <PathSelectionScreen
                    onSelectAutoGenerated={() => setPhase("generic_form")}
                    onSelectVertical={handleSelectVertical}
                />
            )}

            {phase === "generic_form" && (
                <GenericAgentForm
                    clientName={clientName}
                    onBack={() => setPhase("path_selection")}
                    onSubmit={(agentName, agentType) =>
                        deploy({ kind: "generic", agentType, agentName })
                    }
                    submitting={isPending}
                />
            )}

            {phase === "vertical_agent_select" && selectedVerticalId && (
                <VerticalAgentSelect
                    verticalId={selectedVerticalId}
                    onSelectInbound={handleSelectInbound}
                    onSelectOutbound={handleSelectOutbound}
                    onBack={() => setPhase("path_selection")}
                />
            )}

            {phase === "vertical_inbound_form" && selectedVerticalId && (
                <VerticalForm
                    verticalId={selectedVerticalId}
                    initialData={{
                        companyName: clientName,
                        timezone: tenantTimezone,
                    }}
                    onBack={() => setPhase("vertical_agent_select")}
                    onContinue={(formData: REInvestorFormData) =>
                        deploy({
                            kind: "vertical_re",
                            formData,
                            agentName: `${formData.companyName} - Inbound`,
                        })
                    }
                />
            )}

            {phase === "vertical_outbound_goal_select" && (
                <VerticalOutboundGoalSelect
                    onSelect={handleSelectGoal}
                    onBack={() => setPhase("vertical_agent_select")}
                />
            )}

            {phase === "vertical_outbound_shared" && (
                <VerticalOutboundSharedForm
                    initialData={outboundFormData}
                    onContinue={handleSharedFormContinue}
                    onBack={() => setPhase("vertical_outbound_goal_select")}
                />
            )}

            {phase === "vertical_outbound_config" && (
                <VerticalOutboundConfig
                    formData={outboundFormData}
                    onContinue={handleOutboundConfigContinue}
                    onBack={() => setPhase("vertical_outbound_shared")}
                />
            )}

            {phase === "deploying" && <Deploying />}

            {phase === "error" && (
                <ErrorScreen
                    message={errorMessage || "Something went wrong"}
                    onRetry={() => setPhase("path_selection")}
                    onCancelHref={`/client/${clientId}/agents`}
                />
            )}
        </div>
    );
}

// ─── GENERIC "BUILD YOUR OWN" MINI-FORM ───

function GenericAgentForm({
    clientName,
    onBack,
    onSubmit,
    submitting,
}: {
    clientName: string;
    onBack: () => void;
    onSubmit: (name: string, type: "inbound" | "outbound") => void;
    submitting: boolean;
}) {
    const [agentType, setAgentType] = useState<"inbound" | "outbound">(
        "inbound"
    );
    const [agentName, setAgentName] = useState(`${clientName} - Inbound`);
    const [touchedName, setTouchedName] = useState(false);

    const onTypeChange = (next: "inbound" | "outbound") => {
        setAgentType(next);
        if (!touchedName) {
            setAgentName(
                `${clientName} - ${next === "inbound" ? "Inbound" : "Outbound"}`
            );
        }
    };

    const canSubmit = agentName.trim().length >= 2 && !submitting;

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
            >
                <button
                    onClick={onBack}
                    className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <h1 className="text-2xl font-bold text-gray-900">
                    Build your own agent
                </h1>
                <p className="mt-1.5 text-sm text-gray-500">
                    We'll use your saved business profile as the starting point.
                </p>

                <div className="mt-8 space-y-6">
                    {/* Agent type */}
                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            Agent type
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {(["inbound", "outbound"] as const).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => onTypeChange(type)}
                                    className={`rounded-lg border px-4 py-3 text-sm font-medium transition ${
                                        agentType === type
                                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/20"
                                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                    }`}
                                >
                                    {type === "inbound"
                                        ? "Inbound (answers calls)"
                                        : "Outbound (places calls)"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Agent name */}
                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            Agent name
                        </label>
                        <Input
                            className="mt-2"
                            value={agentName}
                            onChange={(e) => {
                                setAgentName(e.target.value);
                                setTouchedName(true);
                            }}
                            placeholder="e.g. Nashville Homebuyers - Front Desk"
                        />
                        <p className="mt-1.5 text-xs text-gray-400">
                            Shown in your dashboard and in VAPI.
                        </p>
                    </div>

                    {/* Submit */}
                    <div className="flex items-center justify-end gap-3 pt-4">
                        <Button variant="outline" onClick={onBack}>
                            Cancel
                        </Button>
                        <Button
                            disabled={!canSubmit}
                            onClick={() => onSubmit(agentName.trim(), agentType)}
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                "Create agent"
                            )}
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

// ─── DEPLOYING ───

function Deploying() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4"
            >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-200">
                    <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
                </div>
                <div className="text-center">
                    <p className="text-lg font-semibold text-gray-900">
                        Creating your agent…
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                        Wiring up the voice, prompt, and calendar tools.
                    </p>
                </div>
            </motion.div>
        </div>
    );
}

// ─── ERROR ───

function ErrorScreen({
    message,
    onRetry,
    onCancelHref,
}: {
    message: string;
    onRetry: () => void;
    onCancelHref: string;
}) {
    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
                <h1 className="text-lg font-semibold text-gray-900">
                    Couldn't create agent
                </h1>
                <p className="mt-2 text-sm text-red-600">{message}</p>
                <div className="mt-6 flex gap-3">
                    <Button onClick={onRetry}>Try again</Button>
                    <Link href={onCancelHref}>
                        <Button variant="outline">Back to agents</Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
