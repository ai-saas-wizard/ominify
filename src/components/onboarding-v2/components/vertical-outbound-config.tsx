"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, PhoneOutgoing, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    RE_OUTBOUND_GOALS,
    buildREOutboundStarter,
} from "@/lib/verticals/real-estate-investor/outbound-prompt-templates";
import type {
    REInvestorFormData,
    REOutboundGoal,
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
    // If we already have a saved goal/prompt (going back & forward), use those.
    // Otherwise default to re_engage_prior_offer with its starter pre-filled.
    const initialStarter = useMemo(() => {
        if (formData.outboundPrompt && formData.outboundFirstMessage) {
            return {
                systemPrompt: formData.outboundPrompt,
                firstMessage: formData.outboundFirstMessage,
            };
        }
        return buildREOutboundStarter(formData.outboundGoal, formData);
    }, [formData]);

    const [goal, setGoal] = useState<REOutboundGoal>(formData.outboundGoal);
    const [systemPrompt, setSystemPrompt] = useState<string>(
        initialStarter.systemPrompt
    );
    const [firstMessage, setFirstMessage] = useState<string>(
        initialStarter.firstMessage
    );

    const handleGoalChange = useCallback(
        (next: REOutboundGoal) => {
            setGoal(next);
            const starter = buildREOutboundStarter(next, formData);
            setSystemPrompt(starter.systemPrompt);
            setFirstMessage(starter.firstMessage);
        },
        [formData]
    );

    const handleResetToStarter = useCallback(() => {
        const starter = buildREOutboundStarter(goal, formData);
        setSystemPrompt(starter.systemPrompt);
        setFirstMessage(starter.firstMessage);
    }, [goal, formData]);

    const handleContinue = useCallback(() => {
        onContinue({
            ...formData,
            outboundGoal: goal,
            outboundPrompt: systemPrompt,
            outboundFirstMessage: firstMessage,
        });
    }, [formData, goal, systemPrompt, firstMessage, onContinue]);

    const canContinue = systemPrompt.trim().length > 0 && firstMessage.trim().length > 0;

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
                                Pick a goal, then tweak the agent's script before deploying.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Goal selector */}
                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-3 text-sm font-semibold text-gray-900">
                        What should this outbound agent do?
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
                                            isSelected ? "text-emerald-700" : "text-gray-900"
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

                {/* Available variables hint */}
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <div className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                        <div className="text-xs text-amber-900">
                            <p className="font-semibold">Available variables (filled in at call time):</p>
                            <ul className="mt-1 space-y-0.5">
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_data}}`}</code> — JSON
                                    of everything we know about this seller (their name, property, prior offers, etc.)
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_field_legend}}`}</code> — what
                                    each key in the JSON means
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_name}}`}</code>,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_phone}}`}</code>,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{contact_email}}`}</code>
                                </li>
                                <li>
                                    <code className="rounded bg-amber-100 px-1">{`{{currentDate}}`}</code>,{" "}
                                    <code className="rounded bg-amber-100 px-1">{`{{tenantTimezone}}`}</code>
                                </li>
                            </ul>
                            <p className="mt-2 italic">
                                Add human-friendly descriptions for each custom field under{" "}
                                <span className="font-semibold not-italic">Settings → Custom Fields</span> — the
                                agent uses those descriptions to interpret each value at call time.
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
                            Reset to starter
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
                <div className="flex justify-end gap-3">
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
            </motion.div>
        </div>
    );
}
