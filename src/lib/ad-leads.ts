import "server-only";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════
// AD-PLATFORM LEAD INGESTION (Meta Ads + Google Ads)
//
// Both webhook handlers funnel leads through ingestAdLead() so that
// contact upsert, dedupe, and sequence-enrollment logic stay consistent
// across providers. Idempotency is enforced by partial unique indexes
// on sequence_enrollments.enrollment_data->>'meta_leadgen_id' /
// 'google_lead_id', plus the existing UNIQUE(sequence_id, contact_id).
// ═══════════════════════════════════════════════════════════

export interface IngestAdLeadInput {
    clientId: string;
    triggerType: "meta_ads_lead" | "google_ads_lead";
    source: "meta_ads" | "google_ads";
    externalLeadId: string;
    externalAdId?: string | null;
    externalFormId?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    rawFields?: unknown;
    isTest?: boolean;
}

export interface IngestAdLeadResult {
    contactId: string | null;
    enrollmentIds: string[];
    skipped?: "no_phone_or_email" | "no_active_sequence";
}

function normalizeE164(phone: string): string {
    if (!phone) return "";
    const digits = phone.replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (phone.trim().startsWith("+")) return `+${digits}`;
    return `+${digits}`;
}

export async function ingestAdLead(input: IngestAdLeadInput): Promise<IngestAdLeadResult> {
    const phoneE164 = input.phone ? normalizeE164(input.phone) : null;
    const email = input.email?.toLowerCase().trim() || null;

    if (!phoneE164 && !email) {
        return { contactId: null, enrollmentIds: [], skipped: "no_phone_or_email" };
    }

    // contacts.phone is NOT NULL UNIQUE(client_id,phone). For email-only leads
    // we synthesize a deterministic placeholder so the existing constraint
    // still holds. Re-deliveries with the same email collide cleanly.
    const contactPhone = phoneE164 || `email:${email}`;

    let contactId: string;
    const { data: existing } = await supabase
        .from("contacts")
        .select("id, name, email")
        .eq("client_id", input.clientId)
        .eq("phone", contactPhone)
        .maybeSingle();

    if (existing) {
        contactId = existing.id;
        const updates: Record<string, unknown> = {};
        if (input.name && !existing.name) updates.name = input.name;
        if (email && !existing.email) updates.email = email;
        if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from("contacts").update(updates).eq("id", contactId);
        }
    } else {
        const { data: created, error } = await supabase
            .from("contacts")
            .insert({
                client_id: input.clientId,
                phone: contactPhone,
                name: input.name || null,
                email,
            })
            .select("id")
            .single();
        if (error || !created) {
            console.error("[AD-LEADS] Failed to insert contact:", error);
            throw new Error("Failed to create contact");
        }
        contactId = created.id;
    }

    // Test pings should still upsert the contact (so the user can see "first
    // ping arrived" feedback) but must NOT enroll into a real sequence.
    if (input.isTest) {
        return { contactId, enrollmentIds: [] };
    }

    // Find the single active sequence wired to this trigger. Phase 1's
    // createSequenceFromWizard guard ensures there's at most one.
    const { data: sequences } = await supabase
        .from("sequences")
        .select("id")
        .eq("client_id", input.clientId)
        .eq("trigger_type", input.triggerType)
        .eq("is_active", true)
        .limit(1);

    if (!sequences || sequences.length === 0) {
        return { contactId, enrollmentIds: [], skipped: "no_active_sequence" };
    }

    const sequenceId = sequences[0].id;
    const nowIso = new Date().toISOString();

    const enrollmentData: Record<string, unknown> = {
        ad_id: input.externalAdId ?? null,
        form_id: input.externalFormId ?? null,
        raw_fields: input.rawFields ?? null,
    };
    if (input.source === "meta_ads") {
        enrollmentData.meta_leadgen_id = input.externalLeadId;
    } else {
        enrollmentData.google_lead_id = input.externalLeadId;
    }

    const { data: inserted, error: enrollError } = await supabase
        .from("sequence_enrollments")
        .upsert(
            [
                {
                    sequence_id: sequenceId,
                    contact_id: contactId,
                    tenant_id: input.clientId,
                    status: "active",
                    current_step_order: 0,
                    enrollment_source: input.source,
                    enrolled_at: nowIso,
                    next_step_at: nowIso,
                    enrollment_data: enrollmentData,
                },
            ],
            { onConflict: "sequence_id,contact_id", ignoreDuplicates: true }
        )
        .select("id");

    if (enrollError) {
        console.error("[AD-LEADS] Failed to enroll:", enrollError);
        throw new Error("Failed to enroll lead in sequence");
    }

    return {
        contactId,
        enrollmentIds: (inserted ?? []).map((r) => r.id),
    };
}
