"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
    Rocket,
    Target,
    Settings,
    Phone,
    ArrowRight,
    ArrowLeft,
    Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { normalizeToE164, isValidPhone } from "@/lib/phone-utils";
import { TIMEZONES } from "@/components/onboarding/constants";
import { SAAS_DEMO_TYPES } from "@/lib/verticals/saas/definition";
import type {
    SaaSFormData,
    VerticalValidationError,
} from "@/lib/verticals/types";

interface SaaSVerticalFormProps {
    initialData?: Partial<SaaSFormData>;
    onContinue: (data: SaaSFormData) => void;
    onBack: () => void;
}

export function SaaSVerticalForm({
    initialData,
    onContinue,
    onBack,
}: SaaSVerticalFormProps) {
    const [companyName, setCompanyName] = useState(
        initialData?.companyName ?? ""
    );
    const [productOneLiner, setProductOneLiner] = useState(
        initialData?.productOneLiner ?? ""
    );
    const [ownerName, setOwnerName] = useState(initialData?.ownerName ?? "");
    const [ownerEmail, setOwnerEmail] = useState(initialData?.ownerEmail ?? "");
    const [agentPersonaName, setAgentPersonaName] = useState(
        initialData?.agentPersonaName ?? "Alex"
    );
    const [icpDescription, setIcpDescription] = useState(
        initialData?.icpDescription ?? ""
    );
    const [valueProps, setValueProps] = useState(initialData?.valueProps ?? "");
    const [commonObjections, setCommonObjections] = useState(
        initialData?.commonObjections ?? ""
    );
    const [pricingSummary, setPricingSummary] = useState(
        initialData?.pricingSummary ?? ""
    );
    const [demoType, setDemoType] = useState(initialData?.demoType ?? "zoom");
    const [timezone, setTimezone] = useState(initialData?.timezone ?? "");
    const [businessPhone, setBusinessPhone] = useState(
        initialData?.businessPhone ?? ""
    );

    const [errors, setErrors] = useState<VerticalValidationError[]>([]);
    const errorFor = (field: string) =>
        errors.find((e) => e.field === field)?.message;

    const validate = useCallback((): boolean => {
        const e: VerticalValidationError[] = [];
        const err = (field: string, message: string) =>
            e.push({ field, message, severity: "error" });

        if (companyName.trim().length < 2)
            err("companyName", "Company name is required");
        if (productOneLiner.trim().length < 10)
            err("productOneLiner", "Describe what your product does");
        if (ownerName.trim().length < 2) err("ownerName", "Your name is required");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim()))
            err("ownerEmail", "Valid email is required");
        if (agentPersonaName.trim().length < 1)
            err("agentPersonaName", "Agent name is required");
        if (icpDescription.trim().length < 10)
            err("icpDescription", "Describe who the agent will call");
        if (valueProps.trim().length < 10)
            err("valueProps", "Add at least one talking point");
        if (!demoType) err("demoType", "Pick how the demo is delivered");
        if (!timezone) err("timezone", "Timezone is required");
        if (!isValidPhone(businessPhone))
            err("businessPhone", "Valid phone number is required");

        setErrors(e);
        return e.length === 0;
    }, [
        companyName,
        productOneLiner,
        ownerName,
        ownerEmail,
        agentPersonaName,
        icpDescription,
        valueProps,
        demoType,
        timezone,
        businessPhone,
    ]);

    const handleContinue = useCallback(() => {
        if (!validate()) return;

        // validate() passed → normalizeToE164 is non-null.
        const callback = normalizeToE164(businessPhone)!;

        const data: SaaSFormData = {
            companyName: companyName.trim(),
            productOneLiner: productOneLiner.trim(),
            ownerName: ownerName.trim(),
            ownerEmail: ownerEmail.trim(),
            agentPersonaName: agentPersonaName.trim(),
            icpDescription: icpDescription.trim(),
            valueProps: valueProps.trim(),
            commonObjections: commonObjections.trim(),
            pricingSummary: pricingSummary.trim(),
            demoType,
            timezone,
            businessPhone: callback,
            // Outbound transfer + prompt config collected on the next phase.
            // Carry through prior values so back/forward doesn't wipe edits.
            outboundTransfer:
                initialData?.outboundTransfer ?? {
                    firstName: ownerName.trim().split(/\s+/)[0] || "",
                    role: "account executive",
                    phone: callback,
                    mode: "warm-summary",
                },
            outboundGoal: initialData?.outboundGoal ?? "book_demo_inbound_lead",
            outboundScenario: initialData?.outboundScenario ?? "",
            outboundPrompt: initialData?.outboundPrompt ?? "",
            outboundFirstMessage: initialData?.outboundFirstMessage ?? "",
        };

        onContinue(data);
    }, [
        validate,
        companyName,
        productOneLiner,
        ownerName,
        ownerEmail,
        agentPersonaName,
        icpDescription,
        valueProps,
        commonObjections,
        pricingSummary,
        demoType,
        timezone,
        businessPhone,
        initialData,
        onContinue,
    ]);

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
                        className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">
                        SaaS Companies Setup
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Book more demos with an AI SDR that calls your inbound
                        leads. Fill in your details below.
                    </p>
                </div>

                <div className="space-y-4">
                    {/* Company Info */}
                    <Section icon={Rocket} title="Company Info">
                        <Field label="Company Name" required error={errorFor("companyName")}>
                            <Input
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                placeholder="e.g., Omnify"
                            />
                        </Field>
                        <Field
                            label="What does your product do? (one sentence)"
                            required
                            error={errorFor("productOneLiner")}
                            help="The agent uses this to explain your product in plain language."
                        >
                            <Textarea
                                value={productOneLiner}
                                onChange={(e) => setProductOneLiner(e.target.value)}
                                rows={2}
                                placeholder="e.g., Omnify is an AI voice platform that calls and qualifies your leads so you book more meetings."
                            />
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Your Full Name" required error={errorFor("ownerName")}>
                                <Input
                                    value={ownerName}
                                    onChange={(e) => setOwnerName(e.target.value)}
                                    placeholder="e.g., Bhavesh Bhatia"
                                />
                            </Field>
                            <Field label="Your Email" required error={errorFor("ownerEmail")}>
                                <Input
                                    type="email"
                                    value={ownerEmail}
                                    onChange={(e) => setOwnerEmail(e.target.value)}
                                    placeholder="e.g., you@company.com"
                                />
                            </Field>
                        </div>
                        <Field
                            label="AI Agent Name"
                            required
                            error={errorFor("agentPersonaName")}
                            help="The name your AI agent uses on calls."
                        >
                            <Input
                                value={agentPersonaName}
                                onChange={(e) => setAgentPersonaName(e.target.value)}
                                placeholder="e.g., Alex"
                            />
                        </Field>
                    </Section>

                    {/* Pitch & Audience */}
                    <Section icon={Target} title="Pitch & Audience">
                        <Field
                            label="Who are these leads?"
                            required
                            error={errorFor("icpDescription")}
                            help="Describe the marketing-sourced leads the agent will call."
                        >
                            <Textarea
                                value={icpDescription}
                                onChange={(e) => setIcpDescription(e.target.value)}
                                rows={2}
                                placeholder="e.g., Founders and sales leaders at B2B companies who requested info from a marketing campaign."
                            />
                        </Field>
                        <Field
                            label="Key talking points / value props"
                            required
                            error={errorFor("valueProps")}
                            help="Top reasons a lead should take a demo. One per line."
                        >
                            <Textarea
                                value={valueProps}
                                onChange={(e) => setValueProps(e.target.value)}
                                rows={4}
                                placeholder={
                                    "- Books 30% more demos automatically\n- Calls every lead in under 60 seconds\n- Works 24/7, no SDR headcount"
                                }
                            />
                        </Field>
                        <Field
                            label="Common objections (optional)"
                            help="Objections the agent should be ready to handle."
                        >
                            <Textarea
                                value={commonObjections}
                                onChange={(e) => setCommonObjections(e.target.value)}
                                rows={2}
                                placeholder="e.g., 'We already have SDRs', 'Too expensive', 'AI sounds robotic'"
                            />
                        </Field>
                        <Field
                            label="Pricing summary (optional)"
                            help="If blank, the agent never quotes a price — it defers to the demo."
                        >
                            <Textarea
                                value={pricingSummary}
                                onChange={(e) => setPricingSummary(e.target.value)}
                                rows={2}
                                placeholder="e.g., Starts at $X/mo. Leave blank to defer pricing to the demo."
                            />
                        </Field>
                    </Section>

                    {/* Demo & Operations */}
                    <Section icon={Settings} title="Demo & Operations">
                        <Field
                            label="How is the demo delivered?"
                            required
                            error={errorFor("demoType")}
                            help="Determines how the agent confirms the booked demo."
                        >
                            <div className="flex flex-wrap gap-2">
                                {SAAS_DEMO_TYPES.map((opt) => {
                                    const selected = demoType === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setDemoType(opt.value)}
                                            className={cn(
                                                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                                                selected
                                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                            )}
                                        >
                                            {selected && <Check className="h-3.5 w-3.5" />}
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>
                        <Field label="Timezone" required error={errorFor("timezone")}>
                            <select
                                value={timezone}
                                onChange={(e) => setTimezone(e.target.value)}
                                className={cn(
                                    "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500",
                                    errorFor("timezone") && "border-red-300"
                                )}
                            >
                                <option value="">Select timezone...</option>
                                {TIMEZONES.map((tz) => (
                                    <option key={tz.value} value={tz.value}>
                                        {tz.label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </Section>

                    {/* Callback */}
                    <Section icon={Phone} title="Callback Number">
                        <Field
                            label="Business Callback Number"
                            required
                            error={errorFor("businessPhone")}
                            help="Number the AI leaves in voicemail. Include country code — e.g. +1 212 555 1212."
                        >
                            <Input
                                type="tel"
                                value={businessPhone}
                                onChange={(e) => setBusinessPhone(e.target.value)}
                                placeholder="+1 (212) 555-1212"
                            />
                        </Field>
                    </Section>
                </div>

                <div className="mt-6 flex justify-end">
                    <Button
                        onClick={handleContinue}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                        Configure Outbound Agent
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── LAYOUT HELPERS ───

function Section({
    icon: Icon,
    title,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                    <Icon className="h-4.5 w-4.5 text-emerald-600" />
                </div>
                <span className="text-sm font-semibold text-gray-900">{title}</span>
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function Field({
    label,
    required,
    error,
    help,
    children,
}: {
    label: string;
    required?: boolean;
    error?: string;
    help?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {label}
                {required && <span className="ml-0.5 text-red-400">*</span>}
            </label>
            {children}
            {help && !error && (
                <p className="mt-1 text-xs text-gray-400">{help}</p>
            )}
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
    );
}
