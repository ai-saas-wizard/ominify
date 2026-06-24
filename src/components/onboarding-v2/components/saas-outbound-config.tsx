"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    PhoneOutgoing,
    MessageSquare,
    Sparkles,
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
    SAAS_OUTBOUND_GOALS,
    buildSaaSOutboundStarter,
} from "@/lib/verticals/saas/outbound-prompt-templates";
import { buildSaaSSmsStarter } from "@/lib/verticals/saas/sms-prompt-templates";
import type {
    SaaSFormData,
    SaaSOutboundGoal,
    TransferMode,
    TransferSpecialist,
} from "@/lib/verticals/types";

interface SaaSOutboundConfigProps {
    formData: SaaSFormData;
    onContinue: (updated: SaaSFormData) => void;
    onBack: () => void;
}

export function SaaSOutboundConfig({
    formData,
    onContinue,
    onBack,
}: SaaSOutboundConfigProps) {
    // Human-closer transfer specialist — defaults to what came through the form.
    const [transferFirstName, setTransferFirstName] = useState(
        formData.outboundTransfer.firstName
    );
    const [transferRole, setTransferRole] = useState(
        formData.outboundTransfer.role || "account executive"
    );
    const [transferPhone, setTransferPhone] = useState(
        formData.outboundTransfer.phone
    );
    const [transferMode, setTransferMode] = useState<TransferMode>(
        formData.outboundTransfer.mode
    );

    const [goal, setGoal] = useState<SaaSOutboundGoal>(formData.outboundGoal);

    const initialStarter = useMemo(() => {
        if (formData.outboundPrompt && formData.outboundFirstMessage) {
            return {
                systemPrompt: formData.outboundPrompt,
                firstMessage: formData.outboundFirstMessage,
            };
        }
        return buildSaaSOutboundStarter(formData.outboundGoal, formData);
    }, [formData]);

    const [systemPrompt, setSystemPrompt] = useState(
        initialStarter.systemPrompt
    );
    const [firstMessage, setFirstMessage] = useState(
        initialStarter.firstMessage
    );

    // SMS channel prompt — same offer context, texting personality. Seeded from
    // the builder unless the user already edited it.
    const initialSms = useMemo(() => {
        if (formData.smsPrompt && formData.smsFirstMessage) {
            return {
                smsPrompt: formData.smsPrompt,
                smsFirstMessage: formData.smsFirstMessage,
            };
        }
        return buildSaaSSmsStarter(formData.outboundGoal, formData);
    }, [formData]);

    const [smsPrompt, setSmsPrompt] = useState(initialSms.smsPrompt);
    const [smsFirstMessage, setSmsFirstMessage] = useState(
        initialSms.smsFirstMessage
    );

    const snapshotWith = useCallback(
        (nextGoal: SaaSOutboundGoal): SaaSFormData => ({
            ...formData,
            outboundTransfer: {
                firstName: transferFirstName.trim(),
                role: transferRole.trim(),
                phone: transferPhone.trim(),
                mode: transferMode,
            },
            outboundGoal: nextGoal,
        }),
        [formData, transferFirstName, transferRole, transferPhone, transferMode]
    );

    const handleGoalChange = useCallback(
        (next: SaaSOutboundGoal) => {
            setGoal(next);
            const starter = buildSaaSOutboundStarter(next, snapshotWith(next));
            setSystemPrompt(starter.systemPrompt);
            setFirstMessage(starter.firstMessage);
            const sms = buildSaaSSmsStarter(next, snapshotWith(next));
            setSmsPrompt(sms.smsPrompt);
            setSmsFirstMessage(sms.smsFirstMessage);
        },
        [snapshotWith]
    );

    const handleResetToStarter = useCallback(() => {
        const starter = buildSaaSOutboundStarter(goal, snapshotWith(goal));
        setSystemPrompt(starter.systemPrompt);
        setFirstMessage(starter.firstMessage);
    }, [goal, snapshotWith]);

    const handleResetSmsToStarter = useCallback(() => {
        const sms = buildSaaSSmsStarter(goal, snapshotWith(goal));
        setSmsPrompt(sms.smsPrompt);
        setSmsFirstMessage(sms.smsFirstMessage);
    }, [goal, snapshotWith]);

    const phoneE164 = normalizeToE164(transferPhone);
    const phoneInvalid = transferPhone.trim().length > 0 && !phoneE164;

    const transferComplete =
        transferFirstName.trim().length > 0 &&
        transferRole.trim().length > 0 &&
        !!phoneE164;

    const canContinue =
        transferComplete &&
        systemPrompt.trim().length > 0 &&
        firstMessage.trim().length > 0 &&
        smsPrompt.trim().length > 0 &&
        smsFirstMessage.trim().length > 0;

    const transferToolPreview = transferFirstName.trim()
        ? `${transferFirstName.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}_transfer`
        : "specialist_transfer";

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
            outboundScenario: "",
            outboundPrompt: systemPrompt,
            outboundFirstMessage: firstMessage,
            smsPrompt,
            smsFirstMessage,
        });
    }, [
        phoneE164,
        transferFirstName,
        transferRole,
        transferMode,
        formData,
        goal,
        systemPrompt,
        firstMessage,
        smsPrompt,
        smsFirstMessage,
        onContinue,
    ]);

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
                                Pick who handles transfers, choose a goal, then
                                fine-tune the prompt.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Transfer specialist */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-1 text-sm font-semibold text-gray-900">
                        Human Closer (transfer target)
                    </h2>
                    <p className="mb-4 text-xs text-gray-500">
                        Who should the agent warm-transfer hot leads to? The
                        transfer tool is named after them (e.g.{" "}
                        <code className="rounded bg-gray-100 px-1 font-mono">
                            {transferToolPreview}
                        </code>
                        ).
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="ot-first-name" className="mb-1.5 block">
                                First name
                            </Label>
                            <Input
                                id="ot-first-name"
                                value={transferFirstName}
                                onChange={(e) => setTransferFirstName(e.target.value)}
                                placeholder="e.g., Bhavesh"
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
                                placeholder="e.g., account executive"
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
                                    phoneInvalid &&
                                        "border-red-400 focus-visible:ring-red-300"
                                )}
                            />
                            {phoneInvalid ? (
                                <p className="mt-1 text-xs text-red-500">
                                    Enter a valid number — include country code.
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
                            Before connecting the lead, the AI briefs{" "}
                            {transferFirstName.trim()} (the {transferRole.trim()})
                            on the call in 3–4 spoken sentences.
                        </p>
                    )}
                </div>

                {/* Goal selector */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 text-sm font-semibold text-gray-900">
                        Pick the outbound goal
                    </h2>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {SAAS_OUTBOUND_GOALS.map((opt) => {
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

                {/* Variables hint */}
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
                                    — JSON of everything we know about this lead
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
                        </div>
                    </div>
                </div>

                {/* First message */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <label
                            htmlFor="saas-first-message"
                            className="text-sm font-semibold text-gray-900"
                        >
                            First message
                        </label>
                        <span className="text-[10px] text-gray-400">
                            What the agent says first when the call connects.
                        </span>
                    </div>
                    <Textarea
                        id="saas-first-message"
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
                            htmlFor="saas-system-prompt"
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
                        id="saas-system-prompt"
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={28}
                        className="font-mono text-xs leading-relaxed"
                    />
                    <p className="mt-2 text-[11px] text-gray-400">
                        {systemPrompt.length.toLocaleString()} characters
                    </p>
                </div>

                {/* SMS channel header */}
                <div className="mb-4 mt-8 flex items-center gap-3 border-t border-gray-200 pt-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
                        <MessageSquare className="h-5 w-5 text-sky-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">
                            How this agent texts (SMS)
                        </h2>
                        <p className="text-xs text-gray-500">
                            Same offer, texting personality. Drives outbound SMS and
                            auto-replies when a sequence uses this agent.
                        </p>
                    </div>
                </div>

                {/* SMS first message */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <label
                            htmlFor="saas-sms-first-message"
                            className="text-sm font-semibold text-gray-900"
                        >
                            First text
                        </label>
                        <span className="text-[10px] text-gray-400">
                            The opening SMS. Use {`{{first_name}}`} for the name.
                        </span>
                    </div>
                    <Textarea
                        id="saas-sms-first-message"
                        value={smsFirstMessage}
                        onChange={(e) => setSmsFirstMessage(e.target.value)}
                        rows={2}
                        className="font-mono text-sm"
                    />
                </div>

                {/* SMS prompt */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <label
                            htmlFor="saas-sms-prompt"
                            className="text-sm font-semibold text-gray-900"
                        >
                            SMS prompt (texting persona &amp; rules)
                        </label>
                        <button
                            type="button"
                            onClick={handleResetSmsToStarter}
                            className="text-xs text-emerald-600 hover:text-emerald-700"
                        >
                            Reset to {goal === "custom" ? "scaffold" : "goal starter"}
                        </button>
                    </div>
                    <Textarea
                        id="saas-sms-prompt"
                        value={smsPrompt}
                        onChange={(e) => setSmsPrompt(e.target.value)}
                        rows={20}
                        className="font-mono text-xs leading-relaxed"
                    />
                    <p className="mt-2 text-[11px] text-gray-400">
                        {smsPrompt.length.toLocaleString()} characters
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
