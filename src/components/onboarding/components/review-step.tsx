"use client";

import { Loader2, Sparkles, Building2, Wrench, MessageSquare, Clock, Target } from "lucide-react";
import type { TenantProfile, AIFieldMeta } from "../types";
import { INDUSTRIES, BRAND_VOICES, TIMEZONES, DAYS_OF_WEEK, GOAL_OPTIONS, formatLeadSourceLabel } from "../constants";
import { Badge } from "@/components/ui/badge";

interface ReviewStepProps {
    form: TenantProfile;
    fieldMeta: Record<string, AIFieldMeta>;
    completing: boolean;
    onComplete: () => void;
    onGoToStep: (step: number) => void;
}

function ReviewField({ label, value }: { label: string; value?: string }) {
    return (
        <div className="flex items-start gap-3 py-1">
            <span className="text-sm text-gray-500 w-32 flex-shrink-0">{label}</span>
            <span className="text-sm text-gray-900">
                {value || <span className="text-gray-300 italic">Not set</span>}
            </span>
        </div>
    );
}

function SectionCard({
    title,
    icon: Icon,
    stepIndex,
    onEdit,
    children,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    stepIndex: number;
    onEdit: (step: number) => void;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
                type="button"
                onClick={() => onEdit(stepIndex)}
                className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-semibold text-gray-700">{title}</span>
                </div>
                <span className="text-xs text-violet-600 font-medium">Edit</span>
            </button>
            <div className="px-5 py-4 space-y-2">{children}</div>
        </div>
    );
}

export function ReviewStep({ form, fieldMeta, completing, onComplete, onGoToStep }: ReviewStepProps) {
    const hasAIData = Object.values(fieldMeta).some((m) => m.aiGenerated);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Review & Complete</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Review your profile before completing onboarding. You can always update these later.
                </p>
                {hasAIData && (
                    <div className="mt-3 flex items-center gap-2">
                        <Badge variant="default" className="gap-1">
                            <Sparkles className="w-3 h-3" />
                            AI-Assisted Profile
                        </Badge>
                        <span className="text-xs text-gray-400">Fields were pre-filled by AI from your website</span>
                    </div>
                )}
            </div>

            {/* Business Identity */}
            <SectionCard title="Business Identity" icon={Building2} stepIndex={1} onEdit={onGoToStep}>
                <ReviewField label="Industry" value={INDUSTRIES.find((i) => i.value === form.industry)?.label} />
                <ReviewField label="Sub-industry" value={form.sub_industry} />
                <ReviewField label="Description" value={form.business_description} />
                <ReviewField label="Website" value={form.website} />
            </SectionCard>

            {/* Service Details */}
            <SectionCard title="Service Details" icon={Wrench} stepIndex={2} onEdit={onGoToStep}>
                <ReviewField
                    label="Service Area"
                    value={
                        form.service_area.cities.length > 0
                            ? `${form.service_area.cities.join(", ")} (${form.service_area.radius_miles}mi radius)`
                            : undefined
                    }
                />
                <ReviewField
                    label="Job Types"
                    value={
                        form.job_types.length > 0
                            ? form.job_types.map((jt) => jt.name).filter(Boolean).join(", ")
                            : undefined
                    }
                />
            </SectionCard>

            {/* Brand Voice */}
            <SectionCard title="Brand Voice" icon={MessageSquare} stepIndex={3} onEdit={onGoToStep}>
                <ReviewField label="Voice Style" value={BRAND_VOICES.find((v) => v.value === form.brand_voice)?.label} />
                <ReviewField label="Greeting Style" value={form.greeting_style} />
            </SectionCard>

            {/* Business Hours */}
            <SectionCard title="Business Hours" icon={Clock} stepIndex={4} onEdit={onGoToStep}>
                <ReviewField label="Timezone" value={TIMEZONES.find((tz) => tz.value === form.timezone)?.label} />
                <ReviewField
                    label="Schedule"
                    value={
                        DAYS_OF_WEEK
                            .filter(({ key }) => !form.business_hours[key]?.closed)
                            .map(({ key, label }) => {
                                const h = form.business_hours[key];
                                return `${label.slice(0, 3)} ${h?.open || "08:00"}-${h?.close || "17:00"}`;
                            })
                            .join(", ") || "No hours set"
                    }
                />
                <ReviewField label="After Hours" value={form.after_hours_behavior} />
                <ReviewField label="Emergency Phone" value={form.emergency_phone} />
            </SectionCard>

            {/* Lead Config */}
            <SectionCard title="Lead Configuration" icon={Target} stepIndex={5} onEdit={onGoToStep}>
                <ReviewField
                    label="Lead Sources"
                    value={
                        form.lead_sources.length > 0
                            ? form.lead_sources.map(formatLeadSourceLabel).join(", ")
                            : undefined
                    }
                />
                <ReviewField
                    label="Primary Goal"
                    value={GOAL_OPTIONS.find((g) => g.value === form.primary_goal)?.label}
                />
            </SectionCard>

            {/* Complete Button */}
            <div className="pt-4">
                <button
                    type="button"
                    onClick={onComplete}
                    disabled={completing}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
                >
                    {completing ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Completing Setup...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-5 h-5" />
                            Complete Onboarding
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
