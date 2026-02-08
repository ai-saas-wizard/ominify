"use client";

import { useState, useCallback } from "react";
import {
    Building2,
    Wrench,
    MessageSquare,
    Clock,
    Target,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Sparkles,
} from "lucide-react";
import { saveTenantProfile, completeOnboarding } from "@/app/actions/tenant-profile-actions";

// ─── TYPES ───

interface TenantProfile {
    industry: string;
    sub_industry: string;
    business_description: string;
    website: string;
    service_area: { cities: string[]; zip_codes: string[]; radius_miles: number };
    job_types: { name: string; urgency_tier: string; avg_ticket: string; keywords: string }[];
    typical_job_value: string;
    brand_voice: string;
    custom_phrases: string;
    greeting_style: string;
    timezone: string;
    business_hours: Record<string, { open: string; close: string; closed: boolean }>;
    after_hours_behavior: string;
    emergency_phone: string;
    lead_sources: string[];
    primary_goal: string;
    qualification_criteria: string;
}

interface OnboardingWizardProps {
    clientId: string;
    initialProfile: Record<string, unknown> | null;
}

// ─── CONSTANTS ───

const STEPS = [
    { label: "Business Identity", icon: Building2 },
    { label: "Service Details", icon: Wrench },
    { label: "Brand Voice", icon: MessageSquare },
    { label: "Business Hours", icon: Clock },
    { label: "Lead Config", icon: Target },
    { label: "Review & Complete", icon: CheckCircle },
];

const INDUSTRIES = [
    { value: "home_services", label: "Home Services" },
    { value: "real_estate", label: "Real Estate" },
    { value: "healthcare", label: "Healthcare" },
    { value: "legal", label: "Legal" },
    { value: "automotive", label: "Automotive" },
    { value: "restaurant", label: "Restaurant" },
    { value: "retail", label: "Retail" },
    { value: "professional_services", label: "Professional Services" },
    { value: "other", label: "Other" },
];

const BRAND_VOICES = [
    { value: "professional", label: "Professional", desc: "Polished and businesslike" },
    { value: "friendly", label: "Friendly", desc: "Warm and approachable" },
    { value: "casual", label: "Casual", desc: "Relaxed and conversational" },
    { value: "authoritative", label: "Authoritative", desc: "Confident and expert" },
];

const TIMEZONES = [
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
    { value: "America/Phoenix", label: "Arizona (no DST)" },
    { value: "America/Anchorage", label: "Alaska Time (AKT)" },
    { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
];

const DAYS_OF_WEEK = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
    { key: "fri", label: "Friday" },
    { key: "sat", label: "Saturday" },
    { key: "sun", label: "Sunday" },
];

const LEAD_SOURCE_OPTIONS = [
    "google_ads",
    "facebook_ads",
    "yelp",
    "thumbtack",
    "angi",
    "homeadvisor",
    "referral",
    "website_form",
    "phone_call",
    "other",
];

const GOAL_OPTIONS = [
    { value: "book_appointment", label: "Book Appointment" },
    { value: "phone_qualification", label: "Phone Qualification" },
    { value: "direct_schedule", label: "Direct Schedule" },
    { value: "collect_info", label: "Collect Information" },
    { value: "transfer_to_agent", label: "Transfer to Live Agent" },
];

// ─── HELPERS ───

function buildDefaultProfile(initial: Record<string, unknown> | null): TenantProfile {
    const defaultHours: Record<string, { open: string; close: string; closed: boolean }> = {};
    DAYS_OF_WEEK.forEach(({ key }) => {
        defaultHours[key] = { open: "08:00", close: "17:00", closed: key === "sat" || key === "sun" };
    });

    const existingHours = initial?.business_hours as Record<string, { open: string; close: string; closed?: boolean }> | null;
    if (existingHours && typeof existingHours === "object") {
        DAYS_OF_WEEK.forEach(({ key }) => {
            if (existingHours[key]) {
                defaultHours[key] = {
                    open: existingHours[key].open || "08:00",
                    close: existingHours[key].close || "17:00",
                    closed: existingHours[key].closed ?? false,
                };
            }
        });
    }

    const existingLeadSources = initial?.lead_sources as Array<{ source: string }> | string[] | null;
    let leadSources: string[] = [];
    if (Array.isArray(existingLeadSources)) {
        leadSources = existingLeadSources.map((s) =>
            typeof s === "string" ? s : s.source
        );
    }

    const existingServiceArea = initial?.service_area as { cities?: string[]; zip_codes?: string[]; radius_miles?: number } | null;
    const existingJobTypes = initial?.job_types as { name: string; urgency_tier: string; avg_ticket: string; keywords: string }[] | null;

    return {
        industry: (initial?.industry as string) || "",
        sub_industry: (initial?.sub_industry as string) || "",
        business_description: (initial?.business_description as string) || "",
        website: (initial?.website as string) || "",
        service_area: {
            cities: existingServiceArea?.cities || [],
            zip_codes: existingServiceArea?.zip_codes || [],
            radius_miles: existingServiceArea?.radius_miles || 25,
        },
        job_types: existingJobTypes || [],
        typical_job_value: "",
        brand_voice: (initial?.brand_voice as string) || "professional",
        custom_phrases: initial?.custom_phrases ? JSON.stringify(initial.custom_phrases, null, 2) : "",
        greeting_style: (initial?.greeting_style as string) || "",
        timezone: (initial?.timezone as string) || "America/New_York",
        business_hours: defaultHours,
        after_hours_behavior: (initial?.after_hours_behavior as string) || "voicemail",
        emergency_phone: (initial?.emergency_phone as string) || "",
        lead_sources: leadSources,
        primary_goal: (initial?.primary_goal as string) || "",
        qualification_criteria: initial?.qualification_criteria
            ? JSON.stringify(initial.qualification_criteria, null, 2)
            : "",
    };
}

function formatLeadSourceLabel(source: string): string {
    return source
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

// ─── COMPONENT ───

export function OnboardingWizard({ clientId, initialProfile }: OnboardingWizardProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [form, setForm] = useState<TenantProfile>(() => buildDefaultProfile(initialProfile));
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // ─── FORM HELPERS ───

    const updateField = useCallback(<K extends keyof TenantProfile>(field: K, value: TenantProfile[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    }, []);

    const buildFormData = useCallback((): FormData => {
        const fd = new FormData();
        fd.set("industry", form.industry);
        fd.set("sub_industry", form.sub_industry);
        fd.set("business_description", form.business_description);
        fd.set("website", form.website);
        fd.set("service_area", JSON.stringify(form.service_area));
        fd.set("job_types", JSON.stringify(form.job_types));
        fd.set("brand_voice", form.brand_voice);
        fd.set("custom_phrases", form.custom_phrases);
        fd.set("greeting_style", form.greeting_style);
        fd.set("timezone", form.timezone);
        fd.set("business_hours", JSON.stringify(form.business_hours));
        fd.set("after_hours_behavior", form.after_hours_behavior);
        fd.set("emergency_phone", form.emergency_phone);
        fd.set(
            "lead_sources",
            JSON.stringify(form.lead_sources.map((s) => ({ source: s, urgency_multiplier: 1.0 })))
        );
        fd.set("primary_goal", form.primary_goal);
        fd.set("qualification_criteria", form.qualification_criteria);
        return fd;
    }, [form]);

    const saveProgress = useCallback(async () => {
        setSaving(true);
        setSaveMessage(null);
        const fd = buildFormData();
        const result = await saveTenantProfile(clientId, fd);
        setSaving(false);

        if (result.success) {
            setSaveMessage({ type: "success", text: "Progress saved" });
            setTimeout(() => setSaveMessage(null), 3000);
        } else {
            setSaveMessage({ type: "error", text: result.error || "Failed to save" });
        }

        return result.success;
    }, [clientId, buildFormData]);

    // ─── NAVIGATION ───

    const goNext = async () => {
        if (currentStep < STEPS.length - 1) {
            const saved = await saveProgress();
            if (saved) {
                setCurrentStep((s) => s + 1);
            }
        }
    };

    const goPrev = () => {
        if (currentStep > 0) {
            setCurrentStep((s) => s - 1);
        }
    };

    const goToStep = (step: number) => {
        if (step >= 0 && step < STEPS.length) {
            setCurrentStep(step);
        }
    };

    const handleComplete = async () => {
        setCompleting(true);
        setSaveMessage(null);

        // Save all data first
        const fd = buildFormData();
        const saveResult = await saveTenantProfile(clientId, fd);

        if (!saveResult.success) {
            setSaveMessage({ type: "error", text: saveResult.error || "Failed to save profile" });
            setCompleting(false);
            return;
        }

        // Mark onboarding as complete
        const result = await completeOnboarding(clientId);
        setCompleting(false);

        if (result.success) {
            // Redirect to client dashboard
            window.location.href = `/client/${clientId}`;
        } else {
            setSaveMessage({ type: "error", text: result.error || "Failed to complete onboarding" });
        }
    };

    // ─── JOB TYPES HELPERS ───

    const addJobType = () => {
        updateField("job_types", [
            ...form.job_types,
            { name: "", urgency_tier: "medium", avg_ticket: "", keywords: "" },
        ]);
    };

    const updateJobType = (index: number, field: string, value: string) => {
        const updated = [...form.job_types];
        updated[index] = { ...updated[index], [field]: value };
        updateField("job_types", updated);
    };

    const removeJobType = (index: number) => {
        updateField(
            "job_types",
            form.job_types.filter((_, i) => i !== index)
        );
    };

    // ─── SERVICE AREA HELPERS ───

    const updateServiceAreaCities = (value: string) => {
        updateField("service_area", {
            ...form.service_area,
            cities: value.split(",").map((c) => c.trim()).filter(Boolean),
        });
    };

    const updateServiceAreaZips = (value: string) => {
        updateField("service_area", {
            ...form.service_area,
            zip_codes: value.split(",").map((z) => z.trim()).filter(Boolean),
        });
    };

    const updateServiceAreaRadius = (value: number) => {
        updateField("service_area", { ...form.service_area, radius_miles: value });
    };

    // ─── BUSINESS HOURS HELPERS ───

    const updateHours = (day: string, field: "open" | "close" | "closed", value: string | boolean) => {
        updateField("business_hours", {
            ...form.business_hours,
            [day]: { ...form.business_hours[day], [field]: value },
        });
    };

    // ─── LEAD SOURCES HELPER ───

    const toggleLeadSource = (source: string) => {
        if (form.lead_sources.includes(source)) {
            updateField("lead_sources", form.lead_sources.filter((s) => s !== source));
        } else {
            updateField("lead_sources", [...form.lead_sources, source]);
        }
    };

    // ─── RENDER STEP CONTENT ───

    const renderStep = () => {
        switch (currentStep) {
            case 0:
                return renderBusinessIdentity();
            case 1:
                return renderServiceDetails();
            case 2:
                return renderBrandVoice();
            case 3:
                return renderBusinessHours();
            case 4:
                return renderLeadConfig();
            case 5:
                return renderReview();
            default:
                return null;
        }
    };

    // ── Step 1: Business Identity ──

    const renderBusinessIdentity = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Business Identity</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Tell us about your business so we can tailor your AI agents accordingly.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Industry
                    </label>
                    <select
                        value={form.industry}
                        onChange={(e) => updateField("industry", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    >
                        <option value="">Select an industry...</option>
                        {INDUSTRIES.map((ind) => (
                            <option key={ind.value} value={ind.value}>
                                {ind.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Sub-industry / Specialization
                    </label>
                    <input
                        type="text"
                        value={form.sub_industry}
                        onChange={(e) => updateField("sub_industry", e.target.value)}
                        placeholder="e.g., HVAC, Plumbing, Roofing, Family Law..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Business Description
                    </label>
                    <textarea
                        value={form.business_description}
                        onChange={(e) => updateField("business_description", e.target.value)}
                        placeholder="Briefly describe what your business does, your key services, and what makes you unique..."
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Website
                    </label>
                    <input
                        type="url"
                        value={form.website}
                        onChange={(e) => updateField("website", e.target.value)}
                        placeholder="https://www.yourcompany.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                </div>
            </div>
        </div>
    );

    // ── Step 2: Service Details ──

    const renderServiceDetails = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Service Details</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Define your service area and the types of jobs you handle.
                </p>
            </div>

            {/* Service Area */}
            <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    Service Area
                </h3>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cities (comma-separated)
                    </label>
                    <input
                        type="text"
                        value={form.service_area.cities.join(", ")}
                        onChange={(e) => updateServiceAreaCities(e.target.value)}
                        placeholder="e.g., Dallas, Fort Worth, Arlington"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        ZIP Codes (comma-separated)
                    </label>
                    <input
                        type="text"
                        value={form.service_area.zip_codes.join(", ")}
                        onChange={(e) => updateServiceAreaZips(e.target.value)}
                        placeholder="e.g., 75001, 75002, 75003"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Service Radius (miles)
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={500}
                        value={form.service_area.radius_miles}
                        onChange={(e) => updateServiceAreaRadius(parseInt(e.target.value) || 25)}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                </div>
            </div>

            {/* Job Types */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Job Types
                    </h3>
                    <button
                        type="button"
                        onClick={addJobType}
                        className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                    >
                        + Add Job Type
                    </button>
                </div>

                {form.job_types.length === 0 && (
                    <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">
                            No job types added yet. Add the types of jobs your business handles.
                        </p>
                        <button
                            type="button"
                            onClick={addJobType}
                            className="mt-2 text-sm text-violet-600 hover:text-violet-700 font-medium"
                        >
                            + Add your first job type
                        </button>
                    </div>
                )}

                {form.job_types.map((jt, idx) => (
                    <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">Job Type #{idx + 1}</span>
                            <button
                                type="button"
                                onClick={() => removeJobType(idx)}
                                className="text-xs text-red-500 hover:text-red-700"
                            >
                                Remove
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <input
                                type="text"
                                value={jt.name}
                                onChange={(e) => updateJobType(idx, "name", e.target.value)}
                                placeholder="Job name (e.g., AC Repair)"
                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none text-sm"
                            />
                            <select
                                value={jt.urgency_tier}
                                onChange={(e) => updateJobType(idx, "urgency_tier", e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none text-sm"
                            >
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                            <input
                                type="text"
                                value={jt.avg_ticket}
                                onChange={(e) => updateJobType(idx, "avg_ticket", e.target.value)}
                                placeholder="Avg ticket (e.g., $250)"
                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none text-sm"
                            />
                            <input
                                type="text"
                                value={jt.keywords}
                                onChange={(e) => updateJobType(idx, "keywords", e.target.value)}
                                placeholder="Keywords (e.g., AC, cooling, heat)"
                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none text-sm"
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // ── Step 3: Brand Voice ──

    const renderBrandVoice = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Brand Voice</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Define how your AI agents should communicate with customers.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Voice Style
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        {BRAND_VOICES.map((voice) => (
                            <button
                                key={voice.value}
                                type="button"
                                onClick={() => updateField("brand_voice", voice.value)}
                                className={`p-4 rounded-lg border-2 text-left transition-all ${
                                    form.brand_voice === voice.value
                                        ? "border-violet-500 bg-violet-50"
                                        : "border-gray-200 hover:border-gray-300 bg-white"
                                }`}
                            >
                                <div className="font-medium text-gray-900">{voice.label}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{voice.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Custom Phrases / Brand Guidelines
                    </label>
                    <textarea
                        value={form.custom_phrases}
                        onChange={(e) => updateField("custom_phrases", e.target.value)}
                        placeholder={`Enter as JSON, e.g.:\n{\n  "always_mention": ["family-owned since 1985", "licensed & insured"],\n  "never_say": ["cheap", "discount"]\n}`}
                        rows={5}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                        JSON format with &quot;always_mention&quot; and &quot;never_say&quot; arrays.
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Greeting Style
                    </label>
                    <textarea
                        value={form.greeting_style}
                        onChange={(e) => updateField("greeting_style", e.target.value)}
                        placeholder='e.g., "Thanks for calling [Business Name], this is [Agent]. How can I help you today?"'
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                    />
                </div>
            </div>
        </div>
    );

    // ── Step 4: Business Hours ──

    const renderBusinessHours = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Business Hours</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Set your operating hours so AI agents know when to schedule and when to take messages.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Timezone
                    </label>
                    <select
                        value={form.timezone}
                        onChange={(e) => updateField("timezone", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    >
                        {TIMEZONES.map((tz) => (
                            <option key={tz.value} value={tz.value}>
                                {tz.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Weekly hours grid */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Weekly Schedule
                    </label>
                    <div className="space-y-2">
                        {DAYS_OF_WEEK.map(({ key, label }) => {
                            const dayHours = form.business_hours[key];
                            return (
                                <div
                                    key={key}
                                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                                        dayHours?.closed
                                            ? "bg-gray-50 border-gray-200"
                                            : "bg-white border-gray-200"
                                    }`}
                                >
                                    <div className="w-24 flex-shrink-0">
                                        <span className="text-sm font-medium text-gray-700">
                                            {label}
                                        </span>
                                    </div>

                                    <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                                        <input
                                            type="checkbox"
                                            checked={!dayHours?.closed}
                                            onChange={(e) => updateHours(key, "closed", !e.target.checked)}
                                            className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                                        />
                                        <span className="text-xs text-gray-500">Open</span>
                                    </label>

                                    {!dayHours?.closed && (
                                        <div className="flex items-center gap-2 ml-2">
                                            <input
                                                type="time"
                                                value={dayHours?.open || "08:00"}
                                                onChange={(e) => updateHours(key, "open", e.target.value)}
                                                className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                                            />
                                            <span className="text-gray-400 text-sm">to</span>
                                            <input
                                                type="time"
                                                value={dayHours?.close || "17:00"}
                                                onChange={(e) => updateHours(key, "close", e.target.value)}
                                                className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                                            />
                                        </div>
                                    )}

                                    {dayHours?.closed && (
                                        <span className="text-xs text-gray-400 ml-2">Closed</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        After-Hours Behavior
                    </label>
                    <select
                        value={form.after_hours_behavior}
                        onChange={(e) => updateField("after_hours_behavior", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    >
                        <option value="voicemail">Take a voicemail</option>
                        <option value="emergency_forward">Forward emergency calls</option>
                        <option value="schedule_callback">Schedule a callback</option>
                        <option value="ai_handle">AI handles all calls 24/7</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Emergency Phone Number
                    </label>
                    <input
                        type="tel"
                        value={form.emergency_phone}
                        onChange={(e) => updateField("emergency_phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                        Number to forward urgent after-hours calls to.
                    </p>
                </div>
            </div>
        </div>
    );

    // ── Step 5: Lead Config ──

    const renderLeadConfig = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Lead Configuration</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Configure where your leads come from and how they should be handled.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Lead Sources
                    </label>
                    <p className="text-xs text-gray-400 mb-3">
                        Select all the channels you receive leads from.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {LEAD_SOURCE_OPTIONS.map((source) => (
                            <button
                                key={source}
                                type="button"
                                onClick={() => toggleLeadSource(source)}
                                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                                    form.lead_sources.includes(source)
                                        ? "border-violet-500 bg-violet-50 text-violet-700"
                                        : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                                }`}
                            >
                                {formatLeadSourceLabel(source)}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Primary Goal
                    </label>
                    <select
                        value={form.primary_goal}
                        onChange={(e) => updateField("primary_goal", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    >
                        <option value="">Select primary goal...</option>
                        {GOAL_OPTIONS.map((goal) => (
                            <option key={goal.value} value={goal.value}>
                                {goal.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Qualification Criteria
                    </label>
                    <textarea
                        value={form.qualification_criteria}
                        onChange={(e) => updateField("qualification_criteria", e.target.value)}
                        placeholder={`Enter as JSON, e.g.:\n{\n  "must_have": ["location_in_service_area", "budget_above_minimum"],\n  "nice_to_have": ["referral_source", "repeat_customer"],\n  "disqualifiers": ["outside_service_area", "commercial_only"]\n}`}
                        rows={5}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                        JSON format defining how leads should be qualified.
                    </p>
                </div>
            </div>
        </div>
    );

    // ── Step 6: Review & Complete ──

    const renderReview = () => (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Review & Complete</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Review your profile before completing onboarding. You can always update these later.
                </p>
            </div>

            {/* Business Identity Summary */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => goToStep(0)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-semibold text-gray-700">Business Identity</span>
                    </div>
                    <span className="text-xs text-violet-600 font-medium">Edit</span>
                </button>
                <div className="px-5 py-4 space-y-2">
                    <ReviewField label="Industry" value={INDUSTRIES.find((i) => i.value === form.industry)?.label} />
                    <ReviewField label="Sub-industry" value={form.sub_industry} />
                    <ReviewField label="Description" value={form.business_description} />
                    <ReviewField label="Website" value={form.website} />
                </div>
            </div>

            {/* Service Details Summary */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => goToStep(1)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-semibold text-gray-700">Service Details</span>
                    </div>
                    <span className="text-xs text-violet-600 font-medium">Edit</span>
                </button>
                <div className="px-5 py-4 space-y-2">
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
                </div>
            </div>

            {/* Brand Voice Summary */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-semibold text-gray-700">Brand Voice</span>
                    </div>
                    <span className="text-xs text-violet-600 font-medium">Edit</span>
                </button>
                <div className="px-5 py-4 space-y-2">
                    <ReviewField
                        label="Voice Style"
                        value={BRAND_VOICES.find((v) => v.value === form.brand_voice)?.label}
                    />
                    <ReviewField label="Greeting Style" value={form.greeting_style} />
                </div>
            </div>

            {/* Business Hours Summary */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => goToStep(3)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-semibold text-gray-700">Business Hours</span>
                    </div>
                    <span className="text-xs text-violet-600 font-medium">Edit</span>
                </button>
                <div className="px-5 py-4 space-y-2">
                    <ReviewField
                        label="Timezone"
                        value={TIMEZONES.find((tz) => tz.value === form.timezone)?.label}
                    />
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
                </div>
            </div>

            {/* Lead Config Summary */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => goToStep(4)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-semibold text-gray-700">Lead Configuration</span>
                    </div>
                    <span className="text-xs text-violet-600 font-medium">Edit</span>
                </button>
                <div className="px-5 py-4 space-y-2">
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
                </div>
            </div>

            {/* Complete button */}
            <div className="pt-4">
                <button
                    type="button"
                    onClick={handleComplete}
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

    // ─── MAIN RENDER ───

    return (
        <div className="space-y-6">
            {/* Step Progress Bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between">
                    {STEPS.map((step, idx) => {
                        const StepIcon = step.icon;
                        const isActive = idx === currentStep;
                        const isCompleted = idx < currentStep;

                        return (
                            <div key={idx} className="flex items-center flex-1 last:flex-none">
                                <button
                                    type="button"
                                    onClick={() => goToStep(idx)}
                                    className={`flex flex-col items-center gap-1.5 transition-all ${
                                        isActive
                                            ? "scale-105"
                                            : "opacity-70 hover:opacity-100"
                                    }`}
                                >
                                    <div
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                                            isActive
                                                ? "bg-violet-600 text-white shadow-lg shadow-violet-200"
                                                : isCompleted
                                                ? "bg-violet-100 text-violet-600"
                                                : "bg-gray-100 text-gray-400"
                                        }`}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle className="w-5 h-5" />
                                        ) : (
                                            <StepIcon className="w-5 h-5" />
                                        )}
                                    </div>
                                    <span
                                        className={`text-xs font-medium hidden md:block ${
                                            isActive
                                                ? "text-violet-700"
                                                : isCompleted
                                                ? "text-violet-600"
                                                : "text-gray-400"
                                        }`}
                                    >
                                        {step.label}
                                    </span>
                                </button>

                                {/* Connector line */}
                                {idx < STEPS.length - 1 && (
                                    <div
                                        className={`flex-1 h-0.5 mx-2 rounded-full ${
                                            idx < currentStep
                                                ? "bg-violet-400"
                                                : "bg-gray-200"
                                        }`}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Content Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 lg:p-8">
                {renderStep()}
            </div>

            {/* Navigation + Save Status */}
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={goPrev}
                    disabled={currentStep === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                </button>

                <div className="flex items-center gap-3">
                    {/* Save message */}
                    {saveMessage && (
                        <span
                            className={`text-sm ${
                                saveMessage.type === "success"
                                    ? "text-green-600"
                                    : "text-red-600"
                            }`}
                        >
                            {saveMessage.text}
                        </span>
                    )}

                    {saving && (
                        <span className="flex items-center gap-1.5 text-sm text-gray-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Saving...
                        </span>
                    )}
                </div>

                {currentStep < STEPS.length - 1 ? (
                    <button
                        type="button"
                        onClick={goNext}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </button>
                ) : (
                    <div />
                )}
            </div>
        </div>
    );
}

// ─── REVIEW FIELD COMPONENT ───

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
