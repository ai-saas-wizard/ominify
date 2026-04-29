"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
    Building2,
    MapPin,
    Phone,
    ArrowRight,
    ArrowLeft,
    ChevronDown,
    Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TIMEZONES } from "@/components/onboarding/constants";
import { getVertical } from "@/lib/verticals/registry";
import type {
    VerticalFormSection,
    VerticalFormFieldDef,
    REInvestorFormData,
    VerticalValidationError,
} from "@/lib/verticals/types";

// ─── PROPS ───

interface VerticalFormProps {
    verticalId: string;
    initialData?: Partial<REInvestorFormData>;
    onContinue: (data: REInvestorFormData) => void;
    onBack: () => void;
}

export function VerticalForm({
    verticalId,
    initialData,
    onContinue,
    onBack,
}: VerticalFormProps) {
    const vertical = getVertical(verticalId);

    // Form state
    const [fields, setFields] = useState<Record<string, string | string[]>>({
        companyName: initialData?.companyName ?? "",
        ownerName: initialData?.ownerName ?? "",
        ownerEmail: initialData?.ownerEmail ?? "",
        agentPersonaName: initialData?.agentPersonaName ?? "Sam",
        markets: initialData?.markets ?? "",
        dealTypes: initialData?.dealTypes ?? [],
        timezone: initialData?.timezone ?? "",
        appointmentType: initialData?.appointmentType ?? "in_person",
        inboundTransferFirstName:
            initialData?.inboundTransfer?.firstName ?? "",
        inboundTransferRole:
            initialData?.inboundTransfer?.role ?? "lead manager",
        inboundTransferPhone:
            initialData?.inboundTransfer?.phone ?? "",
        inboundTransferMode:
            initialData?.inboundTransfer?.mode ?? "warm-summary",
        businessPhone: initialData?.businessPhone ?? "",
    });

    const [errors, setErrors] = useState<VerticalValidationError[]>([]);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        company: true,
        operations: true,
        inbound_transfer: true,
        callback: true,
    });

    const updateField = useCallback(
        (key: string, value: string | string[]) => {
            setFields((prev) => ({ ...prev, [key]: value }));
            // Clear error for this field
            setErrors((prev) => prev.filter((e) => e.field !== key));
        },
        []
    );

    const toggleSection = useCallback((sectionId: string) => {
        setOpenSections((prev) => ({
            ...prev,
            [sectionId]: !prev[sectionId],
        }));
    }, []);

    const toggleDealType = useCallback(
        (value: string) => {
            const current = (fields.dealTypes as string[]) || [];
            const updated = current.includes(value)
                ? current.filter((v) => v !== value)
                : [...current, value];
            updateField("dealTypes", updated);
        },
        [fields.dealTypes, updateField]
    );

    // Validation
    const validate = useCallback((): boolean => {
        const newErrors: VerticalValidationError[] = [];

        if (!fields.companyName || (fields.companyName as string).trim().length < 2) {
            newErrors.push({
                field: "companyName",
                message: "Company name is required",
                severity: "error",
            });
        }
        if (!fields.ownerName || (fields.ownerName as string).trim().length < 2) {
            newErrors.push({
                field: "ownerName",
                message: "Your name is required",
                severity: "error",
            });
        }
        if (
            !fields.ownerEmail ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.ownerEmail as string)
        ) {
            newErrors.push({
                field: "ownerEmail",
                message: "Valid email is required",
                severity: "error",
            });
        }
        if (
            !fields.agentPersonaName ||
            (fields.agentPersonaName as string).trim().length < 1
        ) {
            newErrors.push({
                field: "agentPersonaName",
                message: "Agent name is required",
                severity: "error",
            });
        }
        if (!fields.markets || (fields.markets as string).trim().length < 2) {
            newErrors.push({
                field: "markets",
                message: "At least one market/area is required",
                severity: "error",
            });
        }
        if (!fields.dealTypes || (fields.dealTypes as string[]).length === 0) {
            newErrors.push({
                field: "dealTypes",
                message: "Select at least one deal type",
                severity: "error",
            });
        }
        if (!fields.timezone) {
            newErrors.push({
                field: "timezone",
                message: "Timezone is required",
                severity: "error",
            });
        }
        if (
            !fields.inboundTransferFirstName ||
            (fields.inboundTransferFirstName as string).trim().length < 1
        ) {
            newErrors.push({
                field: "inboundTransferFirstName",
                message: "First name of the transfer specialist is required",
                severity: "error",
            });
        }
        if (
            !fields.inboundTransferRole ||
            (fields.inboundTransferRole as string).trim().length < 1
        ) {
            newErrors.push({
                field: "inboundTransferRole",
                message: "Role of the transfer specialist is required",
                severity: "error",
            });
        }
        if (
            !fields.inboundTransferPhone ||
            !isValidPhone(fields.inboundTransferPhone as string)
        ) {
            newErrors.push({
                field: "inboundTransferPhone",
                message: "Valid 10-digit phone number is required",
                severity: "error",
            });
        }
        if (!fields.businessPhone || !isValidPhone(fields.businessPhone as string)) {
            newErrors.push({
                field: "businessPhone",
                message: "Valid 10-digit phone number is required",
                severity: "error",
            });
        }

        setErrors(newErrors);

        // Open sections with errors
        if (newErrors.length > 0) {
            const sectionMap: Record<string, string[]> = {
                company: ["companyName", "ownerName", "ownerEmail", "agentPersonaName"],
                operations: ["markets", "dealTypes", "timezone", "appointmentType"],
                inbound_transfer: [
                    "inboundTransferFirstName",
                    "inboundTransferRole",
                    "inboundTransferPhone",
                    "inboundTransferMode",
                ],
                callback: ["businessPhone"],
            };
            for (const [sectionId, sectionFields] of Object.entries(sectionMap)) {
                if (newErrors.some((e) => sectionFields.includes(e.field))) {
                    setOpenSections((prev) => ({ ...prev, [sectionId]: true }));
                }
            }
        }

        return newErrors.length === 0;
    }, [fields]);

    const handleContinue = useCallback(() => {
        if (!validate()) return;

        const inboundTransferFirstName = (
            fields.inboundTransferFirstName as string
        ).trim();
        const inboundTransferPhone = (
            fields.inboundTransferPhone as string
        ).trim();

        const formData: REInvestorFormData = {
            companyName: (fields.companyName as string).trim(),
            ownerName: (fields.ownerName as string).trim(),
            ownerEmail: (fields.ownerEmail as string).trim(),
            agentPersonaName: (fields.agentPersonaName as string).trim(),
            markets: (fields.markets as string).trim(),
            dealTypes: fields.dealTypes as string[],
            timezone: fields.timezone as string,
            appointmentType: fields.appointmentType as string,
            businessPhone: (fields.businessPhone as string).trim(),
            inboundTransfer: {
                firstName: inboundTransferFirstName,
                role: (fields.inboundTransferRole as string).trim(),
                phone: inboundTransferPhone,
                mode:
                    (fields.inboundTransferMode as
                        | "warm-summary"
                        | "cold") || "warm-summary",
            },
            // Outbound transfer config — collected on the outbound-config phase.
            // Default it to mirror inbound so deploy works even if the user clicks
            // straight through; they can change it on the outbound phase.
            outboundTransfer: initialData?.outboundTransfer ?? {
                firstName: inboundTransferFirstName,
                role: (fields.inboundTransferRole as string).trim(),
                phone: inboundTransferPhone,
                mode:
                    (fields.inboundTransferMode as
                        | "warm-summary"
                        | "cold") || "warm-summary",
            },
            // Outbound config — collected on the next phase. Carry through any
            // values from initialData so going back/forward doesn't wipe edits.
            outboundGoal: initialData?.outboundGoal ?? "re_engage_prior_offer",
            outboundScenario: initialData?.outboundScenario ?? "",
            outboundPrompt: initialData?.outboundPrompt ?? "",
            outboundFirstMessage: initialData?.outboundFirstMessage ?? "",
        };

        onContinue(formData);
    }, [fields, validate, onContinue, initialData]);

    if (!vertical) {
        return <div className="p-8 text-center text-red-600">Vertical not found</div>;
    }

    const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
        company: Building2,
        operations: MapPin,
        contact: Phone,
    };

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
                        {vertical.name} Setup
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        {vertical.tagline}. Fill in your business details below.
                    </p>
                </div>

                {/* Sections */}
                <div className="space-y-4">
                    {vertical.formSections.map((section) => {
                        const Icon = SECTION_ICONS[section.id] || Building2;
                        const isOpen = openSections[section.id] ?? true;

                        return (
                            <div
                                key={section.id}
                                className="rounded-xl border border-gray-200 bg-white shadow-sm"
                            >
                                <button
                                    onClick={() => toggleSection(section.id)}
                                    className="flex w-full items-center justify-between px-5 py-4"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                                            <Icon className="h-4.5 w-4.5 text-emerald-600" />
                                        </div>
                                        <div className="text-left">
                                            <span className="text-sm font-semibold text-gray-900">
                                                {section.title}
                                            </span>
                                            {section.description && (
                                                <p className="text-xs text-gray-400">
                                                    {section.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <ChevronDown
                                        className={cn(
                                            "h-4 w-4 text-gray-400 transition-transform",
                                            isOpen && "rotate-180"
                                        )}
                                    />
                                </button>

                                {isOpen && (
                                    <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                                        {section.fields.map((field) =>
                                            renderField(
                                                field,
                                                fields,
                                                updateField,
                                                toggleDealType,
                                                errors
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Continue Button */}
                <div className="mt-6 flex justify-end">
                    <Button
                        onClick={handleContinue}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                        Review & Deploy
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── FIELD RENDERER ───

function renderField(
    field: VerticalFormFieldDef,
    values: Record<string, string | string[]>,
    updateField: (key: string, value: string | string[]) => void,
    toggleDealType: (value: string) => void,
    errors: VerticalValidationError[]
) {
    const error = errors.find((e) => e.field === field.key);
    const value = values[field.key];

    return (
        <div key={field.key}>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {field.label}
                {field.required && <span className="ml-0.5 text-red-400">*</span>}
            </label>

            {field.type === "text" || field.type === "email" ? (
                <Input
                    type={field.type}
                    value={(value as string) || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className={cn(error && "border-red-300 focus:ring-red-500")}
                />
            ) : field.type === "phone" ? (
                <Input
                    type="tel"
                    value={(value as string) || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className={cn(error && "border-red-300 focus:ring-red-500")}
                />
            ) : field.type === "textarea" ? (
                <Textarea
                    value={(value as string) || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    rows={3}
                    className={cn(error && "border-red-300 focus:ring-red-500")}
                />
            ) : field.type === "timezone" ? (
                <select
                    value={(value as string) || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    className={cn(
                        "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500",
                        error && "border-red-300 focus:ring-red-500"
                    )}
                >
                    <option value="">Select timezone...</option>
                    {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                            {tz.label}
                        </option>
                    ))}
                </select>
            ) : field.type === "single-select" && field.options ? (
                <div className="flex flex-wrap gap-2">
                    {field.options.map((option) => {
                        const selected = (value as string) === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => updateField(field.key, option.value)}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                                    selected
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                )}
                            >
                                {selected && (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            ) : field.type === "multi-select" && field.options ? (
                <div className="flex flex-wrap gap-2">
                    {field.options.map((option) => {
                        const selected = ((value as string[]) || []).includes(
                            option.value
                        );
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => toggleDealType(option.value)}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                                    selected
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                )}
                            >
                                {selected && (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {field.helpText && !error && (
                <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>
            )}

            {error && (
                <p className="mt-1 text-xs text-red-500">{error.message}</p>
            )}
        </div>
    );
}

// ─── HELPERS ───

function isValidPhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}
