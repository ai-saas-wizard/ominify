"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

// ─── READ OPERATIONS ───

export async function getTenantProfile(clientId: string) {
    const { data, error } = await supabase
        .from("tenant_profiles")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (error) {
        console.error("getTenantProfile error:", error);
        return null;
    }

    return data;
}

// ─── WRITE OPERATIONS ───

export async function saveTenantProfile(clientId: string, formData: FormData) {
    const industry = formData.get("industry") as string;
    const sub_industry = formData.get("sub_industry") as string;
    const business_description = formData.get("business_description") as string;
    const website = formData.get("website") as string;

    const service_area_raw = formData.get("service_area") as string;
    const job_types_raw = formData.get("job_types") as string;

    const brand_voice = formData.get("brand_voice") as string;
    const custom_phrases_raw = formData.get("custom_phrases") as string;
    const greeting_style = formData.get("greeting_style") as string;

    const timezone = formData.get("timezone") as string;
    const business_hours_raw = formData.get("business_hours") as string;
    const after_hours_behavior = formData.get("after_hours_behavior") as string;
    const emergency_phone = formData.get("emergency_phone") as string;

    const lead_sources_raw = formData.get("lead_sources") as string;
    const primary_goal = formData.get("primary_goal") as string;
    const qualification_criteria_raw = formData.get("qualification_criteria") as string;

    // Parse JSON fields safely
    let service_area = null;
    let job_types = [];
    let custom_phrases = null;
    let business_hours = {};
    let lead_sources = [];
    let qualification_criteria = {};

    try { if (service_area_raw) service_area = JSON.parse(service_area_raw); } catch { /* ignore */ }
    try { if (job_types_raw) job_types = JSON.parse(job_types_raw); } catch { /* ignore */ }
    try { if (custom_phrases_raw) custom_phrases = JSON.parse(custom_phrases_raw); } catch { /* ignore */ }
    try { if (business_hours_raw) business_hours = JSON.parse(business_hours_raw); } catch { /* ignore */ }
    try { if (lead_sources_raw) lead_sources = JSON.parse(lead_sources_raw); } catch { /* ignore */ }
    try { if (qualification_criteria_raw) qualification_criteria = JSON.parse(qualification_criteria_raw); } catch { /* ignore */ }

    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };

    // Only include fields that have values
    if (industry) updateData.industry = industry;
    if (sub_industry) updateData.sub_industry = sub_industry;
    if (business_description) updateData.business_description = business_description;
    if (website) updateData.website = website;
    if (service_area) updateData.service_area = service_area;
    if (job_types.length > 0) updateData.job_types = job_types;
    if (brand_voice) updateData.brand_voice = brand_voice;
    if (custom_phrases) updateData.custom_phrases = custom_phrases;
    if (greeting_style) updateData.greeting_style = greeting_style;
    if (timezone) updateData.timezone = timezone;
    if (Object.keys(business_hours).length > 0) updateData.business_hours = business_hours;
    if (after_hours_behavior) updateData.after_hours_behavior = after_hours_behavior;
    if (emergency_phone) updateData.emergency_phone = emergency_phone;
    if (lead_sources.length > 0) updateData.lead_sources = lead_sources;
    if (primary_goal) updateData.primary_goal = primary_goal;
    if (Object.keys(qualification_criteria).length > 0) updateData.qualification_criteria = qualification_criteria;

    const { error } = await supabase
        .from("tenant_profiles")
        .upsert(
            { client_id: clientId, ...updateData },
            { onConflict: "client_id" }
        );

    if (error) {
        console.error("saveTenantProfile error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/onboarding`);
    return { success: true };
}

export async function completeOnboarding(clientId: string) {
    const { error } = await supabase
        .from("tenant_profiles")
        .update({
            onboarding_completed: true,
            onboarding_completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    if (error) {
        console.error("completeOnboarding error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/onboarding`);
    revalidatePath(`/client/${clientId}`);
    revalidatePath("/admin/clients");
    return { success: true };
}

export async function updateTenantProfileField(
    clientId: string,
    field: string,
    value: unknown
) {
    // Whitelist allowed fields to prevent arbitrary column updates
    const allowedFields = [
        "industry",
        "sub_industry",
        "business_description",
        "website",
        "service_area",
        "job_types",
        "brand_voice",
        "custom_phrases",
        "greeting_style",
        "timezone",
        "business_hours",
        "after_hours_behavior",
        "emergency_phone",
        "lead_sources",
        "primary_goal",
        "qualification_criteria",
    ];

    if (!allowedFields.includes(field)) {
        return { success: false, error: `Field '${field}' is not allowed` };
    }

    const { error } = await supabase
        .from("tenant_profiles")
        .update({
            [field]: value,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    if (error) {
        console.error("updateTenantProfileField error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/onboarding`);
    return { success: true };
}
