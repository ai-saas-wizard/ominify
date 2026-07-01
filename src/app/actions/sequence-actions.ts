"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { autoAdvanceContactStage } from "@/app/actions/pipeline-actions";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
    upsertContactsFromRows,
    syntheticRowFromContact,
    type ColumnRole as ImportColumnRole,
    type UpsertedRow,
} from "@/app/actions/_helpers/contact-import";
import {
    createSequenceCore,
    updateSequenceCore,
    addSequenceStepCore,
    updateSequenceStepCore,
    setSequenceActiveCore,
} from "@/lib/sequences/sequence-core";

// Normalize any phone input to E.164 (+12223334444). Defaults to US.
// Returns null for unparseable or invalid numbers.
function toE164(raw: string, defaultCountry: "US" = "US"): string | null {
    if (!raw) return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
}

// ─── List all sequences for a client ───────────────────────────────────────────

export async function getSequences(clientId: string) {
    try {
        const { data, error } = await supabase
            .from("sequences")
            .select(`
                *,
                sequence_steps(id),
                sequence_enrollments(id, status, is_test)
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("getSequences error:", error);
            return { success: false, error: error.message, data: [] };
        }

        const sequences = (data || []).map((seq: any) => {
            // Exclude test enrollments from analytics counts
            const realEnrollments = (seq.sequence_enrollments || []).filter(
                (e: any) => !e.is_test
            );
            return {
                ...seq,
                step_count: seq.sequence_steps?.length || 0,
                enrolled_count: realEnrollments.filter(
                    (e: any) => e.status === "active" || e.status === "paused"
                ).length || 0,
                completed_count: realEnrollments.filter(
                    (e: any) => e.status === "completed" || e.status === "booked"
                ).length || 0,
                total_enrolled: realEnrollments.length || 0,
                sequence_steps: undefined,
                sequence_enrollments: undefined,
            };
        });

        return { success: true, data: sequences };
    } catch (error) {
        console.error("getSequences error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get single sequence with steps and enrollment stats ───────────────────────

export async function getSequenceDetail(sequenceId: string) {
    try {
        const { data: sequence, error } = await supabase
            .from("sequences")
            .select(`
                *,
                sequence_steps(*),
                sequence_enrollments(id, status, current_step_order, enrolled_at, contact_id, is_test, contacts(id, name, phone, email))
            `)
            .eq("id", sequenceId)
            .single();

        if (error) {
            console.error("getSequenceDetail error:", error);
            return { success: false, error: error.message, data: null };
        }

        // Sort steps by step_order
        if (sequence?.sequence_steps) {
            sequence.sequence_steps.sort(
                (a: any, b: any) => a.step_order - b.step_order
            );
        }

        // Compute enrollment stats (exclude test enrollments)
        const allEnrollments = sequence?.sequence_enrollments || [];
        const enrollments = allEnrollments.filter((e: any) => !e.is_test);
        const stats = {
            active: enrollments.filter((e: any) => e.status === "active").length,
            paused: enrollments.filter((e: any) => e.status === "paused").length,
            completed: enrollments.filter((e: any) => e.status === "completed").length,
            replied: enrollments.filter((e: any) => e.status === "replied").length,
            booked: enrollments.filter((e: any) => e.status === "booked").length,
            failed: enrollments.filter((e: any) => e.status === "failed").length,
            total: enrollments.length,
        };

        return {
            success: true,
            data: {
                ...sequence,
                enrollment_stats: stats,
            },
        };
    } catch (error) {
        console.error("getSequenceDetail error:", error);
        return { success: false, error: "Internal error", data: null };
    }
}

// ─── Create a new sequence ─────────────────────────────────────────────────────

export async function createSequence(clientId: string, formData: FormData, agentId?: string | null) {
    // Thin adapter: parse FormData → delegate to the shared core (also used by
    // the internal MCP/admin routes). See src/lib/sequences/sequence-core.ts.
    const trigger_conditions_raw = formData.get("trigger_conditions") as string | null;
    let trigger_conditions: any = null;
    if (trigger_conditions_raw) {
        try {
            trigger_conditions = JSON.parse(trigger_conditions_raw);
        } catch {
            return { success: false, error: "Invalid JSON in trigger conditions" };
        }
    }

    return createSequenceCore(
        clientId,
        {
            name: formData.get("name") as string,
            description: formData.get("description") as string | null,
            trigger_type: (formData.get("trigger_type") as string) || undefined,
            urgency_tier: (formData.get("urgency_tier") as string) || undefined,
            trigger_conditions,
            generation_mode: (formData.get("generation_mode") as string) || undefined,
            max_touchpoints:
                parseInt(formData.get("max_touchpoints") as string) || undefined,
            // Prefer the explicit param; otherwise read the picker's selection.
            agentId: agentId ?? ((formData.get("agent_id") as string) || null),
        },
        { revalidate: revalidatePath }
    );
}

/**
 * List a client's deployed OUTBOUND agents for the sequence agent-picker.
 * Returns id + name so a sequence can be bound to the agent whose voice prompt
 * drives its calls and whose SMS persona drives its texts.
 */
export async function listOutboundAgents(
    clientId: string
): Promise<{ id: string; name: string }[]> {
    const { data, error } = await supabase
        .from("agents")
        .select("id, name")
        .eq("client_id", clientId)
        .eq("agent_type", "outbound")
        .order("created_at", { ascending: false });
    if (error) {
        console.error("listOutboundAgents error:", error);
        return [];
    }
    return (data as { id: string; name: string }[]) || [];
}

// ─── Update a sequence ─────────────────────────────────────────────────────────

export async function updateSequence(sequenceId: string, formData: FormData) {
    const trigger_conditions_raw = formData.get("trigger_conditions") as string | null;
    let trigger_conditions: any = undefined;
    if (trigger_conditions_raw) {
        try {
            trigger_conditions = JSON.parse(trigger_conditions_raw);
        } catch {
            return { success: false, error: "Invalid JSON in trigger conditions" };
        }
    }

    // Only re-bind the agent when the field is actually present in the form
    // (undefined = leave untouched; "" = explicitly unbind).
    const agentIdRaw = formData.get("agent_id");

    return updateSequenceCore(
        sequenceId,
        {
            name: (formData.get("name") as string) || undefined,
            description: formData.get("description") as string | null,
            trigger_type: (formData.get("trigger_type") as string) || undefined,
            urgency_tier: (formData.get("urgency_tier") as string) || undefined,
            trigger_conditions,
            ...(agentIdRaw !== null
                ? { agentId: (agentIdRaw as string) || null }
                : {}),
        },
        { revalidate: revalidatePath }
    );
}

// ─── Toggle sequence active/inactive ───────────────────────────────────────────

export async function toggleSequenceActive(sequenceId: string, isActive: boolean) {
    // Delegates to the shared core, which now ALSO pauses in-flight enrollments
    // on deactivate (previously is_active=false left them dispatching).
    return setSequenceActiveCore(sequenceId, isActive, { revalidate: revalidatePath });
}

// ─── Delete a sequence ─────────────────────────────────────────────────────────

export async function deleteSequence(sequenceId: string) {
    try {
        // Get client_id before deletion for revalidation
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        // 1. Deactivate the sequence so the scheduler stops picking up new work
        await supabase
            .from("sequences")
            .update({ is_active: false })
            .eq("id", sequenceId);

        // 2. Mark all active enrollments as unenrolled so in-flight dispatches are halted
        await supabase
            .from("sequence_enrollments")
            .update({
                status: "unenrolled",
                completed_at: new Date().toISOString(),
                completed_reason: "sequence_deleted",
                next_step_at: null,
            })
            .eq("sequence_id", sequenceId)
            .in("status", ["active", "paused"]);

        // 3. Delete the sequence (cascade removes steps + enrollments from DB)
        const { error } = await supabase
            .from("sequences")
            .delete()
            .eq("id", sequenceId);

        if (error) {
            console.error("deleteSequence error:", error);
            return { success: false, error: error.message };
        }

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences`);
        }

        return { success: true };
    } catch (error) {
        console.error("deleteSequence error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Add a step to a sequence ──────────────────────────────────────────────────

export async function addSequenceStep(sequenceId: string, formData: FormData) {
    const channel = formData.get("channel") as string;

    const content_template = formData.get("content_template") as string | null;
    let content: any = null;
    if (content_template) {
        try {
            content = JSON.parse(content_template);
        } catch {
            return { success: false, error: "Invalid JSON in content template" };
        }
    }

    const skip_conditions_raw = formData.get("skip_conditions") as string | null;
    let skip_conditions: any = null;
    if (skip_conditions_raw) {
        try {
            skip_conditions = JSON.parse(skip_conditions_raw);
        } catch {
            return { success: false, error: "Invalid JSON in skip conditions" };
        }
    }

    const enable_ai_mutation_raw = formData.get("enable_ai_mutation") as string | null;
    const enable_ai_mutation =
        enable_ai_mutation_raw !== null ? enable_ai_mutation_raw === "true" : undefined;

    return addSequenceStepCore(
        sequenceId,
        {
            channel,
            delay_minutes: parseInt(formData.get("delay_minutes") as string) || 0,
            content,
            skip_conditions,
            enable_ai_mutation,
            mutation_instructions:
                (formData.get("mutation_instructions") as string | null) || undefined,
        },
        { revalidate: revalidatePath }
    );
}

// ─── Update a sequence step ────────────────────────────────────────────────────

export async function updateSequenceStep(stepId: string, formData: FormData) {
    const input: Record<string, any> = {};

    const channel = formData.get("channel") as string | null;
    if (channel) input.channel = channel;

    const delay_minutes_raw = formData.get("delay_minutes") as string | null;
    if (delay_minutes_raw !== null) input.delay_minutes = parseInt(delay_minutes_raw) || 0;

    const content_template = formData.get("content_template") as string | null;
    if (content_template) {
        try {
            input.content = JSON.parse(content_template);
        } catch {
            return { success: false, error: "Invalid JSON in content template" };
        }
    }

    const skip_conditions_raw = formData.get("skip_conditions") as string | null;
    if (skip_conditions_raw) {
        try {
            input.skip_conditions = JSON.parse(skip_conditions_raw);
        } catch {
            return { success: false, error: "Invalid JSON in skip conditions" };
        }
    }

    return updateSequenceStepCore(stepId, input, { revalidate: revalidatePath });
}

// ─── Delete a sequence step ────────────────────────────────────────────────────

export async function deleteSequenceStep(stepId: string) {
    try {
        // Get step info before deletion
        const { data: step } = await supabase
            .from("sequence_steps")
            .select("sequence_id, step_order, sequences(client_id)")
            .eq("id", stepId)
            .single();

        const { error } = await supabase
            .from("sequence_steps")
            .delete()
            .eq("id", stepId);

        if (error) {
            console.error("deleteSequenceStep error:", error);
            return { success: false, error: error.message };
        }

        // Re-order remaining steps
        if (step) {
            const { data: remainingSteps } = await supabase
                .from("sequence_steps")
                .select("id, step_order")
                .eq("sequence_id", step.sequence_id)
                .order("step_order", { ascending: true });

            if (remainingSteps) {
                for (let i = 0; i < remainingSteps.length; i++) {
                    if (remainingSteps[i].step_order !== i + 1) {
                        await supabase
                            .from("sequence_steps")
                            .update({ step_order: i + 1 })
                            .eq("id", remainingSteps[i].id);
                    }
                }
            }

            if (step.sequences) {
                const clientId = (step.sequences as any).client_id;
                revalidatePath(`/client/${clientId}/sequences/${step.sequence_id}`);
            }
        }

        return { success: true };
    } catch (error) {
        console.error("deleteSequenceStep error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Reorder sequence steps ────────────────────────────────────────────────────

export async function reorderSequenceSteps(sequenceId: string, stepIds: string[]) {
    try {
        for (let i = 0; i < stepIds.length; i++) {
            const { error } = await supabase
                .from("sequence_steps")
                .update({ step_order: i + 1 })
                .eq("id", stepIds[i])
                .eq("sequence_id", sequenceId);

            if (error) {
                console.error("reorderSequenceSteps error:", error);
                return { success: false, error: error.message };
            }
        }

        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }

        return { success: true };
    } catch (error) {
        console.error("reorderSequenceSteps error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Enroll a contact in a sequence ────────────────────────────────────────────

export async function enrollContact(
    sequenceId: string,
    contactId: string,
    clientId: string,
    source?: string
) {
    try {
        // Check if already enrolled and active
        const { data: existing } = await supabase
            .from("sequence_enrollments")
            .select("id, status")
            .eq("sequence_id", sequenceId)
            .eq("contact_id", contactId)
            .in("status", ["active", "paused"])
            .limit(1);

        if (existing && existing.length > 0) {
            return { success: false, error: "Contact is already enrolled in this sequence" };
        }

        const { data, error } = await supabase
            .from("sequence_enrollments")
            .insert({
                sequence_id: sequenceId,
                contact_id: contactId,
                tenant_id: clientId,
                status: "active",
                current_step_order: 0,
                enrollment_source: source || "manual",
                enrolled_at: new Date().toISOString(),
                next_step_at: new Date().toISOString(),
                sentiment_trend: "stable",
                last_emotion: null,
                recommended_tone: null,
                is_hot_lead: false,
                is_at_risk: false,
                engagement_score: 50,
                needs_human_intervention: false,
                custom_variables: {},
                contact_replied: false,
                contact_answered_call: false,
                appointment_booked: false,
                channel_overrides: {},
            })
            .select("id")
            .single();

        if (error) {
            console.error("enrollContact error:", error);
            return { success: false, error: error.message };
        }

        // Auto-advance pipeline: enrolled → Contacted
        await autoAdvanceContactStage(contactId, clientId, "Contacted").catch(() => {});

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, enrollmentId: data?.id };
    } catch (error) {
        console.error("enrollContact error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Unenroll a contact from a sequence ────────────────────────────────────────

export async function unenrollContact(enrollmentId: string) {
    try {
        const { data: enrollment } = await supabase
            .from("sequence_enrollments")
            .select("sequence_id, tenant_id")
            .eq("id", enrollmentId)
            .single();

        const { error } = await supabase
            .from("sequence_enrollments")
            .update({
                status: "unenrolled",
                completed_at: new Date().toISOString(),
            })
            .eq("id", enrollmentId);

        if (error) {
            console.error("unenrollContact error:", error);
            return { success: false, error: error.message };
        }

        if (enrollment) {
            revalidatePath(
                `/client/${enrollment.tenant_id}/sequences/${enrollment.sequence_id}`
            );
        }

        return { success: true };
    } catch (error) {
        console.error("unenrollContact error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── List enrollments for a sequence ───────────────────────────────────────────

export async function getEnrollments(sequenceId: string) {
    try {
        const { data, error } = await supabase
            .from("sequence_enrollments")
            .select(`
                *,
                contacts(id, name, phone, email)
            `)
            .eq("sequence_id", sequenceId)
            .order("enrolled_at", { ascending: false });

        if (error) {
            console.error("getEnrollments error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getEnrollments error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get execution log for a whole sequence (grouped per lead) ─────────────────
//
// The execution log rows belong to individual enrollments, so to show a
// sequence's history we first resolve all of that sequence's enrollments (with
// their contact), then pull every log row for those enrollments. Each returned
// row carries `_contact` so the UI can group entries per lead.

export async function getExecutionLog(sequenceId: string) {
    try {
        // 1. All enrollments of this sequence, with the contact behind each.
        const { data: enrollments, error: enrErr } = await supabase
            .from("sequence_enrollments")
            .select("id, contact_id, contacts(id, name, phone)")
            .eq("sequence_id", sequenceId);

        if (enrErr) {
            console.error("getExecutionLog enrollments error:", enrErr);
            return { success: false, error: enrErr.message, data: [] };
        }

        const enrollmentIds = (enrollments || []).map((e: any) => e.id);
        if (enrollmentIds.length === 0) {
            return { success: true, data: [] };
        }

        // Map enrollment_id → contact for per-lead grouping in the UI.
        const contactByEnrollment = new Map<string, any>();
        for (const e of enrollments || []) {
            contactByEnrollment.set(e.id, (e as any).contacts || null);
        }

        // 2. Every log row across those enrollments.
        const { data, error } = await supabase
            .from("sequence_execution_log")
            .select(`
                *,
                sequence_steps(step_order, channel, content)
            `)
            .in("enrollment_id", enrollmentIds)
            .order("executed_at", { ascending: true });

        if (error) {
            console.error("getExecutionLog error:", error);
            return { success: false, error: error.message, data: [] };
        }

        // Phase 3/4: Enrich with mutation + healing data for these enrollments.
        let mutations: any[] = [];
        let healings: any[] = [];

        if (data && data.length > 0) {
            const [mutResult, healResult] = await Promise.all([
                supabase
                    .from("step_mutations")
                    .select("*")
                    .in("enrollment_id", enrollmentIds),
                supabase
                    .from("healing_log")
                    .select("*")
                    .in("enrollment_id", enrollmentIds),
            ]);
            mutations = mutResult.data || [];
            healings = healResult.data || [];
        }

        // Attach mutation + healing info to matching log entries. Match on BOTH
        // enrollment_id and step_id — static sequences reuse the same step_id
        // across many enrollments, so a step_id-only match would cross-attach.
        const enrichedData = (data || []).map((log: any) => {
            const mutation = mutations.find(
                (m: any) => m.step_id === log.step_id && m.enrollment_id === log.enrollment_id
            );
            const healing = healings.find(
                (h: any) => h.step_id === log.step_id && h.enrollment_id === log.enrollment_id
            );
            return {
                ...log,
                _contact: contactByEnrollment.get(log.enrollment_id) || null,
                was_mutated: !!mutation,
                mutation: mutation || null,
                was_healed: !!healing,
                healing: healing || null,
            };
        });

        return { success: true, data: enrichedData };
    } catch (error) {
        console.error("getExecutionLog error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get notifications for a client ──────────────────────────────────────────────

export async function getNotifications(clientId: string, limit: number = 20) {
    try {
        const { data, error } = await supabase
            .from("tenant_notifications")
            .select(`
                *,
                contacts(id, name, phone),
                sequence_enrollments(id, sequence_id, sequences(name))
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) {
            console.error("getNotifications error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getNotifications error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get unread notification count ───────────────────────────────────────────────

export async function getUnreadNotificationCount(clientId: string) {
    try {
        const { count, error } = await supabase
            .from("tenant_notifications")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)
            .eq("read", false);

        if (error) {
            console.error("getUnreadNotificationCount error:", error);
            return { success: false, count: 0 };
        }

        return { success: true, count: count || 0 };
    } catch (error) {
        console.error("getUnreadNotificationCount error:", error);
        return { success: false, count: 0 };
    }
}

// ─── Mark notification as read ───────────────────────────────────────────────────

export async function markNotificationRead(notificationId: string) {
    try {
        const { error } = await supabase
            .from("tenant_notifications")
            .update({ read: true, read_at: new Date().toISOString() })
            .eq("id", notificationId);

        if (error) {
            console.error("markNotificationRead error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error("markNotificationRead error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Mark all notifications as read ──────────────────────────────────────────────

export async function markAllNotificationsRead(clientId: string) {
    try {
        const { error } = await supabase
            .from("tenant_notifications")
            .update({ read: true, read_at: new Date().toISOString() })
            .eq("client_id", clientId)
            .eq("read", false);

        if (error) {
            console.error("markAllNotificationsRead error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error("markAllNotificationsRead error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Update mutation settings on a sequence ──────────────────────────────────────

export async function updateSequenceMutationSettings(
    sequenceId: string,
    settings: {
        enable_adaptive_mutation?: boolean;
        mutation_aggressiveness?: string;
    }
) {
    try {
        const { error } = await supabase
            .from("sequences")
            .update(settings)
            .eq("id", sequenceId);

        if (error) {
            console.error("updateSequenceMutationSettings error:", error);
            return { success: false, error: error.message };
        }

        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }

        return { success: true };
    } catch (error) {
        console.error("updateSequenceMutationSettings error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Update step mutation settings ───────────────────────────────────────────────

export async function updateStepMutationSettings(
    stepId: string,
    settings: {
        enable_ai_mutation?: boolean;
        mutation_instructions?: string | null;
    }
) {
    try {
        const { error } = await supabase
            .from("sequence_steps")
            .update(settings)
            .eq("id", stepId);

        if (error) {
            console.error("updateStepMutationSettings error:", error);
            return { success: false, error: error.message };
        }

        const { data: step } = await supabase
            .from("sequence_steps")
            .select("sequence_id, sequences(client_id)")
            .eq("id", stepId)
            .single();

        if (step?.sequences) {
            const clientId = (step.sequences as any).client_id;
            revalidatePath(`/client/${clientId}/sequences/${step.sequence_id}`);
        }

        return { success: true };
    } catch (error) {
        console.error("updateStepMutationSettings error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Get mutation history for an enrollment ───────────────────────────────────────

export async function getMutationHistory(enrollmentId: string) {
    try {
        const { data, error } = await supabase
            .from("step_mutations")
            .select(`
                *,
                sequence_steps(step_order, channel)
            `)
            .eq("enrollment_id", enrollmentId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("getMutationHistory error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getMutationHistory error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get interaction timeline for a contact ─────────────────────────────────────

// ─── Get healing log for an enrollment ──────────────────────────────────────────

export async function getHealingLog(enrollmentId: string) {
    try {
        const { data, error } = await supabase
            .from("healing_log")
            .select(`
                *,
                sequence_steps(step_order, channel)
            `)
            .eq("enrollment_id", enrollmentId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("getHealingLog error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getHealingLog error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Outcome-Based Learning Actions
// ═══════════════════════════════════════════════════════════════════

// ─── Get sequence analytics ──────────────────────────────────────────────────────

export async function getSequenceLearningAnalytics(sequenceId: string) {
    try {
        const { data, error } = await supabase
            .from("sequence_analytics")
            .select("*")
            .eq("sequence_id", sequenceId)
            .order("period_start", { ascending: false })
            .limit(1)
            .single();

        if (error) {
            return { success: false, error: error.message, data: null };
        }

        return { success: true, data };
    } catch (error) {
        console.error("getSequenceLearningAnalytics error:", error);
        return { success: false, error: "Internal error", data: null };
    }
}

// ─── Get step analytics for a sequence ───────────────────────────────────────────

export async function getStepAnalytics(sequenceId: string) {
    try {
        const { data, error } = await supabase
            .from("step_analytics")
            .select(`
                *,
                sequence_steps(step_order, channel, content)
            `)
            .eq("sequence_id", sequenceId)
            .order("period_start", { ascending: false });

        if (error) {
            return { success: false, error: error.message, data: [] };
        }

        // Dedupe to latest period per step
        const latestByStep = new Map<string, any>();
        for (const row of (data || [])) {
            if (!latestByStep.has(row.step_id)) {
                latestByStep.set(row.step_id, row);
            }
        }

        return { success: true, data: Array.from(latestByStep.values()) };
    } catch (error) {
        console.error("getStepAnalytics error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Get optimization suggestions ────────────────────────────────────────────────

export async function getOptimizationSuggestions(sequenceId: string) {
    try {
        const { data, error } = await supabase
            .from("optimization_suggestions")
            .select(`
                *,
                sequence_steps(step_order, channel)
            `)
            .eq("sequence_id", sequenceId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (error) {
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getOptimizationSuggestions error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Accept/dismiss an optimization suggestion ──────────────────────────────────

export async function updateSuggestionStatus(
    suggestionId: string,
    status: "accepted" | "dismissed"
) {
    try {
        const updates: Record<string, any> = { status };
        if (status === "accepted") updates.accepted_at = new Date().toISOString();
        if (status === "dismissed") updates.dismissed_at = new Date().toISOString();

        const { error } = await supabase
            .from("optimization_suggestions")
            .update(updates)
            .eq("id", suggestionId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error("updateSuggestionStatus error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Get A/B test variants for a step ───────────────────────────────────────────

export async function getStepVariants(stepId: string) {
    try {
        const { data, error } = await supabase
            .from("step_variants")
            .select("*")
            .eq("step_id", stepId)
            .order("created_at", { ascending: true });

        if (error) {
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getStepVariants error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ─── Create an A/B test variant ──────────────────────────────────────────────────

export async function createStepVariant(
    stepId: string,
    sequenceId: string,
    clientId: string,
    variantName: string,
    content: Record<string, any>,
    trafficWeight: number
) {
    try {
        const { data, error } = await supabase
            .from("step_variants")
            .insert({
                step_id: stepId,
                sequence_id: sequenceId,
                client_id: clientId,
                variant_name: variantName,
                content,
                traffic_weight: trafficWeight,
                is_active: true,
            })
            .select("id")
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, variantId: data?.id };
    } catch (error) {
        console.error("createStepVariant error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Get industry benchmarks ─────────────────────────────────────────────────────

export async function getIndustryBenchmarks(clientId: string) {
    try {
        // Get the client's industry
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("industry")
            .eq("client_id", clientId)
            .single();

        if (!profile?.industry) {
            return { success: false, error: "No industry set", data: null };
        }

        const { data, error } = await supabase
            .from("industry_benchmarks")
            .select("*")
            .eq("industry", profile.industry)
            .order("period_start", { ascending: false })
            .limit(1)
            .single();

        if (error) {
            return { success: false, error: error.message, data: null };
        }

        return { success: true, data, industry: profile.industry };
    } catch (error) {
        console.error("getIndustryBenchmarks error:", error);
        return { success: false, error: "Internal error", data: null };
    }
}

// ─── Get conversion funnel data for a sequence ──────────────────────────────────

export async function getConversionFunnel(sequenceId: string) {
    try {
        const { data: enrollments, error } = await supabase
            .from("sequence_enrollments")
            .select("id, status, contact_replied, contact_answered_call, appointment_booked, current_step_order")
            .eq("sequence_id", sequenceId)
            .or('is_test.is.null,is_test.eq.false');

        if (error) {
            return { success: false, error: error.message, data: null };
        }

        const all = enrollments || [];
        const funnel = {
            enrolled: all.length,
            engaged: all.filter(e =>
                e.contact_replied || e.contact_answered_call || (e.current_step_order || 0) > 1
            ).length,
            replied: all.filter(e => e.contact_replied).length,
            answered: all.filter(e => e.contact_answered_call).length,
            converted: all.filter(e =>
                e.status === "booked" || e.appointment_booked
            ).length,
            optedOut: all.filter(e => e.status === "manual_stop").length,
        };

        return { success: true, data: funnel };
    } catch (error) {
        console.error("getConversionFunnel error:", error);
        return { success: false, error: "Internal error", data: null };
    }
}

// ─── Get interaction timeline for a contact ─────────────────────────────────────

export async function getInteractionTimeline(contactId: string, limit: number = 50) {
    try {
        const { data, error } = await supabase
            .from("contact_interactions")
            .select("*")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) {
            console.error("getInteractionTimeline error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getInteractionTimeline error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Channel Pre-flight Check
// ═══════════════════════════════════════════════════════════════════

export type ChannelReadiness = {
    sms: { ready: boolean; reason?: string };
    email: { ready: boolean; reason?: string };
    voice: { ready: boolean; reason?: string };
};

// ─── Check which channels are ready for a tenant ─────────────────────────────

export async function getChannelReadiness(clientId: string): Promise<ChannelReadiness> {
    try {
        // Run all channel checks in parallel
        const [smsResult, emailResult, voiceResult] = await Promise.all([
            checkSmsReadiness(clientId),
            checkEmailReadiness(clientId),
            checkVoiceReadiness(clientId),
        ]);

        return {
            sms: smsResult,
            email: emailResult,
            voice: voiceResult,
        };
    } catch (error) {
        console.error("getChannelReadiness error:", error);
        return {
            sms: { ready: false, reason: "Failed to check SMS readiness" },
            email: { ready: false, reason: "Failed to check email readiness" },
            voice: { ready: false, reason: "Failed to check voice readiness" },
        };
    }
}

async function checkSmsReadiness(
    clientId: string
): Promise<{ ready: boolean; reason?: string }> {
    // 1. Check for Twilio subaccount
    const { data: twilioAccount, error: twilioError } = await supabase
        .from("tenant_twilio_accounts")
        .select("id")
        .eq("client_id", clientId)
        .single();

    if (twilioError || !twilioAccount) {
        return { ready: false, reason: "No Twilio subaccount provisioned" };
    }

    // 2. Check for at least one phone number
    const { data: phoneNumbers, error: phoneError } = await supabase
        .from("tenant_phone_numbers")
        .select("id")
        .eq("client_id", clientId)
        .limit(1);

    if (phoneError || !phoneNumbers || phoneNumbers.length === 0) {
        return { ready: false, reason: "No phone number purchased" };
    }

    // 3. Check for approved A2P campaign
    const { data: a2pRegistration, error: a2pError } = await supabase
        .from("tenant_a2p_registrations")
        .select("campaign_status")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (a2pError || !a2pRegistration) {
        return { ready: false, reason: "A2P registration not started" };
    }

    if (a2pRegistration.campaign_status !== "approved") {
        return {
            ready: false,
            reason: `A2P campaign status: ${a2pRegistration.campaign_status}`,
        };
    }

    return { ready: true };
}

async function checkEmailReadiness(
    clientId: string
): Promise<{ ready: boolean; reason?: string }> {
    const { data: emailAccount, error } = await supabase
        .from("tenant_email_accounts")
        .select("is_verified")
        .eq("client_id", clientId)
        .single();

    if (error || !emailAccount) {
        return { ready: false, reason: "No email account configured" };
    }

    if (!emailAccount.is_verified) {
        return { ready: false, reason: "Email account not verified" };
    }

    return { ready: true };
}

async function checkVoiceReadiness(
    clientId: string
): Promise<{ ready: boolean; reason?: string }> {
    // Outbound tasks require an outbound-capable agent. An inbound-only
    // receptionist assistant can't place calls.
    const { data: agents, error } = await supabase
        .from("agents")
        .select("id, vapi_id, agent_type")
        .eq("client_id", clientId)
        .eq("agent_type", "outbound")
        .not("vapi_id", "is", null)
        .limit(1);

    if (error || !agents || agents.length === 0) {
        return {
            ready: false,
            reason: "No outbound agent configured. Create one from the Agents page.",
        };
    }

    return { ready: true };
}
// ═══════════════════════════════════════════════════════════════════
// Phase 4: Test Mode — "Test on Myself"
// ═══════════════════════════════════════════════════════════════════

// ─── Create a test enrollment for the logged-in user ─────────────────────────────

export async function createTestEnrollment(
    sequenceId: string,
    clientId: string,
    sampleVariables?: Record<string, any>
) {
    try {
        // 1. Get the logged-in user's phone + email from Clerk
        const user = await currentUser();
        if (!user) {
            return { success: false, error: "Not authenticated" };
        }

        const userEmail = user.emailAddresses[0]?.emailAddress || null;
        const userPhone = user.phoneNumbers[0]?.phoneNumber || null;
        const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Test User";

        if (!userPhone && !userEmail) {
            return { success: false, error: "Your Clerk account has no phone or email. Add one in your profile to test." };
        }

        // 2. Create or find a contact for the logged-in user
        let contactId: string;

        // Try to find existing contact by phone first, then email
        let existing = null;
        if (userPhone) {
            const { data } = await supabase
                .from("contacts")
                .select("id")
                .eq("client_id", clientId)
                .eq("phone", userPhone)
                .single();
            existing = data;
        }

        if (!existing && userEmail) {
            const { data } = await supabase
                .from("contacts")
                .select("id")
                .eq("client_id", clientId)
                .eq("email", userEmail)
                .single();
            existing = data;
        }

        if (existing) {
            contactId = existing.id;
        } else {
            // Create a new contact for the test user
            const { data: newContact, error: contactError } = await supabase
                .from("contacts")
                .insert({
                    client_id: clientId,
                    phone: userPhone || `test-${user.id}`,
                    name: userName,
                    email: userEmail,
                    custom_fields: { is_test_contact: true },
                    total_calls: 0,
                })
                .select("id")
                .single();

            if (contactError) {
                console.error("createTestEnrollment contact error:", contactError);
                return { success: false, error: contactError.message };
            }

            contactId = newContact.id;
        }

        // 3. Check if already enrolled and active in this sequence as a test
        const { data: existingEnrollment } = await supabase
            .from("sequence_enrollments")
            .select("id, status")
            .eq("sequence_id", sequenceId)
            .eq("contact_id", contactId)
            .eq("is_test", true)
            .in("status", ["active", "paused"])
            .limit(1);

        if (existingEnrollment && existingEnrollment.length > 0) {
            return { success: false, error: "You already have an active test enrollment in this sequence" };
        }

        // 4. Build custom_variables with sample data or sensible defaults
        const customVariables = sampleVariables || {
            name: userName,
            first_name: user.firstName || "Test",
            last_name: user.lastName || "User",
            email: userEmail || "",
            phone: userPhone || "",
            company: "Test Co",
        };

        // 5. Enroll with is_test: true
        const { data: enrollment, error: enrollError } = await supabase
            .from("sequence_enrollments")
            .insert({
                sequence_id: sequenceId,
                contact_id: contactId,
                tenant_id: clientId,
                status: "active",
                current_step_order: 0,
                enrollment_source: "test_mode",
                enrolled_at: new Date().toISOString(),
                next_step_at: new Date().toISOString(),
                sentiment_trend: "stable",
                last_emotion: null,
                recommended_tone: null,
                is_hot_lead: false,
                is_at_risk: false,
                engagement_score: 50,
                needs_human_intervention: false,
                custom_variables: customVariables,
                contact_replied: false,
                contact_answered_call: false,
                appointment_booked: false,
                channel_overrides: {},
                is_test: true,
            })
            .select("id")
            .single();

        if (enrollError) {
            console.error("createTestEnrollment enroll error:", enrollError);
            return { success: false, error: enrollError.message };
        }

        // Auto-advance pipeline: new contact → New Lead, enrolled → Contacted
        await autoAdvanceContactStage(contactId, clientId, "New Lead").catch(() => {});
        await autoAdvanceContactStage(contactId, clientId, "Contacted").catch(() => {});

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, enrollmentId: enrollment?.id };
    } catch (error) {
        console.error("createTestEnrollment error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════
// CSV Bulk Enrollment
// ═══════════════════════════════════════════════════════════════════

type ColumnRole = ImportColumnRole;

// Internal: enroll a list of already-upserted contacts into a sequence. Shared
// by bulkEnrollFromCSV (CSV path) and enrollListInSequence (saved-list path).
// Pacing is loaded once from the sequence; next_step_at is staggered across the
// batch when pacing is set. sourceListId, when provided, stamps lineage on each
// enrollment row so we can audit which list a sequence run came from.
async function enrollUpsertedRows(
    sequenceId: string,
    clientId: string,
    upserted: UpsertedRow[],
    options: { isTest?: boolean; sourceListId?: string | null; enrollmentSource?: string },
): Promise<{ enrolled: number; errors: string[] }> {
    const isTest = options.isTest === true;
    const sourceListId = options.sourceListId ?? null;
    const enrollmentSource = options.enrollmentSource ?? "csv_upload";

    if (upserted.length === 0) return { enrolled: 0, errors: [] };

    const { data: sequenceRow } = await supabase
        .from("sequences")
        .select("pacing_per_minute")
        .eq("id", sequenceId)
        .single();
    const pacingPerMinute = sequenceRow?.pacing_per_minute as number | null | undefined;
    const pacingIntervalMs =
        pacingPerMinute && pacingPerMinute > 0 ? Math.floor(60_000 / pacingPerMinute) : 0;
    const baseTime = Date.now();

    const ENGAGED = new Set(["replied", "booked", "converted", "manual_stop", "unenrolled"]);
    const errors: string[] = [];
    let enrolled = 0;

    for (const row of upserted) {
        try {
            const { data: existingEnrollment } = await supabase
                .from("sequence_enrollments")
                .select("id, status")
                .eq("sequence_id", sequenceId)
                .eq("contact_id", row.contactId)
                .maybeSingle();

            if (existingEnrollment && ENGAGED.has(existingEnrollment.status)) {
                errors.push(
                    `Row ${row.rowIndex}: Contact (${row.phone}) has status ${existingEnrollment.status} — won't re-dial someone who already engaged`,
                );
                continue;
            }

            const nextStepAt = isTest
                ? new Date().toISOString()
                : pacingIntervalMs
                  ? new Date(baseTime + enrolled * pacingIntervalMs).toISOString()
                  : new Date().toISOString();

            if (existingEnrollment) {
                const { error: updateErr } = await supabase
                    .from("sequence_enrollments")
                    .update({
                        status: "active",
                        current_step_order: 0,
                        next_step_at: nextStepAt,
                        is_test: isTest,
                        completed_at: null,
                        custom_variables: row.customVariables,
                        enrollment_source: enrollmentSource,
                        source_list_id: sourceListId,
                        contact_replied: false,
                        contact_answered_call: false,
                        appointment_booked: false,
                    })
                    .eq("id", existingEnrollment.id);
                if (updateErr) {
                    errors.push(`Row ${row.rowIndex}: Re-enroll failed — ${updateErr.message}`);
                    continue;
                }
            } else {
                const { error: enrollErr } = await supabase.from("sequence_enrollments").insert({
                    sequence_id: sequenceId,
                    contact_id: row.contactId,
                    tenant_id: clientId,
                    status: "active",
                    current_step_order: 0,
                    enrollment_source: enrollmentSource,
                    enrolled_at: new Date().toISOString(),
                    next_step_at: nextStepAt,
                    is_test: isTest,
                    sentiment_trend: "stable",
                    last_emotion: null,
                    recommended_tone: null,
                    is_hot_lead: false,
                    is_at_risk: false,
                    engagement_score: 50,
                    needs_human_intervention: false,
                    custom_variables: row.customVariables,
                    source_list_id: sourceListId,
                    contact_replied: false,
                    contact_answered_call: false,
                    appointment_booked: false,
                    channel_overrides: {},
                });
                if (enrollErr) {
                    errors.push(`Row ${row.rowIndex}: Enrollment failed — ${enrollErr.message}`);
                    continue;
                }
            }

            await autoAdvanceContactStage(row.contactId, clientId, "New Lead").catch(() => {});
            await autoAdvanceContactStage(row.contactId, clientId, "Contacted").catch(() => {});

            enrolled++;
        } catch (e: any) {
            errors.push(`Row ${row.rowIndex}: ${e?.message || "Unknown error"}`);
        }
    }

    return { enrolled, errors };
}

export async function bulkEnrollFromCSV(
    sequenceId: string,
    clientId: string,
    rows: Record<string, string>[],
    columnMapping: Record<string, ColumnRole>,
    options?: { isTest?: boolean },
) {
    try {
        if (!rows || rows.length === 0) {
            return { success: false, error: "No rows to process" };
        }
        if (!Object.values(columnMapping).includes("phone")) {
            return { success: false, error: "A phone column mapping is required" };
        }

        const upsertResult = await upsertContactsFromRows(clientId, rows, columnMapping);
        const { enrolled, errors: enrollErrors } = await enrollUpsertedRows(
            sequenceId,
            clientId,
            upsertResult.upserted,
            { isTest: options?.isTest, enrollmentSource: "csv_upload" },
        );

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);

        return {
            success: true,
            data: {
                enrolled,
                errors: [...upsertResult.errors, ...enrollErrors],
            },
        };
    } catch (error: any) {
        console.error("bulkEnrollFromCSV error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// Enroll every member of a saved contact list into a sequence. Replays each
// member's stored source_row through the list's column_mapping, so per-row
// custom_variables match exactly what the original CSV produced. Members added
// manually (no source_row) get a synthetic row built from their core contact
// fields. Stamps source_list_id on each enrollment for lineage.
export async function enrollListInSequence(
    sequenceId: string,
    listId: string,
    options?: { isTest?: boolean },
): Promise<{
    success: boolean;
    error?: string;
    data?: { enrolled: number; errors: string[] };
}> {
    try {
        const { data: list, error: listErr } = await supabase
            .from("contact_lists")
            .select("id, client_id, column_mapping, archived_at")
            .eq("id", listId)
            .single();
        if (listErr || !list) {
            return { success: false, error: "List not found" };
        }
        if (list.archived_at) {
            return { success: false, error: "Cannot enroll an archived list" };
        }

        const columnMapping = (list.column_mapping || {}) as Record<string, ColumnRole>;
        if (!Object.values(columnMapping).includes("phone")) {
            return {
                success: false,
                error: "List has no phone column mapping. Edit the list mapping before enrolling.",
            };
        }

        const { data: members } = await supabase
            .from("contact_list_members")
            .select("contact_id, source_row, contacts(id, phone, name, email, custom_fields)")
            .eq("list_id", listId);

        if (!members || members.length === 0) {
            return { success: true, data: { enrolled: 0, errors: ["List has no members"] } };
        }

        // Build UpsertedRow shape directly from list members — contacts already
        // exist; we don't need upsertContactsFromRows here. Note: we still
        // construct customVariables off the saved source_row using the list's
        // column_mapping so each enrollment row matches the original CSV.
        const upserted: UpsertedRow[] = [];
        const errors: string[] = [];

        for (let i = 0; i < members.length; i++) {
            const m: any = members[i];
            const contact = m.contacts;
            if (!contact) {
                errors.push(`Member ${i + 1}: contact missing`);
                continue;
            }
            const row: Record<string, string> =
                m.source_row || syntheticRowFromContact(contact);

            const customVariables: Record<string, string> = {};
            for (const [col, role] of Object.entries(columnMapping)) {
                if (role !== "skip" && row[col] !== undefined && String(row[col]).trim()) {
                    customVariables[col] = String(row[col]).trim();
                }
            }

            upserted.push({
                contactId: contact.id,
                rowIndex: i + 1,
                customVariables,
                sourceRow: row,
                phone: contact.phone,
                name: contact.name,
                email: contact.email,
            });
        }

        const { enrolled, errors: enrollErrors } = await enrollUpsertedRows(
            sequenceId,
            list.client_id,
            upserted,
            {
                isTest: options?.isTest,
                sourceListId: listId,
                enrollmentSource: "list_enrollment",
            },
        );

        revalidatePath(`/client/${list.client_id}/sequences/${sequenceId}`);

        return {
            success: true,
            data: { enrolled, errors: [...errors, ...enrollErrors] },
        };
    } catch (error: any) {
        console.error("enrollListInSequence error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Test enroll: fire ad-hoc phone numbers as test enrollments ──────────────
// Used by the "Test now" button on the sequence canvas. Creates contacts on
// the fly (or reuses existing), enrolls them with is_test=true and
// next_step_at=NOW so the scheduler-worker fires them immediately, bypassing
// pacing + business-hours + TCPA gates.

interface TestEnrollInput {
    phone: string;
    name?: string;
    customVariables?: Record<string, string>;
}

export async function enrollTestPhones(
    sequenceId: string,
    clientId: string,
    inputs: TestEnrollInput[]
): Promise<{
    success: boolean;
    error?: string;
    data?: { enrolled: number; errors: string[] };
}> {
    try {
        if (!inputs || inputs.length === 0) {
            return { success: false, error: "No phones provided" };
        }

        let enrolled = 0;
        const errors: string[] = [];
        const now = new Date().toISOString();

        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const label = `#${i + 1}`;
            try {
                const phone = toE164(input.phone, "US");
                if (!phone) {
                    errors.push(`${label}: invalid phone "${input.phone}"`);
                    continue;
                }

                let contactId: string;
                const { data: existing } = await supabase
                    .from("contacts")
                    .select("id")
                    .eq("client_id", clientId)
                    .eq("phone", phone)
                    .maybeSingle();

                if (existing?.id) {
                    contactId = existing.id;
                } else {
                    const { data: created, error: contactErr } = await supabase
                        .from("contacts")
                        .insert({
                            client_id: clientId,
                            phone,
                            name: input.name || null,
                            custom_fields: { is_test_contact: true },
                            total_calls: 0,
                        })
                        .select("id")
                        .single();
                    if (contactErr || !created) {
                        errors.push(
                            `${label}: contact upsert failed — ${contactErr?.message || "unknown"}`
                        );
                        continue;
                    }
                    contactId = created.id;
                }

                const safeName = input.name?.trim() || "Test Contact";
                const customVariables: Record<string, string> = {
                    ...(input.customVariables || {}),
                    name: safeName,
                    phone,
                };
                if (input.name?.trim()) {
                    const [first, ...rest] = input.name.trim().split(/\s+/);
                    customVariables.first_name = first;
                    if (rest.length) customVariables.last_name = rest.join(" ");
                }

                // (sequence_id, contact_id) is unique — if a row already
                // exists (e.g. completed by the off-by-one bug, or active from
                // a prior CSV upload), reset it instead of failing on the
                // unique constraint.
                const { data: existingEnroll } = await supabase
                    .from("sequence_enrollments")
                    .select("id, status")
                    .eq("sequence_id", sequenceId)
                    .eq("contact_id", contactId)
                    .maybeSingle();

                if (existingEnroll) {
                    const ENGAGED = new Set([
                        "replied",
                        "booked",
                        "converted",
                        "manual_stop",
                        "unenrolled",
                    ]);
                    if (ENGAGED.has(existingEnroll.status)) {
                        errors.push(
                            `${label}: contact has status ${existingEnroll.status} — won't retest someone who already engaged`
                        );
                        continue;
                    }
                    const { error: updateErr } = await supabase
                        .from("sequence_enrollments")
                        .update({
                            status: "active",
                            current_step_order: 0,
                            next_step_at: now,
                            is_test: true,
                            completed_at: null,
                            custom_variables: customVariables,
                            enrollment_source: "test_now",
                            contact_replied: false,
                            contact_answered_call: false,
                            appointment_booked: false,
                        })
                        .eq("id", existingEnroll.id);
                    if (updateErr) {
                        errors.push(
                            `${label}: re-test reset failed — ${updateErr.message}`
                        );
                        continue;
                    }
                    enrolled++;
                    continue;
                }

                const { error: enrollErr } = await supabase
                    .from("sequence_enrollments")
                    .insert({
                        sequence_id: sequenceId,
                        contact_id: contactId,
                        tenant_id: clientId,
                        status: "active",
                        current_step_order: 0,
                        enrollment_source: "test_now",
                        enrolled_at: now,
                        next_step_at: now,
                        is_test: true,
                        sentiment_trend: "stable",
                        last_emotion: null,
                        recommended_tone: null,
                        is_hot_lead: false,
                        is_at_risk: false,
                        engagement_score: 50,
                        needs_human_intervention: false,
                        custom_variables: customVariables,
                        contact_replied: false,
                        contact_answered_call: false,
                        appointment_booked: false,
                        channel_overrides: {},
                    });

                if (enrollErr) {
                    errors.push(`${label}: enroll failed — ${enrollErr.message}`);
                    continue;
                }
                enrolled++;
            } catch (err: any) {
                errors.push(`${label}: ${err?.message || "unknown error"}`);
            }
        }

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, data: { enrolled, errors } };
    } catch (error: any) {
        console.error("enrollTestPhones error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Convert existing enrollments to test mode + fire immediately ───────────
// Used by the "Test now → From sequence" path. Picks live enrollments that
// were created by CSV upload (or any other source), flips is_test=true and
// schedules next_step_at=NOW() so the scheduler-worker dispatches them on
// the next 5s tick — bypassing pacing + business-hours + TCPA gates per
// the worker's isTestEnrollment branch.
//
// Only converts enrollments in active/paused state. Completed/failed flows
// can't be retested in-place because current_step_order is past the last
// step; the user should re-enroll the phone via the Manual tab to start
// over.

export async function convertEnrollmentsToTest(
    enrollmentIds: string[],
    clientId: string
): Promise<{
    success: boolean;
    error?: string;
    data?: { converted: number; skipped: { id: string; reason: string }[] };
}> {
    try {
        if (!enrollmentIds || enrollmentIds.length === 0) {
            return { success: false, error: "No enrollments selected" };
        }

        // Load + scope-check the rows up-front so we don't touch enrollments
        // outside this client.
        const { data: rows, error: readErr } = await supabase
            .from("sequence_enrollments")
            .select("id, status, tenant_id, sequence_id")
            .in("id", enrollmentIds);

        if (readErr) {
            return { success: false, error: readErr.message };
        }

        const skipped: { id: string; reason: string }[] = [];
        const continuable: string[] = []; // active/paused — flip + reschedule
        const restartable: string[] = []; // completed/failed — reset to step 0
        let sequenceId: string | null = null;

        // Don't re-test contacts who already engaged — that would be spam.
        const ENGAGED = new Set([
            "replied",
            "booked",
            "converted",
            "manual_stop",
            "unenrolled",
        ]);

        for (const row of rows || []) {
            if (row.tenant_id !== clientId) {
                skipped.push({ id: row.id, reason: "wrong tenant" });
                continue;
            }
            if (ENGAGED.has(row.status)) {
                skipped.push({
                    id: row.id,
                    reason: `status is ${row.status} — won't retest a contact who already engaged`,
                });
                continue;
            }
            sequenceId = row.sequence_id;
            if (["completed", "failed"].includes(row.status)) {
                restartable.push(row.id);
            } else {
                continuable.push(row.id);
            }
        }

        if (continuable.length === 0 && restartable.length === 0) {
            return { success: true, data: { converted: 0, skipped } };
        }

        const now = new Date().toISOString();

        if (continuable.length > 0) {
            const { error: contErr } = await supabase
                .from("sequence_enrollments")
                .update({
                    is_test: true,
                    next_step_at: now,
                    status: "active",
                })
                .in("id", continuable);
            if (contErr) return { success: false, error: contErr.message };
        }

        if (restartable.length > 0) {
            // Re-test from step 1: reset current_step_order and clear
            // completed_at so the worker fetches step_order=1 and
            // analytics don't double-count.
            const { error: restErr } = await supabase
                .from("sequence_enrollments")
                .update({
                    is_test: true,
                    next_step_at: now,
                    status: "active",
                    current_step_order: 0,
                    completed_at: null,
                })
                .in("id", restartable);
            if (restErr) return { success: false, error: restErr.message };
        }

        if (sequenceId) {
            revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        }
        return {
            success: true,
            data: {
                converted: continuable.length + restartable.length,
                skipped,
            },
        };
    } catch (error: any) {
        console.error("convertEnrollmentsToTest error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Create sequence from Goal-First Wizard ──────────────────────────────────

const GOAL_TO_SEQUENCE_META: Record<string, { name: string; description: string; trigger_type: string; urgency_tier: string }> = {
    missed_call_followup: {
        name: "Missed Call Follow-up",
        description: "AI-powered follow-up for leads who called but didn't connect",
        trigger_type: "missed_call",
        urgency_tier: "high",
    },
    dormant_reengagement: {
        name: "Dormant Lead Re-engagement",
        description: "Win back leads who went cold with adaptive AI outreach",
        trigger_type: "manual",
        urgency_tier: "medium",
    },
    new_lead_nurture: {
        name: "New Lead Nurture",
        description: "Build relationships with fresh inbound leads through multi-channel outreach",
        trigger_type: "new_lead",
        urgency_tier: "medium",
    },
    post_appointment: {
        name: "Post-Appointment Follow-up",
        description: "Stay top-of-mind after visits and estimates",
        trigger_type: "status_change",
        urgency_tier: "low",
    },
    win_back_quotes: {
        name: "Win Back Lost Quotes",
        description: "Re-engage leads who received a quote but haven't converted",
        trigger_type: "manual",
        urgency_tier: "medium",
    },
    meta_ads_lead: {
        name: "Meta Ads — New Lead",
        description: "Multi-channel outreach for leads captured by Meta Lead Ads",
        trigger_type: "meta_ads_lead",
        urgency_tier: "high",
    },
    google_ads_lead: {
        name: "Google Ads — New Lead",
        description: "Multi-channel outreach for leads captured by Google Lead Form Assets",
        trigger_type: "google_ads_lead",
        urgency_tier: "high",
    },
};

interface WizardInput {
    goal: string;
    customGoalDescription?: string;
    channels: { sms: boolean; email: boolean; voice: boolean };
    cadence: number;
    duration: number;
    handoffRules: {
        success_conditions: string[];
        handoff_triggers: Array<{ type: string; label: string; id?: string; description?: string }>;
        no_response: { max_touchpoints: number; after_sequence: string; reengage_weeks?: number };
        notification: { sms: string; email: string; push: boolean; urgent_call: boolean };
    };
    stepBriefs: Array<{ channel: string; intent: string; cta: string }>;
}

export async function createSequenceFromWizard(
    clientId: string,
    input: WizardInput
): Promise<{ success: boolean; sequenceId?: string; error?: string; replacedSequenceName?: string }> {
    try {
        const meta = GOAL_TO_SEQUENCE_META[input.goal] || {
            name: input.customGoalDescription?.slice(0, 50) || "Custom Sequence",
            description: input.customGoalDescription || "AI-powered custom outreach sequence",
            trigger_type: "manual",
            urgency_tier: "medium",
        };

        // Ad-platform triggers are mutually exclusive per client: only one
        // active sequence may listen to "meta_ads_lead" or "google_ads_lead"
        // at a time. If one already exists, deactivate it before activating
        // the new one — otherwise a single ad lead would fan out into
        // duplicate outreach.
        let replacedSequenceName: string | undefined;
        if (meta.trigger_type === "meta_ads_lead" || meta.trigger_type === "google_ads_lead") {
            const { data: existing } = await supabase
                .from("sequences")
                .select("id, name")
                .eq("client_id", clientId)
                .eq("trigger_type", meta.trigger_type)
                .eq("is_active", true)
                .limit(1);
            if (existing && existing.length > 0) {
                replacedSequenceName = existing[0].name;
                await supabase
                    .from("sequences")
                    .update({ is_active: false, updated_at: new Date().toISOString() })
                    .eq("id", existing[0].id);
            }
        }

        const enabledChannels = Object.entries(input.channels)
            .filter(([, v]) => v)
            .map(([k]) => k);

        const totalSteps = input.cadence * input.duration;

        // Build the sequence strategy (used by dynamic step generation)
        const sequenceStrategy = {
            goal: input.goal,
            custom_goal_description: input.customGoalDescription || null,
            available_channels: enabledChannels,
            cadence_per_week: input.cadence,
            duration_weeks: input.duration,
            max_steps: totalSteps,
            generation_mode: "dynamic",
        };

        const handoffRulesData = {
            success_conditions: input.handoffRules.success_conditions,
            handoff_triggers: input.handoffRules.handoff_triggers,
            no_response: input.handoffRules.no_response,
            notification: input.handoffRules.notification,
        };

        // Insert the sequence
        const { data: seq, error: seqError } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name: meta.name,
                description: meta.description,
                trigger_type: meta.trigger_type,
                urgency_tier: meta.urgency_tier,
                generation_mode: "dynamic",
                sequence_strategy: sequenceStrategy,
                max_attempts: totalSteps,
                ai_generated: true,
                is_active: true,
                handoff_rules: handoffRulesData,
                metadata: {
                    wizard_created: true,
                },
            })
            .select("id")
            .single();

        if (seqError || !seq) {
            console.error("createSequenceFromWizard insert error:", seqError);
            return { success: false, error: seqError?.message || "Failed to create sequence" };
        }

        // Insert step briefs as sequence_steps
        if (input.stepBriefs.length > 0) {
            const steps = input.stepBriefs.map((brief, idx) => {
                const delayMinutes = idx === 0 ? 0 : Math.round((7 * 24 * 60) / input.cadence);

                const content: Record<string, any> = {};
                if (brief.channel === "sms") {
                    content.body = `[AI-generated at dispatch] Intent: ${brief.intent}`;
                } else if (brief.channel === "email") {
                    content.subject = `[AI-generated at dispatch]`;
                    content.body_html = `<p>Intent: ${brief.intent}</p>`;
                    content.body_text = `Intent: ${brief.intent}`;
                } else if (brief.channel === "voice") {
                    content.first_message = `[AI-generated at dispatch]`;
                    content.system_prompt = `Intent: ${brief.intent}. CTA: ${brief.cta}`;
                }

                return {
                    sequence_id: seq.id,
                    step_order: idx + 1,
                    channel: brief.channel,
                    delay_minutes: delayMinutes,
                    delay_type: idx === 0 ? "immediate" : "fixed_delay",
                    content,
                    // The scheduler's intent-guided generation path keys off
                    // step_brief — without it, the placeholder content above
                    // is dispatched verbatim as the lead's first touch.
                    step_brief: {
                        intent: brief.intent || input.customGoalDescription || meta.description,
                        key_points: [],
                        cta: brief.cta || "",
                        constraints: [],
                    },
                    enable_ai_mutation: true,
                    mutation_instructions: `Goal: ${brief.intent}. CTA: ${brief.cta}. Generate fresh content at dispatch time using real conversation context.`,
                    generated_dynamically: true,
                    on_success: { action: "continue" },
                    on_failure: { action: "skip" },
                };
            });

            const { error: stepsError } = await supabase
                .from("sequence_steps")
                .insert(steps);

            if (stepsError) {
                console.error("createSequenceFromWizard steps error:", stepsError);
                // Sequence still created, steps failed — non-fatal for dynamic mode
            }
        }

        revalidatePath(`/client/${clientId}/sequences`);

        return { success: true, sequenceId: seq.id, replacedSequenceName };
    } catch (error: any) {
        console.error("createSequenceFromWizard error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
