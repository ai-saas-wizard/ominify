"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    PhoneOutgoing,
    Sparkles,
    Wand2,
    Loader2,
    AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { normalizeToE164 } from "@/lib/phone-utils";
import {
    RE_OUTBOUND_GOALS,
    buildREOutboundStarter,
} from "@/lib/verticals/real-estate-investor/outbound-prompt-templates";
import { generateOutboundPromptFromScenario } from "@/app/actions/generate-outbound-prompt";
import type {
    REInvestorFormData,
    REOutboundGoal,
    TransferMode,
    TransferSpecialist,
} from "@/lib/verticals/types";

interface VerticalOutboundConfigProps {
    formData: REInvestorFormData;
    onContinue: (updated: REInvestorFormData) => void;
    onBack: () => void;
}

export function VerticalOutboundConfig({
    formData,
    onContinue,
    onBack,
}: VerticalOutboundConfigProps) {
    // Outbound transfer specialist state — defaults to whatever was carried
    // through from the main form (initially mirrors inbound).
    const [transferFirstName, setTransferFirstName] = useState(
        formData.outboundTransfer.firstName
    );
    const [transferRole, setTransferRole] = useState(
        formData.outboundTransfer.role
    );
    const [transferPhone, setTransferPhone] = useState(
        formData.outboundTransfer.phone
    );
    const [transferMode, setTransferMode] = useState<TransferMode>(
        formData.outboundTransfer.mode
    );

    // Goal + scenario + prompt state
    const [goal, setGoal] = useState<REOutboundGoal>(formData.outboundGoal);
    const [scenario, setScenario] = useState<string>(
        formData.outboundScenario || ""
    );
    const [generating, setGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);

    const initialStarter = useMemo(() => {
        if (formData.outboundPrompt && formData.outboundFirstMessage) {
            return {
                systemPrompt: formData.outboundPrompt,
                firstMessage: formData.outboundFirstMessage,
            };
        }
        // Build with the current outbound transfer config so the starter
        // references the right tool name (e.g. gary_transfer).
        return buildREOutboundStarter(formData.outboundGoal, formData);
    }, [formData]);

    const [systemPrompt, setSystemPrompt] = useState<string>(
        initialStarter.systemPrompt
    );
    const [firstMessage, setFirstMessage] = useState<string>(
        initialStarter.firstMessage
    );

    // Build a snapshot of formData with the current outbound transfer config
    // so any starter/AI generation reads the right transfer-specialist values.
    const buildSnapshot = useCallback(
        (): REInvestorFormData => ({
            ...formData,
            outboundTransfer: {
                firstName: transferFirstName.trim(),
                role: transferRole.trim(),
                phone: transferPhone.trim(),
                mode: transferMode,
            },
            outboundGoal: goal,
            outboundScenario: scenario,
            outboundPrompt: systemPrompt,
            outboundFirstMessage: firstMessage,
        }),
        [
            formData,
            transferFirstName,
            transferRole,
            transferPhone,
            transferMode,
            goal,
            scenario,
            systemPrompt,
            firstMessage,
        ]
    );

    const handleGoalChange = useCallback(
        (next: REOutboundGoal) => {
            setGoal(next);
            const snapshot: REInvestorFormData = {
                ...formData,
                outboundTransfer: {
                    firstName: transferFirstName.trim(),
                    role: transferRole.trim(),
                    phone: transferPhone.trim(),
                    mode: transferMode,
                },
                outboundGoal: next,
                outboundScenario: scenario,
                outboundPrompt: "",
                outboundFirstMessage: "",
            };
            const starter = buildREOutboundStarter(next, snapshot);
            setSystemPrompt(starter.systemPrompt);
            setFirstMessage(starter.firstMessage);
        },
        [
            formData,
            scenario,
            transferFirstName,
            transferRole,
            transferPhone,
            transferMode,
        ]
    );

    const handleResetToStarter = useCallback(() => {
        const snapshot = buildSnapshot();
        const starter = buildREOutboundStarter(goal, snapshot);
        setSystemPrompt(starter.systemPrompt);
        setFirstMessage(starter.firstMessage);
    }, [goal, buildSnapshot]);

    const handleGenerateFromScenario = useCallback(async () => {
        setGenerationError(null);
        if (scenario.trim().length < 20) {
            setGenerationError(
                "Describe your scenario in at least a sentence or two before generating."
            );
            return;
        }
        if (!transferFirstName.trim() || !transferPhone.trim()) {
            setGenerationError(
                "Fill in the outbound transfer specialist details first — the prompt references that person's tool name."
            );
            return;
        }
        setGenerating(true);
        try {
            const snapshot = buildSnapshot();
            const result = await generateOutboundPromptFromScenario(
                snapshot,
                scenario
            );
            if (result.success && result.systemPrompt && result.firstMessage) {
                setSystemPrompt(result.systemPrompt);
                setFirstMessage(result.firstMessage);
            } else {
                setGenerationError(
                    result.error || "Generation failed — please try again."
                );
            }
        } catch (err: any) {
            setGenerationError(err?.message || "Generation failed.");
        } finally {
            setGenerating(false);
        }
    }, [
        scenario,
        transferFirstName,
        transferPhone,
        buildSnapshot,
    ]);

    const phoneE164 = normalizeToE164(transferPhone);
    const phoneInvalid = transferPhone.trim().length > 0 && !phoneE164;

    const handleContinue = useCallback(() => {
        if (!phoneE164) return;
        const outboundTransfer: TransferSpecialist = {
            firstName: transferFirstName.trim(),
            role: transferRole.trim(),
            phone: phoneE164,
            mode: transferMode,
        };
        onContinue({
            ...formData,
            outboundTransfer,
            outboundGoal: goal,
            outboundScenario: scenario,
            outboundPrompt: systemPrompt,
            outboundFirstMessage: firstMessage,
        });
    }, [
        formData,
        transferFirstName,
        transferRole,
        phoneE164,
        transferMode,
        goal,
        scenario,
        systemPrompt,
        firstMessage,
        onContinue,
    ]);

    const transferComplete =
        transferFirstName.trim().length > 0 &&
        transferRole.trim().length > 0 &&
        !!phoneE164;

    const canContinue =
        transferComplete &&
        systemPrompt.trim().length > 0 &&
        firstMessage.trim().length > 0;

    const transferToolPreview = transferFirstName.trim()
        ? `${transferFirstName
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "")}_transfer`
        : "specialist_transfer";

    return (
        <div className="flex min-h-screen items-start justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-3xl"
            >
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={onBack}
                        className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
                            <PhoneOutgoing className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">
                                Configure Outbound Agent
                            </h1>
                            <p className="mt-1 text-sm text-gray-500">
                                Pick who handles transfers, then either describe your
                                scenario or pick a starter goal.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Outbound transfer specialist */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-1 text-sm font-semibold text-gray-900">
                        Outbound Transfer Specialist
                    </h2>
                    <p className="mb-4 text-xs text-gray-500">
                        Who should the outbound agent warm-transfer to when a seller
                        asks for a human? The transfer tool will be named after them
                        (e.g. <code className="rounded bg-gray-100 px-1 font-mono">{transferToolPreview}</code>)
                        — and your prompt references that exact tool name.
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="ot-first-name" className="mb-1.5 block">
                                First name
                            </Label>
                            <Input
                                id="ot-first-name"
                                value={transferFirstName}
                                onChange={(e) =>
                                    setTransferFirstName(e.target.value)
                                }
                                placeholder="e.g., Gary"
                            />
                        </div>
                        <div>
                            <Label htmlFor="ot-role" className="mb-1.5 block">
                                Their role
                            </Label>
                            <Input
                                id="ot-role"
                                value={transferRole}
                                onChange={(e) => setTransferRole(e.target.value)}
                                placeholder="e.g., lead manager"
                            />
                        </div>
                        <div>
                            <Label htmlFor="ot-phone" className="mb-1.5 block">
                                Their phone number
                            </Label>
                            <Input
                                id="ot-phone"
                                type="tel"
                                value={transferPhone}
                                onChange={(e) => setTransferPhone(e.target.value)}
                                placeholder="+1 (212) 555-1212"
                                aria-invalid={phoneInvalid}
                                className={cn(
                                    phoneInvalid && "border-red-400 focus-visible:ring-red-300"
                                )}
                            />
                            {phoneInvalid ? (
                                <p className="mt-1 text-xs text-red-500">
                                    Please enter a valid phone number — include country code (e.g. +1 212 555 1212).
                                </p>
                            ) : (
                                <p className="mt-1 text-xs text-gray-400">
                                    Include country code — e.g. +1 212 555 1212.
                                </p>
                            )}
                        </div>
                        <div>
                            <Label htmlFor="ot-mode" className="mb-1.5 block">
                                Transfer style
                            </Label>
                            <Select
                                value={transferMode}
                                onValueChange={(v) =>
                                    setTransferMode(v as TransferMode)
                                }
                            >
                                <SelectTrigger id="ot-mode">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="warm-summary">
                                        Warm + AI-spoken summary
                                    </SelectItem>
                                    <SelectItem value="cold">
                                        Cold (connect immediately)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {transferMode === "warm-summary" && transferComplete && (
                        <p className="mt-3 text-[11px] text-emerald-700">
                            Before connecting the seller, the AI will brief{" "}
                            {transferFirstName.trim()} (the {transferRole.trim()})
                            on the call in 3–4 spoken sentences.
                        </p>
                    )}
                </div>

                {/* Goal selector */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 text-sm font-semibold text-gray-900">
                        Pick a starter goal
                    </h2>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {RE_OUTBOUND_GOALS.map((opt) => {
                            const isSelected = goal === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleGoalChange(opt.value)}
                                    className={cn(
                                        "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                                        isSelected
                                            ? "border-emerald-400 bg-emerald-50/40 ring-1 ring-emerald-200"
                                            : "border-gray-200 bg-white hover:border-gray-300"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "text-sm font-medium",
                                            isSelected
                                                ? "text-emerald-700"
                                                : "text-gray-900"
                                        )}
                                    >
                                        {opt.label}
                                    </span>
                                    <span className="mt-1 text-xs text-gray-500">
                                        {opt.description}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Scenario → AI generate */}
                <div className="mb-5 rounded-xl border border-purple-200 bg-purple-50/30 p-5">
                    <div className="mb-2 flex items-center gap-2">
                        <Wand2 className="h-4 w-4 text-purple-600" />
                        <h2 className="text-sm font-semibold text-gray-900">
                            Or describe your scenario — we'll generate the prompt
                        </h2>
                    </div>
                    <p className="mb-3 text-xs text-gray-600">
                        Tell us in plain English: who you're calling, what you want
                        out of the call, what objections you expect. We'll write a
                        VAPI-grade prompt around your transfer specialist + tools.
                    </p>
                    <Textarea
                        value={scenario}
                        onChange={(e) => setScenario(e.target.value)}
                        rows={5}
                        placeholder={`e.g., We send postcards to homeowners in Davidson County who own multiple rental properties. When they call back, we book them — but we also want an outbound version that re-engages them 30 days after the postcard if they never called. Goal: get them on the phone, ask if they're tired of managing tenants, and book ${transferFirstName.trim() || "Gary"} to give them a number.`}
                        className="bg-white"
                    />
                    {generationError && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>{generationError}</span>
                        </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                        <p className="text-[11px] text-gray-400">
                            {scenario.length.toLocaleString()} characters
                        </p>
                        <Button
                            onClick={handleGenerateFromScenario}
                            disabled={generating || scenario.trim().length < 20}
                            className="bg-purple-600 hover:bg-purple-700"
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating…
                                </>
                            ) : (
                                <>
                                    <Wand2 className="h-4 w-4" />
                                    Generate prompt
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Available variables hint */}
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <div className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                        <div className="text-xs text-amber-900">
                            <p className="font-semibold">
                                Available variables (filled in at call time):
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_data}}`}</code>{" "}
                                    — JSON of everything we know about this seller
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_field_legend}}`}</code>{" "}
                                    — what each key in the JSON means
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_name}}`}</code>
                                    ,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_phone}}`}</code>
                                    ,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_email}}`}</code>
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{currentDate}}`}</code>
                                    ,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{tenantTimezone}}`}</code>
                                </li>
                            </ul>
                            <p className="mt-2 italic">
                                Add human-friendly descriptions for each custom
                                field under{" "}
                                <span className="font-semibold not-italic">
                                    Settings → Custom Fields
                                </span>{" "}
                                — the agent uses those descriptions to interpret each
                                value at call time.
                            </p>
                        </div>
                    </div>
                </div>

                {/* First message */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <label
                            htmlFor="outbound-first-message"
                            className="text-sm font-semibold text-gray-900"
                        >
                            First message
                        </label>
                        <span className="text-[10px] text-gray-400">
                            What the agent says first when the call connects.
                        </span>
                    </div>
                    <Textarea
                        id="outbound-first-message"
                        value={firstMessage}
                        onChange={(e) => setFirstMessage(e.target.value)}
                        rows={2}
                        className="font-mono text-sm"
                    />
                </div>

                {/* System prompt */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <label
                            htmlFor="outbound-system-prompt"
                            className="text-sm font-semibold text-gray-900"
                        >
                            System prompt
                        </label>
                        <button
                            type="button"
                            onClick={handleResetToStarter}
                            className="text-xs text-emerald-600 hover:text-emerald-700"
                        >
                            Reset to {goal === "custom" ? "scaffold" : "goal starter"}
                        </button>
                    </div>
                    <Textarea
                        id="outbound-system-prompt"
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={28}
                        className="font-mono text-xs leading-relaxed"
                    />
                    <p className="mt-2 text-[11px] text-gray-400">
                        {systemPrompt.length.toLocaleString()} characters
                    </p>
                </div>

                {/* Continue */}
                <div className="flex items-center justify-between gap-3">
                    {!transferComplete && (
                        <p className="text-[11px] text-amber-600">
                            Fill in the transfer specialist above to continue.
                        </p>
                    )}
                    <div className="ml-auto flex gap-3">
                        <Button variant="outline" onClick={onBack}>
                            Back
                        </Button>
                        <Button
                            onClick={handleContinue}
                            disabled={!canContinue}
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                        >
                            Continue to review
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

