"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
    Building2, Wrench, MessageSquare, Clock, Target,
    ChevronDown, RotateCcw, ArrowRight, Sparkles, Plus, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
    INDUSTRIES,
    BRAND_VOICES,
    TIMEZONES,
    DAYS_OF_WEEK,
    LEAD_SOURCE_OPTIONS,
    GOAL_OPTIONS,
    formatLeadSourceLabel,
} from "@/components/onboarding/constants";
import type { TenantProfile, AIFieldMeta } from "../types";

// ─── PROPS ───

interface ProfileReviewProps {
    form: TenantProfile;
    fieldMeta: Record<string, AIFieldMeta>;
    businessName: string;
    updateField: <K extends keyof TenantProfile>(field: K, value: TenantProfile[K]) => void;
    resetFieldToAI: (field: keyof TenantProfile) => void;
    addJobType: () => void;
    updateJobType: (index: number, field: string, value: string) => void;
    removeJobType: (index: number) => void;
    updateServiceAreaCities: (value: string) => void;
    updateServiceAreaZips: (value: string) => void;
    updateServiceAreaRadius: (value: number) => void;
    updateHours: (day: string, field: "open" | "close" | "closed", value: string | boolean) => void;
    toggleLeadSource: (source: string) => void;
    onContinue: () => void;
}

// ─── SECTION WRAPPER ───

function Section({
    title,
    icon: Icon,
    defaultOpen = false,
    children,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
                onClick={() => setOpen(!open)}
                className="flex w-full items-center justify-between px-5 py-4"
            >
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
                        <Icon className="h-4.5 w-4.5 text-violet-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{title}</span>
                </div>
                <ChevronDown
                    className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        open && "rotate-180"
                    )}
                />
            </button>
            {open && <div className="border-t border-gray-100 px-5 pb-5 pt-4">{children}</div>}
        </div>
    );
}

// ─── CONFIDENCE BADGE ───

function ConfidenceBadge({ field, fieldMeta, resetFieldToAI }: {
    field: keyof TenantProfile;
    fieldMeta: Record<string, AIFieldMeta>;
    resetFieldToAI: (field: keyof TenantProfile) => void;
}) {
    const meta = fieldMeta[field];
    if (!meta?.aiGenerated) return null;

    return (
        <div className="flex items-center gap-2">
            <span
                className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    meta.confidence === "high"
                        ? "bg-emerald-50 text-emerald-600"
                        : meta.confidence === "medium"
                          ? "bg-amber-50 text-amber-600"
                          : "bg-gray-50 text-gray-500"
                )}
            >
                <Sparkles className="h-2.5 w-2.5" />
                AI {meta.confidence}
            </span>
            {meta.userEdited && (
                <button
                    onClick={() => resetFieldToAI(field)}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-violet-600 hover:bg-violet-50"
                >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset
                </button>
            )}
        </div>
    );
}

// ─── FIELD LABEL ───

function FieldLabel({ label, field, fieldMeta, resetFieldToAI }: {
    label: string;
    field: keyof TenantProfile;
    fieldMeta: Record<string, AIFieldMeta>;
    resetFieldToAI: (field: keyof TenantProfile) => void;
}) {
    return (
        <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-700">{label}</label>
            <ConfidenceBadge field={field} fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
        </div>
    );
}

// ─── MAIN COMPONENT ───

export function ProfileReview({
    form,
    fieldMeta,
    businessName,
    updateField,
    resetFieldToAI,
    addJobType,
    updateJobType,
    removeJobType,
    updateServiceAreaCities,
    updateServiceAreaZips,
    updateServiceAreaRadius,
    updateHours,
    toggleLeadSource,
    onContinue,
}: ProfileReviewProps) {
    const enabledCount = Object.keys(fieldMeta).filter(
        (k) => fieldMeta[k]?.aiGenerated
    ).length;

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            {/* Header */}
            <div className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6">
                <div className="mx-auto max-w-3xl">
                    <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                        Review Your Business Profile
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        {businessName ? `${businessName} — ` : ""}
                        {enabledCount > 0
                            ? `AI filled ${enabledCount} fields. Review and edit as needed.`
                            : "Fill in your business details to help configure your AI agents."}
                    </p>
                </div>
            </div>

            {/* Sections */}
            <div className="flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6">
                <div className="mx-auto max-w-3xl space-y-4">
                    {/* 1. Business Identity */}
                    <Section title="Business Identity" icon={Building2} defaultOpen={true}>
                        <div className="space-y-4">
                            <div>
                                <FieldLabel label="Industry" field="industry" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <select
                                    value={form.industry}
                                    onChange={(e) => updateField("industry", e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                >
                                    <option value="">Select industry...</option>
                                    {INDUSTRIES.map((i) => (
                                        <option key={i.value} value={i.value}>{i.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <FieldLabel label="Sub-Industry / Specialty" field="sub_industry" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <Input
                                    value={form.sub_industry}
                                    onChange={(e) => updateField("sub_industry", e.target.value)}
                                    placeholder="e.g. HVAC, Plumbing, Dental..."
                                    className="border-gray-200 bg-white text-gray-900"
                                />
                            </div>

                            <div>
                                <FieldLabel label="Business Description" field="business_description" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <textarea
                                    value={form.business_description}
                                    onChange={(e) => updateField("business_description", e.target.value)}
                                    rows={3}
                                    placeholder="Describe your business, services, and what makes you unique..."
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                />
                            </div>

                            <div>
                                <FieldLabel label="Website" field="website" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <Input
                                    value={form.website}
                                    onChange={(e) => updateField("website", e.target.value)}
                                    placeholder="https://www.yourbusiness.com"
                                    className="border-gray-200 bg-white text-gray-900"
                                />
                            </div>
                        </div>
                    </Section>

                    {/* 2. Service Details */}
                    <Section title="Service Details" icon={Wrench}>
                        <div className="space-y-4">
                            <div>
                                <FieldLabel label="Service Area — Cities" field="service_area" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <Input
                                    value={form.service_area.cities.join(", ")}
                                    onChange={(e) => updateServiceAreaCities(e.target.value)}
                                    placeholder="Austin, Round Rock, Cedar Park..."
                                    className="border-gray-200 bg-white text-gray-900"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-gray-700">Service Area — Zip Codes</label>
                                <Input
                                    value={form.service_area.zip_codes.join(", ")}
                                    onChange={(e) => updateServiceAreaZips(e.target.value)}
                                    placeholder="78701, 78702, 78703..."
                                    className="border-gray-200 bg-white text-gray-900"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-gray-700">Service Radius (miles)</label>
                                <Input
                                    type="number"
                                    value={form.service_area.radius_miles}
                                    onChange={(e) => updateServiceAreaRadius(Number(e.target.value))}
                                    className="w-32 border-gray-200 bg-white text-gray-900"
                                />
                            </div>

                            {/* Job Types */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <FieldLabel label="Job / Service Types" field="job_types" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                </div>
                                <div className="space-y-3">
                                    {form.job_types.map((jt, idx) => (
                                        <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 space-y-2">
                                                    <Input
                                                        value={jt.name}
                                                        onChange={(e) => updateJobType(idx, "name", e.target.value)}
                                                        placeholder="Service name (e.g. AC Repair)"
                                                        className="border-gray-200 bg-white text-sm text-gray-900"
                                                    />
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <select
                                                            value={jt.urgency_tier}
                                                            onChange={(e) => updateJobType(idx, "urgency_tier", e.target.value)}
                                                            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900"
                                                        >
                                                            <option value="low">Low Urgency</option>
                                                            <option value="medium">Medium Urgency</option>
                                                            <option value="high">High Urgency</option>
                                                            <option value="critical">Critical</option>
                                                        </select>
                                                        <Input
                                                            value={jt.avg_ticket}
                                                            onChange={(e) => updateJobType(idx, "avg_ticket", e.target.value)}
                                                            placeholder="Avg ticket $"
                                                            className="border-gray-200 bg-white text-xs text-gray-900"
                                                        />
                                                        <Input
                                                            value={jt.keywords}
                                                            onChange={(e) => updateJobType(idx, "keywords", e.target.value)}
                                                            placeholder="Keywords"
                                                            className="border-gray-200 bg-white text-xs text-gray-900"
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => removeJobType(idx)}
                                                    className="mt-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={addJobType}
                                    className="mt-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Job Type
                                </button>
                            </div>
                        </div>
                    </Section>

                    {/* 3. Brand Voice */}
                    <Section title="Brand Voice" icon={MessageSquare}>
                        <div className="space-y-4">
                            <div>
                                <FieldLabel label="Brand Voice" field="brand_voice" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    {BRAND_VOICES.map((bv) => (
                                        <button
                                            key={bv.value}
                                            onClick={() => updateField("brand_voice", bv.value)}
                                            className={cn(
                                                "rounded-lg border px-3 py-2 text-left transition-colors",
                                                form.brand_voice === bv.value
                                                    ? "border-violet-300 bg-violet-50 text-violet-700"
                                                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                                            )}
                                        >
                                            <span className="block text-xs font-medium">{bv.label}</span>
                                            <span className="block text-[10px] text-gray-400">{bv.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <FieldLabel label="Custom Phrases (JSON)" field="custom_phrases" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <textarea
                                    value={form.custom_phrases}
                                    onChange={(e) => updateField("custom_phrases", e.target.value)}
                                    rows={4}
                                    placeholder={'{\n  "always_mention": ["satisfaction guarantee"],\n  "never_say": ["cheapest"]\n}'}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                />
                            </div>

                            <div>
                                <FieldLabel label="Greeting Style" field="greeting_style" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <textarea
                                    value={form.greeting_style}
                                    onChange={(e) => updateField("greeting_style", e.target.value)}
                                    rows={2}
                                    placeholder="How should agents greet callers? e.g. 'Thank you for calling [Business], this is [Agent Name], how can I help you today?'"
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                />
                            </div>
                        </div>
                    </Section>

                    {/* 4. Business Hours */}
                    <Section title="Business Hours" icon={Clock}>
                        <div className="space-y-4">
                            <div>
                                <FieldLabel label="Timezone" field="timezone" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <select
                                    value={form.timezone}
                                    onChange={(e) => updateField("timezone", e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                >
                                    {TIMEZONES.map((tz) => (
                                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <FieldLabel label="Weekly Schedule" field="business_hours" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <div className="space-y-2">
                                    {DAYS_OF_WEEK.map(({ key, label }) => {
                                        const day = form.business_hours[key];
                                        return (
                                            <div key={key} className="flex items-center gap-3">
                                                <div className="w-20 text-xs font-medium text-gray-700">{label}</div>
                                                <Switch
                                                    checked={!day?.closed}
                                                    onCheckedChange={(checked) => updateHours(key, "closed", !checked)}
                                                />
                                                {!day?.closed && (
                                                    <>
                                                        <Input
                                                            type="time"
                                                            value={day?.open || "08:00"}
                                                            onChange={(e) => updateHours(key, "open", e.target.value)}
                                                            className="w-28 border-gray-200 bg-white text-xs text-gray-900"
                                                        />
                                                        <span className="text-xs text-gray-400">to</span>
                                                        <Input
                                                            type="time"
                                                            value={day?.close || "17:00"}
                                                            onChange={(e) => updateHours(key, "close", e.target.value)}
                                                            className="w-28 border-gray-200 bg-white text-xs text-gray-900"
                                                        />
                                                    </>
                                                )}
                                                {day?.closed && (
                                                    <span className="text-xs text-gray-400">Closed</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <FieldLabel label="After-Hours Behavior" field="after_hours_behavior" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <select
                                    value={form.after_hours_behavior}
                                    onChange={(e) => updateField("after_hours_behavior", e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                >
                                    <option value="voicemail">Send to voicemail</option>
                                    <option value="take_message">Take a message</option>
                                    <option value="emergency_forward">Forward to emergency line</option>
                                    <option value="schedule_callback">Schedule a callback</option>
                                </select>
                            </div>

                            <div>
                                <FieldLabel label="Emergency Phone Number" field="emergency_phone" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <Input
                                    value={form.emergency_phone}
                                    onChange={(e) => updateField("emergency_phone", e.target.value)}
                                    placeholder="+1 (555) 123-4567"
                                    className="border-gray-200 bg-white text-gray-900"
                                />
                            </div>
                        </div>
                    </Section>

                    {/* 5. Lead Configuration */}
                    <Section title="Lead Configuration" icon={Target}>
                        <div className="space-y-4">
                            <div>
                                <FieldLabel label="Lead Sources" field="lead_sources" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <div className="flex flex-wrap gap-2">
                                    {LEAD_SOURCE_OPTIONS.map((source) => (
                                        <button
                                            key={source}
                                            onClick={() => toggleLeadSource(source)}
                                            className={cn(
                                                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                                form.lead_sources.includes(source)
                                                    ? "border-violet-300 bg-violet-50 text-violet-700"
                                                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                                            )}
                                        >
                                            {formatLeadSourceLabel(source)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <FieldLabel label="Primary Goal" field="primary_goal" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <select
                                    value={form.primary_goal}
                                    onChange={(e) => updateField("primary_goal", e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                >
                                    <option value="">Select primary goal...</option>
                                    {GOAL_OPTIONS.map((g) => (
                                        <option key={g.value} value={g.value}>{g.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <FieldLabel label="Qualification Criteria (JSON)" field="qualification_criteria" fieldMeta={fieldMeta} resetFieldToAI={resetFieldToAI} />
                                <textarea
                                    value={form.qualification_criteria}
                                    onChange={(e) => updateField("qualification_criteria", e.target.value)}
                                    rows={4}
                                    placeholder={'{\n  "must_have": ["in service area"],\n  "nice_to_have": ["homeowner"],\n  "disqualifiers": ["out of state"]\n}'}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                />
                            </div>
                        </div>
                    </Section>
                </div>
            </div>

            {/* Fixed bottom bar */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/90 px-4 py-4 backdrop-blur-lg sm:px-6">
                <div className="mx-auto flex max-w-3xl items-center justify-end">
                    <Button
                        onClick={onContinue}
                        className="bg-violet-600 px-6 text-white hover:bg-violet-500"
                    >
                        Continue to Agent Setup
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
