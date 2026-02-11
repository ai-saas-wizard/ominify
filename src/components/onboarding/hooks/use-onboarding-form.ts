"use client";

import { useState, useCallback } from "react";
import type { TenantProfile, AIFieldMeta, AIAnalysisResult } from "../types";
import { DAYS_OF_WEEK } from "../constants";
import { saveTenantProfile } from "@/app/actions/tenant-profile-actions";

// ─── DEFAULT PROFILE BUILDER ───

export function buildDefaultProfile(initial: Record<string, unknown> | null): TenantProfile {
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

// ─── HOOK ───

export function useOnboardingForm(clientId: string, initialProfile: Record<string, unknown> | null) {
    const [form, setForm] = useState<TenantProfile>(() => buildDefaultProfile(initialProfile));
    const [fieldMeta, setFieldMeta] = useState<Record<string, AIFieldMeta>>({});
    const [aiOriginalValues, setAIOriginalValues] = useState<Partial<TenantProfile>>({});
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // ─── FIELD UPDATES ───

    const updateField = useCallback(<K extends keyof TenantProfile>(field: K, value: TenantProfile[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setFieldMeta((prev) => {
            if (!prev[field]) return prev;
            return { ...prev, [field]: { ...prev[field], userEdited: true } };
        });
    }, []);

    // ─── AI RESULT APPLICATION ───

    const applyAIResults = useCallback((result: AIAnalysisResult) => {
        if (!result.success || !result.profile) return;

        setAIOriginalValues(result.profile);

        setForm((prev) => {
            const merged = { ...prev };
            for (const [key, value] of Object.entries(result.profile!)) {
                if (value !== null && value !== undefined && value !== "") {
                    (merged as Record<string, unknown>)[key] = value;
                }
            }
            // Keep the website URL from the form (user already entered it)
            merged.website = prev.website;
            return merged;
        });

        setFieldMeta(result.fieldMeta);
    }, []);

    const resetFieldToAI = useCallback((field: keyof TenantProfile) => {
        if (aiOriginalValues[field] !== undefined) {
            setForm((prev) => ({ ...prev, [field]: aiOriginalValues[field] as TenantProfile[typeof field] }));
            setFieldMeta((prev) => ({
                ...prev,
                [field]: { ...prev[field], userEdited: false },
            }));
        }
    }, [aiOriginalValues]);

    // ─── FORM DATA BUILDER ───

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

    // ─── SAVE PROGRESS ───

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

    // ─── JOB TYPE HELPERS ───

    const addJobType = useCallback(() => {
        updateField("job_types", [
            ...form.job_types,
            { name: "", urgency_tier: "medium", avg_ticket: "", keywords: "" },
        ]);
    }, [form.job_types, updateField]);

    const updateJobType = useCallback((index: number, field: string, value: string) => {
        const updated = [...form.job_types];
        updated[index] = { ...updated[index], [field]: value };
        updateField("job_types", updated);
    }, [form.job_types, updateField]);

    const removeJobType = useCallback((index: number) => {
        updateField("job_types", form.job_types.filter((_, i) => i !== index));
    }, [form.job_types, updateField]);

    // ─── SERVICE AREA HELPERS ───

    const updateServiceAreaCities = useCallback((value: string) => {
        updateField("service_area", {
            ...form.service_area,
            cities: value.split(",").map((c) => c.trim()).filter(Boolean),
        });
    }, [form.service_area, updateField]);

    const updateServiceAreaZips = useCallback((value: string) => {
        updateField("service_area", {
            ...form.service_area,
            zip_codes: value.split(",").map((z) => z.trim()).filter(Boolean),
        });
    }, [form.service_area, updateField]);

    const updateServiceAreaRadius = useCallback((value: number) => {
        updateField("service_area", { ...form.service_area, radius_miles: value });
    }, [form.service_area, updateField]);

    // ─── BUSINESS HOURS HELPERS ───

    const updateHours = useCallback((day: string, field: "open" | "close" | "closed", value: string | boolean) => {
        updateField("business_hours", {
            ...form.business_hours,
            [day]: { ...form.business_hours[day], [field]: value },
        });
    }, [form.business_hours, updateField]);

    // ─── LEAD SOURCE HELPERS ───

    const toggleLeadSource = useCallback((source: string) => {
        if (form.lead_sources.includes(source)) {
            updateField("lead_sources", form.lead_sources.filter((s) => s !== source));
        } else {
            updateField("lead_sources", [...form.lead_sources, source]);
        }
    }, [form.lead_sources, updateField]);

    return {
        form,
        fieldMeta,
        saving,
        saveMessage,
        updateField,
        applyAIResults,
        resetFieldToAI,
        buildFormData,
        saveProgress,
        addJobType,
        updateJobType,
        removeJobType,
        updateServiceAreaCities,
        updateServiceAreaZips,
        updateServiceAreaRadius,
        updateHours,
        toggleLeadSource,
    };
}
