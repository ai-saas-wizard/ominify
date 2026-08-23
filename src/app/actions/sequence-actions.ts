"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { canAccessClient } from "@/lib/auth";
import { canPlaceCall } from "@/lib/access";
import { autoAdvanceContactStage } from "@/app/actions/pipeline-actions";
import { ensureNumbersInMessagingService } from "@/app/actions/twilio-actions";
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
    assertOutboundAgent,
    assertSequenceEditable,
} from "@/lib/sequences/sequence-core";
import {
    getChannelCapabilities,
    deriveAvailableChannels,
} from "@/lib/channels/capabilities";

// Normalize any phone input to E.164 (+12223334444). Defaults to US.
// Returns null for unparseable or invalid numbers.
function toE164(raw: string, defaultCountry: "US" = "US"): string | null {
    if (!raw) return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
}

// Trim + lowercase an email, or null if it doesn't look like one. There's no
// shared email validator in the repo; test enrollment only needs enough of a
// check to keep obvious typos out of `contacts.email`.
function normalizeEmail(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// Shared guard for the test-enrollment actions. These take clientId straight
// from the browser and the Supabase client is service-role (RLS bypassed), so
// without this any signed-in user could enroll into another tenant's sequence.
async function assertClientAccess(
    clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Not authenticated" };
    const user = await currentUser();
    const lookupKey = user?.emailAddresses[0]?.emailAddress || userId;
    return (await canAccessClient(lookupKey, clientId))
        ? { ok: true }
        : { ok: false, error: "Forbidden" };
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
            // The manual dialog is the explicit Advanced/static path, pin
            // static so it's unaffected by the core's dynamic default.
            generation_mode: (formData.get("generation_mode") as string) || "static",
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

export interface RotationPhoneOption {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    vapi_phone_number_id: string | null;
    /** Agent this number is dedicated to (inbound routing), if any. */
    agent_name: string | null;
}

/**
 * The account's active numbers, for the "Rotate numbers" picker. Same query
 * as the outbound caller-ID settings page, plus the assigned-agent name so
 * the operator can see which numbers double as an agent's inbound line.
 */
export async function listRotationPhoneOptions(
    clientId: string
): Promise<RotationPhoneOption[]> {
    const access = await assertClientAccess(clientId);
    if (!access.ok) return [];

    const [{ data: phones, error }, { data: agents }] = await Promise.all([
        supabase
            .from("tenant_phone_numbers")
            .select("id, phone_number, friendly_name, vapi_phone_number_id, agent_id")
            .eq("client_id", clientId)
            .eq("status", "active")
            .order("created_at", { ascending: true }),
        supabase.from("agents").select("id, name").eq("client_id", clientId),
    ]);
    if (error) {
        console.error("listRotationPhoneOptions error:", error);
        return [];
    }
    const agentNames = new Map<string, string>(
        (agents ?? []).map((a) => [a.id as string, a.name as string])
    );
    return (phones ?? []).map((p) => ({
        id: p.id as string,
        phone_number: p.phone_number as string,
        friendly_name: (p.friendly_name as string | null) ?? null,
        vapi_phone_number_id: (p.vapi_phone_number_id as string | null) ?? null,
        agent_name: p.agent_id ? agentNames.get(p.agent_id as string) ?? null : null,
    }));
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

/**
 * Rename a sequence.
 *
 * Wizard-created sequences take their name from the first 50 characters of the
 * AI goal, so the list ends up showing a truncated paragraph twice: once as the
 * name and once as the description under it. This lets an operator give the
 * campaign a short human name without touching the brief the AI actually runs.
 */
export async function renameSequence(sequenceId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "Give the sequence a name" };
    if (trimmed.length > 120) {
        return { success: false, error: "Keep the name under 120 characters" };
    }
    // Only `name` is set, so updateSequenceCore leaves the description, the
    // trigger and the bound agent untouched.
    const fd = new FormData();
    fd.set("name", trimmed);
    return updateSequence(sequenceId, fd);
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

        // 2. Mark all in-flight enrollments as unenrolled so dispatches are
        // halted (dynamic enrollments live in awaiting_outcome/generating_next_step)
        await supabase
            .from("sequence_enrollments")
            .update({
                status: "unenrolled",
                completed_at: new Date().toISOString(),
                completed_reason: "sequence_deleted",
                next_step_at: null,
                outcome_timeout_at: null,
            })
            .eq("sequence_id", sequenceId)
            .in("status", ["active", "paused", "awaiting_outcome", "generating_next_step"]);

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
            .select("sequence_id, step_order, enrollment_id, sequences(client_id)")
            .eq("id", stepId)
            .single();

        // Guard: dynamic sequences' steps are AI-generated per lead, deleting
        // (and renumbering) them by hand would corrupt enrollment histories.
        // This action bypasses sequence-core, so the gate lives here too.
        if (step) {
            if (step.enrollment_id) {
                return {
                    success: false,
                    error: "This step was generated by the AI for a specific lead and cannot be deleted.",
                };
            }
            const editable = await assertSequenceEditable(step.sequence_id);
            if (!editable.ok) return { success: false, error: editable.error };
        }

        const { error } = await supabase
            .from("sequence_steps")
            .delete()
            .eq("id", stepId);

        if (error) {
            console.error("deleteSequenceStep error:", error);
            return { success: false, error: error.message };
        }

        // Re-order remaining steps. Scoped to shared template rows, per-lead
        // JIT rows (enrollment_id set) keep their own numbering.
        if (step) {
            const { data: remainingSteps } = await supabase
                .from("sequence_steps")
                .select("id, step_order")
                .eq("sequence_id", step.sequence_id)
                .is("enrollment_id", null)
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
        const editable = await assertSequenceEditable(sequenceId);
        if (!editable.ok) return { success: false, error: editable.error };

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

// ─── Resume enrollments paused by deactivation ─────────────────────────────────

/**
 * Put a sequence's paused enrollments back into rotation.
 *
 * Deactivating a sequence sweeps every in-flight enrollment to
 * status='paused', next_step_at=null (setSequenceActiveCore), that sweep is
 * what actually halts dispatch. Re-activating deliberately does NOT undo it,
 * so without this the leads stay parked forever. `paused` has exactly one
 * writer (that sweep), so resuming the whole set is unambiguous.
 *
 * next_step_at is re-staggered by the sequence's pacing_per_minute. Without
 * that, every resumed lead becomes due on the same tick and the batch
 * stampedes the moment the window opens, the exact thing the pacing controls
 * exist to prevent.
 */
export async function resumeSequenceEnrollments(sequenceId: string) {
    try {
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id, is_active, pacing_per_minute")
            .eq("id", sequenceId)
            .single();
        if (!seq) return { success: false, error: "Sequence not found" };

        const access = await assertClientAccess(seq.client_id);
        if (!access.ok) return { success: false, error: access.error };

        // The scheduler claims on enrollment status alone, so resuming into a
        // deactivated sequence would dispatch anyway. Refuse instead, so the
        // Inactive badge keeps meaning something.
        if (!seq.is_active) {
            return {
                success: false,
                error: "Activate the sequence first. Resuming while it is inactive would start outreach anyway.",
            };
        }

        const { data: paused, error: fetchErr } = await supabase
            .from("sequence_enrollments")
            .select("id, current_step_order")
            .eq("sequence_id", sequenceId)
            .eq("status", "paused");
        if (fetchErr) return { success: false, error: fetchErr.message };
        if (!paused || paused.length === 0) {
            return { success: true, data: { resumed: 0 } };
        }

        const pacing = seq.pacing_per_minute as number | null;
        const intervalMs = pacing && pacing > 0 ? Math.floor(60_000 / pacing) : 0;
        const baseTime = Date.now();

        // Deactivating nulls next_step_at, so the original schedule is gone.
        // Firing everyone at "now" collapses the cadence: a lead who was three
        // days from their next touch gets it seconds after the resume. That is
        // how a live pilot sent 23 leads a second SMS within an hour of the
        // first, against a step delay of 3.5 days.
        //
        // The step to look up is resolved the same way the scheduler resolves
        // it (scheduler-worker fetchStep): step_order = current_step_order + 1,
        // preferring this enrollment's OWN generated row over a shared template
        // row at the same order. A template-only lookup silently returned
        // undefined for dynamic enrollments, the exact population this exists
        // to protect, and fell straight back to "now".
        const templateDelays = new Map<number, number>();
        {
            const { data: steps } = await supabase
                .from("sequence_steps")
                .select("step_order, delay_minutes")
                .eq("sequence_id", sequenceId)
                .is("enrollment_id", null);
            for (const st of steps || []) {
                templateDelays.set(st.step_order as number, (st.delay_minutes as number) ?? 0);
            }
        }
        // Per-enrollment (JIT) steps, keyed by enrollment + order.
        const ownDelays = new Map<string, number>();
        {
            const { data: steps } = await supabase
                .from("sequence_steps")
                .select("enrollment_id, step_order, delay_minutes")
                .eq("sequence_id", sequenceId)
                .in("enrollment_id", paused.map((p: any) => p.id));
            for (const st of steps || []) {
                ownDelays.set(`${st.enrollment_id}:${st.step_order}`, (st.delay_minutes as number) ?? 0);
            }
        }

        let resumed = 0;
        let stranded = 0;
        const errors: string[] = [];
        for (let i = 0; i < paused.length; i++) {
            const row = paused[i] as { id: string; current_step_order?: number | null };
            const nextOrder = (row.current_step_order ?? 0) + 1;

            const ownKey = `${row.id}:${nextOrder}`;
            const hasOwn = ownDelays.has(ownKey);
            const hasTemplate = templateDelays.has(nextOrder);

            // No step exists at this order, on either path. Deactivation sweeps
            // awaiting_outcome/generating_next_step rows to paused with
            // current_step_order already advanced, so a dynamic lead past the
            // template count has nothing to run: reviving it as active makes
            // the scheduler find no step and silently mark it completed,
            // dropping the lead. Leave it paused and report it instead.
            if (!hasOwn && !hasTemplate) {
                stranded++;
                continue;
            }

            const delayMs = (hasOwn ? ownDelays.get(ownKey)! : templateDelays.get(nextOrder)!) * 60_000;

            let dueAt = baseTime;
            if (delayMs > 0) {
                const { data: lastRun } = await supabase
                    .from("sequence_execution_log")
                    .select("executed_at")
                    .eq("enrollment_id", row.id)
                    .order("executed_at", { ascending: false })
                    .limit(1);
                const lastAt = lastRun?.[0]?.executed_at
                    ? new Date(lastRun[0].executed_at as string).getTime()
                    : null;
                if (lastAt) dueAt = Math.max(baseTime, lastAt + delayMs);
            }

            const nextStepAt = new Date(dueAt + i * intervalMs).toISOString();
            const { error } = await supabase
                .from("sequence_enrollments")
                .update({
                    status: "active",
                    next_step_at: nextStepAt,
                    outcome_timeout_at: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", paused[i].id)
                // Only move rows still paused, never revive one that changed
                // underneath us (opted out, unenrolled) while we iterated.
                .eq("status", "paused");
            if (error) errors.push(error.message);
            else resumed++;
        }

        revalidatePath(`/client/${seq.client_id}/sequences`);
        revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        return { success: true, data: { resumed, stranded, errors } };
    } catch (error) {
        console.error("resumeSequenceEnrollments error:", error);
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

// Per-enrollment variant kept for the admin MCP enrollment route, which drills
// into ONE lead's history (getExecutionLog above is sequence-scoped).
export async function getEnrollmentExecutionLog(enrollmentId: string) {
    try {
        const { data, error } = await supabase
            .from("sequence_execution_log")
            .select(`
                *,
                sequence_steps(step_order, channel, content)
            `)
            .eq("enrollment_id", enrollmentId)
            .order("executed_at", { ascending: true });

        if (error) {
            console.error("getEnrollmentExecutionLog error:", error);
            return { success: false, error: error.message, data: [] };
        }
        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getEnrollmentExecutionLog error:", error);
        return { success: false, error: "Failed to fetch execution log", data: [] };
    }
}

// ─── Per-lead journey for the dynamic observability view ──────────────────────
//
// One lazy bundle per enrollment: execution-log rows (with the generating
// step's full shape joined by the log row's step_id, this also resolves the
// wizard's shared template row for first touches, which has enrollment_id
// NULL) enriched with mutations/healing, plus the contact_interactions
// recorded against this enrollment. The client interleaves both by timestamp.
export async function getEnrollmentJourney(enrollmentId: string) {
    try {
        const [logResult, interactionsResult] = await Promise.all([
            supabase
                .from("sequence_execution_log")
                .select(`
                    *,
                    sequence_steps(step_order, channel, content, delay_minutes, generated_dynamically, enrollment_id, step_brief)
                `)
                .eq("enrollment_id", enrollmentId)
                .order("executed_at", { ascending: true }),
            supabase
                .from("contact_interactions")
                .select("*")
                .eq("enrollment_id", enrollmentId)
                .order("created_at", { ascending: true }),
        ]);

        if (logResult.error) {
            console.error("getEnrollmentJourney log error:", logResult.error);
            return { success: false, error: logResult.error.message, logs: [], interactions: [] };
        }

        const logs = logResult.data || [];

        // Enrich with mutation + healing data (match on enrollment_id + step_id,
        // same as getExecutionLog, static steps reuse step_id across leads).
        let mutations: any[] = [];
        let healings: any[] = [];
        if (logs.length > 0) {
            const [mutResult, healResult] = await Promise.all([
                supabase.from("step_mutations").select("*").eq("enrollment_id", enrollmentId),
                supabase.from("healing_log").select("*").eq("enrollment_id", enrollmentId),
            ]);
            mutations = mutResult.data || [];
            healings = healResult.data || [];
        }

        const enrichedLogs = logs.map((log: any) => {
            const mutation = mutations.find((m: any) => m.step_id === log.step_id);
            const healing = healings.find((h: any) => h.step_id === log.step_id);
            return {
                ...log,
                was_mutated: !!mutation,
                mutation: mutation || null,
                was_healed: !!healing,
                healing: healing || null,
            };
        });

        return {
            success: true,
            logs: enrichedLogs,
            interactions: interactionsResult.data || [],
        };
    } catch (error) {
        console.error("getEnrollmentJourney error:", error);
        return { success: false, error: "Internal error", logs: [], interactions: [] };
    }
}

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
        // enrollment_id and step_id, static sequences reuse the same step_id
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
        // Adaptive mutation is a static-path lever (JIT-generated steps opt out
        // per-step); dynamic sequences don't expose or accept it.
        const editable = await assertSequenceEditable(sequenceId);
        if (!editable.ok) return { success: false, error: editable.error };

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

// ─── Update calling schedule (daily cap / window / pace) ─────────────────────────

// "" / null → null (clear the window). "H:MM" / "HH:MM" / "HH:MM:SS" →
// Postgres TIME. Single-digit hours are accepted (the sequencer's parser
// accepts them, so rejecting here would make the two sides disagree).
function normalizeWindowTime(
    value: string | null | undefined
): string | null | "invalid" {
    if (value === null || value === undefined || value.trim() === "") return null;
    const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
    if (!match) return "invalid";
    const hour = parseInt(match[1], 10);
    if (hour > 23) return "invalid";
    return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

const CALLING_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * True when dialing is possible at all given the calling window, the allowed
 * days, and the tenant's business hours. Without this a window (or day set)
 * entirely outside business hours makes the sequencer's gates defer in
 * alternation forever, the campaign never dials and nothing surfaces why.
 * Reads the onboarding shape ({mon..sun: {open, close, closed}}) and the
 * ops-script shape ({weekdays/saturday/sunday: {start, end}}); unparseable or
 * empty hours count as "no restriction" (possible = true), matching the
 * sequencer's fail-open.
 */
function dialingPossibleWithBusinessHours(
    windowStart: string | null, // 'HH:MM:SS'
    windowEnd: string | null,
    callingDays: string[] | null,
    businessHours: unknown
): boolean {
    if (!businessHours || typeof businessHours !== "object") return true;
    const raw = businessHours as Record<string, any>;
    if (raw.emergency_24_7 === true) return true;

    const toHHMM = (v: unknown): string | null => {
        if (typeof v !== "string") return null;
        const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
        if (!m) return null;
        const h = parseInt(m[1], 10);
        if (h > 23 || parseInt(m[2], 10) > 59) return null;
        return `${String(h).padStart(2, "0")}:${m[2]}`;
    };

    // Per-day open ranges, merged the same way the sequencer merges the two
    // shapes: the ops-script shape first, per-day onboarding entries win.
    const byDay = new Map<string, { start: string; end: string }>();
    const opsRange = (entry: any) => {
        if (!entry || typeof entry !== "object") return null;
        const s = toHHMM(entry.start);
        const e = toHHMM(entry.end);
        return s && e && s < e ? { start: s, end: e } : null;
    };
    const weekdays = opsRange(raw.weekdays);
    if (weekdays) for (const d of ["mon", "tue", "wed", "thu", "fri"]) byDay.set(d, weekdays);
    const sat = opsRange(raw.saturday);
    if (sat) byDay.set("sat", sat);
    const sun = opsRange(raw.sunday);
    if (sun) byDay.set("sun", sun);
    let sawOnboardingEntry = false;
    for (const key of CALLING_DAY_KEYS) {
        const entry = raw[key];
        if (!entry || typeof entry !== "object") continue;
        sawOnboardingEntry = true;
        if (entry.closed === true) {
            byDay.delete(key);
            continue;
        }
        const s = toHHMM(entry.open);
        const e = toHHMM(entry.close);
        if (s && e && s < e) byDay.set(key, { start: s, end: e });
    }
    // Nothing parseable at all → sequencer treats hours as unset (fail open).
    if (byDay.size === 0 && !sawOnboardingEntry && !weekdays && !sat && !sun) return true;

    const days = callingDays && callingDays.length > 0 ? callingDays : [...CALLING_DAY_KEYS];
    const openSelectedRanges = days
        .map((d) => byDay.get(d))
        .filter((r): r is { start: string; end: string } => !!r);
    if (openSelectedRanges.length === 0) {
        // Every selected day is closed. If NO day parses as open the sequencer
        // fails open anyway (misconfig), so only block when hours are real.
        return byDay.size === 0;
    }

    if (!windowStart || !windowEnd) return true;
    const winStart = windowStart.slice(0, 5);
    const winEnd = windowEnd.slice(0, 5);
    return openSelectedRanges.some((r) => winStart < r.end && winEnd > r.start);
}

/**
 * Dial-pacing levers for a sequence. Unlike step authoring, these apply to
 * AI-managed (dynamic) sequences too, bulk voice campaigns are exactly the
 * shape that needs them, so this deliberately does NOT go through
 * assertSequenceEditable.
 *
 * daily_call_cap + calling_window_* are enforced by the sequencer's scheduler
 * (voice steps only, tenant timezone). pacing_per_minute staggers next_step_at
 * at bulk-enrollment time.
 */
export async function updateSequencePacing(
    sequenceId: string,
    settings: {
        daily_call_cap?: number | null;
        calling_window_start?: string | null;
        calling_window_end?: string | null;
        calling_days?: string[] | null;
        pacing_per_minute?: number | null;
    }
) {
    try {
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id, respect_business_hours, calling_window_start, calling_window_end, calling_days")
            .eq("id", sequenceId)
            .single();
        if (!seq) return { success: false, error: "Sequence not found" };

        const access = await assertClientAccess(seq.client_id);
        if (!access.ok) return { success: false, error: access.error };

        const updates: Record<string, number | string | string[] | null> = {};

        if ("daily_call_cap" in settings) {
            const cap = settings.daily_call_cap;
            if (cap !== null && cap !== undefined) {
                if (!Number.isInteger(cap) || cap < 1 || cap > 2000) {
                    return {
                        success: false,
                        error: "Daily call cap must be a whole number from 1 to 2000, or blank for no cap",
                    };
                }
            }
            updates.daily_call_cap = cap ?? null;
        }

        if ("pacing_per_minute" in settings) {
            const pacing = settings.pacing_per_minute;
            if (pacing !== null && pacing !== undefined) {
                if (!Number.isInteger(pacing) || pacing < 1 || pacing > 600) {
                    return {
                        success: false,
                        error: "Pace must be a whole number from 1 to 600 per minute, or blank",
                    };
                }
            }
            updates.pacing_per_minute = pacing ?? null;
        }

        if ("calling_window_start" in settings || "calling_window_end" in settings) {
            const start = normalizeWindowTime(settings.calling_window_start);
            const end = normalizeWindowTime(settings.calling_window_end);
            if (start === "invalid" || end === "invalid") {
                return { success: false, error: "Calling window times must be in HH:MM format" };
            }
            if ((start === null) !== (end === null)) {
                return {
                    success: false,
                    error: "Set both a start and an end time for the calling window, or leave both blank",
                };
            }
            if (start && end && start >= end) {
                return { success: false, error: "Calling window start must be earlier than its end" };
            }
            updates.calling_window_start = start;
            updates.calling_window_end = end;
        }

        if ("calling_days" in settings) {
            const days = settings.calling_days;
            if (days !== null && days !== undefined) {
                if (!Array.isArray(days)) {
                    return { success: false, error: "Calling days must be a list of days" };
                }
                const cleaned = [...new Set(days.map((d) => String(d).toLowerCase()))];
                if (cleaned.some((d) => !(CALLING_DAY_KEYS as readonly string[]).includes(d))) {
                    return { success: false, error: "Calling days must be sun/mon/tue/wed/thu/fri/sat" };
                }
                if (cleaned.length === 0) {
                    return {
                        success: false,
                        error: "Select at least one calling day, or leave every day enabled",
                    };
                }
                // All seven = no restriction; store NULL so the sequencer skips the gate.
                updates.calling_days = cleaned.length === 7 ? null : cleaned;
            } else {
                updates.calling_days = null;
            }
        }

        // Anti-livelock: validate the EFFECTIVE window + days combination (new
        // values where provided, else stored) against business hours, so a
        // days-only edit can't strand a stored window (or vice versa).
        if (seq.respect_business_hours !== false) {
            const effStart = ("calling_window_start" in updates
                ? updates.calling_window_start
                : seq.calling_window_start) as string | null;
            const effEnd = ("calling_window_end" in updates
                ? updates.calling_window_end
                : seq.calling_window_end) as string | null;
            const effDays = ("calling_days" in updates
                ? updates.calling_days
                : seq.calling_days) as string[] | null;
            if (effStart || effDays) {
                const { data: profile } = await supabase
                    .from("tenant_profiles")
                    .select("business_hours")
                    .eq("client_id", seq.client_id)
                    .maybeSingle();
                if (
                    profile &&
                    !dialingPossibleWithBusinessHours(effStart, effEnd, effDays, profile.business_hours)
                ) {
                    return {
                        success: false,
                        error:
                            "With these calling days and window, every allowed time falls outside your business hours, no calls would ever go out. Adjust the days/window, your business hours, or turn off business-hours enforcement for this sequence.",
                    };
                }
            }
        }

        if (Object.keys(updates).length === 0) return { success: true };

        const { error } = await supabase
            .from("sequences")
            .update(updates)
            .eq("id", sequenceId);

        if (error) {
            console.error("updateSequencePacing error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        return { success: true };
    } catch (error) {
        console.error("updateSequencePacing error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Update number rotation ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Rotate numbers": spread this sequence's calls + texts across a hand-picked
 * pool of the account's numbers, sticky per enrollment (enforced by the
 * sequencer's lib/outbound-phone.ts). Like updateSequencePacing this applies
 * to dynamic sequences too, so it deliberately skips assertSequenceEditable.
 *
 * Picked numbers are synced into the tenant's Twilio Messaging Service BEFORE
 * the write: the sms-worker sends `from` + messagingServiceSid, and Twilio
 * rejects a From that isn't in the service's sender pool.
 */
export async function updateSequencePhoneRotation(
    sequenceId: string,
    settings: { rotate_phone_numbers: boolean; rotation_phone_number_ids: string[] }
) {
    try {
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();
        if (!seq) return { success: false, error: "Sequence not found" };

        const access = await assertClientAccess(seq.client_id);
        if (!access.ok) return { success: false, error: access.error };

        const rotate = settings.rotate_phone_numbers === true;
        const ids = [
            ...new Set((settings.rotation_phone_number_ids ?? []).map((id) => String(id))),
        ];
        if (ids.some((id) => !UUID_RE.test(id))) {
            return { success: false, error: "Invalid phone number id" };
        }
        if (rotate && ids.length === 0) {
            return { success: false, error: "Pick at least one number to rotate across" };
        }

        if (ids.length > 0) {
            const { data: phones } = await supabase
                .from("tenant_phone_numbers")
                .select("id, phone_number, status, vapi_phone_number_id")
                .eq("client_id", seq.client_id)
                .in("id", ids);
            const byId = new Map((phones ?? []).map((p) => [p.id as string, p]));
            for (const id of ids) {
                const phone = byId.get(id);
                if (!phone) {
                    return {
                        success: false,
                        error: "One of the selected numbers no longer exists. Reload and pick again.",
                    };
                }
                if (phone.status !== "active") {
                    return { success: false, error: `${phone.phone_number} is not active` };
                }
                if (!phone.vapi_phone_number_id) {
                    return {
                        success: false,
                        error: `${phone.phone_number} isn't registered with VAPI yet, sync it from the Phone Numbers page first`,
                    };
                }
            }

            if (rotate) {
                const sync = await ensureNumbersInMessagingService(seq.client_id, ids);
                if (!sync.success) return { success: false, error: sync.error };
            }
        }

        const { error } = await supabase
            .from("sequences")
            .update({
                rotate_phone_numbers: rotate,
                rotation_phone_number_ids: ids.length > 0 ? ids : null,
            })
            .eq("id", sequenceId);
        if (error) {
            console.error("updateSequencePhoneRotation error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        return { success: true };
    } catch (error) {
        console.error("updateSequencePhoneRotation error:", error);
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
        const { data: step } = await supabase
            .from("sequence_steps")
            .select("sequence_id, enrollment_id, sequences(client_id, generation_mode)")
            .eq("id", stepId)
            .single();

        if (!step) return { success: false, error: "Step not found" };
        if (step.enrollment_id || (step.sequences as any)?.generation_mode === "dynamic") {
            return {
                success: false,
                error: "This sequence is AI-managed; its steps are generated per lead and cannot be edited.",
            };
        }

        const { error } = await supabase
            .from("sequence_steps")
            .update(settings)
            .eq("id", stepId);

        if (error) {
            console.error("updateStepMutationSettings error:", error);
            return { success: false, error: error.message };
        }

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

export type { ChannelReadiness } from "@/lib/channels/capabilities";

// ─── Check which channels are ready for a tenant ─────────────────────────────
// Thin delegator kept for existing importers (task dialog, sequences list);
// the capability logic lives in src/lib/channels/capabilities.ts so both the
// creation actions and the wizard derive channels from the same source.

export async function getChannelReadiness(clientId: string) {
    return getChannelCapabilities(clientId);
}
// ═══════════════════════════════════════════════════════════════════
// Phase 4: Test Mode, "Test on Myself"
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
                    `Row ${row.rowIndex}: Contact (${row.phone}) has status ${existingEnrollment.status}, won't re-dial someone who already engaged`,
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
                    errors.push(`Row ${row.rowIndex}: Re-enroll failed, ${updateErr.message}`);
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
                    errors.push(`Row ${row.rowIndex}: Enrollment failed, ${enrollErr.message}`);
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

        // Build UpsertedRow shape directly from list members, contacts already
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
    /**
     * Optional. Without it, email steps are silently skipped at dispatch , 
     * the scheduler advances past them without even writing a log row.
     */
    email?: string;
    customVariables?: Record<string, string>;
}

export interface TestEnrollmentRef {
    enrollmentId: string;
    contactId: string;
    phone: string;
    name?: string;
}

export async function enrollTestPhones(
    sequenceId: string,
    clientId: string,
    inputs: TestEnrollInput[]
): Promise<{
    success: boolean;
    error?: string;
    data?: {
        enrolled: number;
        errors: string[];
        enrollments: TestEnrollmentRef[];
    };
}> {
    try {
        const access = await assertClientAccess(clientId);
        if (!access.ok) return { success: false, error: access.error };

        if (!inputs || inputs.length === 0) {
            return { success: false, error: "No phones provided" };
        }

        let enrolled = 0;
        const errors: string[] = [];
        const enrollments: TestEnrollmentRef[] = [];
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

                // A bad email shouldn't drop the row, warn and continue
                // phone-only, so SMS/voice steps still get tested.
                let email: string | null = null;
                if (input.email?.trim()) {
                    email = normalizeEmail(input.email);
                    if (!email) {
                        errors.push(`${label}: invalid email "${input.email}", enrolled without it`);
                    }
                }

                let contactId: string;
                const { data: existing } = await supabase
                    .from("contacts")
                    .select("id, email")
                    .eq("client_id", clientId)
                    .eq("phone", phone)
                    .maybeSingle();

                if (existing?.id) {
                    contactId = existing.id;
                    // Merge policy matches upsertContactsFromRows: a new
                    // non-empty value wins, but we never null out an existing
                    // one just because this test row omitted it.
                    if (email && email !== existing.email) {
                        const { error: emailErr } = await supabase
                            .from("contacts")
                            .update({ email })
                            .eq("id", contactId);
                        if (emailErr) {
                            errors.push(
                                `${label}: couldn't update email, ${emailErr.message}`
                            );
                        }
                    }
                } else {
                    const { data: created, error: contactErr } = await supabase
                        .from("contacts")
                        .insert({
                            client_id: clientId,
                            phone,
                            name: input.name || null,
                            email,
                            custom_fields: { is_test_contact: true },
                            total_calls: 0,
                        })
                        .select("id")
                        .single();
                    if (contactErr || !created) {
                        errors.push(
                            `${label}: contact upsert failed, ${contactErr?.message || "unknown"}`
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
                    ...(email ? { email, contact_email: email } : {}),
                };
                if (input.name?.trim()) {
                    const [first, ...rest] = input.name.trim().split(/\s+/);
                    customVariables.first_name = first;
                    if (rest.length) customVariables.last_name = rest.join(" ");
                }

                // (sequence_id, contact_id) is unique, if a row already
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
                            `${label}: contact has status ${existingEnroll.status}, won't retest someone who already engaged`
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
                            `${label}: re-test reset failed, ${updateErr.message}`
                        );
                        continue;
                    }
                    enrolled++;
                    enrollments.push({
                        enrollmentId: existingEnroll.id,
                        contactId,
                        phone,
                        name: input.name?.trim() || undefined,
                    });
                    continue;
                }

                const { data: createdEnroll, error: enrollErr } = await supabase
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
                    })
                    .select("id")
                    .single();

                if (enrollErr || !createdEnroll) {
                    errors.push(`${label}: enroll failed, ${enrollErr?.message || "unknown"}`);
                    continue;
                }
                enrolled++;
                enrollments.push({
                    enrollmentId: createdEnroll.id,
                    contactId,
                    phone,
                    name: input.name?.trim() || undefined,
                });
            } catch (err: any) {
                errors.push(`${label}: ${err?.message || "unknown error"}`);
            }
        }

        revalidatePath(`/client/${clientId}/sequences/${sequenceId}`);
        return { success: true, data: { enrolled, errors, enrollments } };
    } catch (error: any) {
        console.error("enrollTestPhones error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Convert existing enrollments to test mode + fire immediately ───────────
// Used by the "Test now → From sequence" path. Picks live enrollments that
// were created by CSV upload (or any other source), flips is_test=true and
// schedules next_step_at=NOW() so the scheduler-worker dispatches them on
// the next 5s tick, bypassing pacing + business-hours + TCPA gates per
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
    data?: {
        converted: number;
        skipped: { id: string; reason: string }[];
        enrollmentIds: string[];
    };
}> {
    try {
        const access = await assertClientAccess(clientId);
        if (!access.ok) return { success: false, error: access.error };

        if (!enrollmentIds || enrollmentIds.length === 0) {
            return { success: false, error: "No enrollments selected" };
        }

        // Load + scope-check the rows up-front so we don't touch enrollments
        // outside this client.
        const { data: rows, error: readErr } = await supabase
            .from("sequence_enrollments")
            .select("id, status, tenant_id, sequence_id, is_test, contacts(custom_fields)")
            .in("id", enrollmentIds);

        if (readErr) {
            return { success: false, error: readErr.message };
        }

        const skipped: { id: string; reason: string }[] = [];
        const continuable: string[] = []; // active/paused, flip + reschedule
        const restartable: string[] = []; // completed/failed, reset to step 0
        let sequenceId: string | null = null;

        // Don't re-test contacts who already engaged, that would be spam.
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
                    reason: `status is ${row.status}, won't retest a contact who already engaged`,
                });
                continue;
            }
            // is_test is a permanent, one-way flag on the enrollment, and it
            // strips EVERY safety gate for that lead from then on: business
            // hours, TCPA, the calling window and days, the daily cap, the
            // contact fatigue guard, the VAPI worker's dial-time gate, and it
            // compresses every delay to 30s. Applying it to a real lead means
            // calling and texting a stranger repeatedly at any hour. Only
            // contacts explicitly created as test contacts may be converted.
            const isTestContact =
                ((row as any).contacts?.custom_fields as any)?.is_test_contact === true;
            if (!(row as any).is_test && !isTestContact) {
                skipped.push({
                    id: row.id,
                    reason:
                        "not a test contact. Converting a real lead to test mode would bypass business hours, TCPA, the calling window and the daily cap",
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
            return { success: true, data: { converted: 0, skipped, enrollmentIds: [] } };
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
                enrollmentIds: [...continuable, ...restartable],
            },
        };
    } catch (error: any) {
        console.error("convertEnrollmentsToTest error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Create sequence from Goal-First Wizard ──────────────────────────────────

/**
 * A short, readable default name from a free-text goal: the first sentence when
 * that is short enough, otherwise a word-boundary cut. Slicing at a fixed 50
 * characters used to leave names cut mid-word.
 */
function shortNameFromGoal(goal: string | null | undefined): string {
    const text = (goal || "").trim().replace(/\s+/g, " ");
    if (!text) return "Custom sequence";
    const firstSentence = text.split(/(?<=[.!?])\s/)[0];
    const base = firstSentence.length <= 60 ? firstSentence : text;
    const cut = base.length <= 60 ? base : base.slice(0, 60).replace(/\s+\S*$/, "");
    return cut.replace(/[.,;:\s]+$/, "") || "Custom sequence";
}

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
        name: "Meta Ads, New Lead",
        description: "Multi-channel outreach for leads captured by Meta Lead Ads",
        trigger_type: "meta_ads_lead",
        urgency_tier: "high",
    },
    google_ads_lead: {
        name: "Google Ads, New Lead",
        description: "Multi-channel outreach for leads captured by Google Lead Form Assets",
        trigger_type: "google_ads_lead",
        urgency_tier: "high",
    },
};

interface WizardInput {
    goal: string;
    customGoalDescription?: string;
    /** The outbound agent that voices calls and drives the SMS persona. Required. */
    agentId: string;
    channels: { sms: boolean; email: boolean; voice: boolean };
    /** Operator-chosen opening channel. null = the AI inferred it from the goal. */
    firstTouch?: "sms" | "email" | "voice" | null;
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
        // AI sequences act as the agent, an outbound agent binding is required.
        if (!input.agentId) {
            return { success: false, error: "An outbound agent is required. Deploy one from the Agents page first." };
        }
        const agentGate = await assertOutboundAgent(clientId, input.agentId);
        if (!agentGate.ok) return { success: false, error: agentGate.error };

        const meta = GOAL_TO_SEQUENCE_META[input.goal] || {
            name: shortNameFromGoal(input.customGoalDescription),
            description: input.customGoalDescription || "AI-powered custom outreach sequence",
            trigger_type: "manual",
            urgency_tier: "medium",
        };

        // Ad-platform triggers are mutually exclusive per client: only one
        // active sequence may listen to "meta_ads_lead" or "google_ads_lead"
        // at a time. If one already exists, deactivate it before activating
        // the new one, otherwise a single ad lead would fan out into
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

        // Intersect the user's channel picks with what the tenant can actually
        // send (Twilio subaccount / verified email account / voice agent) so the
        // AI is never offered a channel that would fail at dispatch. Voice is
        // agent-scoped, so a pick the bound agent can't honor fails LOUDLY
        // instead of being silently dropped.
        const capableChannels = await deriveAvailableChannels(clientId, input.agentId);
        const pickedChannels = Object.entries(input.channels)
            .filter(([, v]) => v)
            .map(([k]) => k);
        if (pickedChannels.includes("voice") && !capableChannels.includes("voice")) {
            return {
                success: false,
                error: "The selected agent has no voice assistant. Pick a voice-capable agent or turn off Voice Calls.",
            };
        }
        const enabledChannels = pickedChannels.filter((ch) =>
            capableChannels.includes(ch as (typeof capableChannels)[number])
        );
        if (enabledChannels.length === 0) {
            return {
                success: false,
                error: "None of the selected channels are configured for this account. Set up SMS, email, or a voice agent first.",
            };
        }

        const totalSteps = input.cadence * input.duration;

        // Build the sequence strategy (used by dynamic step generation)
        const sequenceStrategy = {
            goal: input.goal,
            custom_goal_description: input.customGoalDescription || null,
            available_channels: enabledChannels,
            // Which channel the operator pinned as the opener (null = AI decided
            // from the goal). Informational, the steps themselves already carry
            // the channel, but regeneration needs to know it was a deliberate pick.
            first_touch_channel:
                input.firstTouch && enabledChannels.includes(input.firstTouch)
                    ? input.firstTouch
                    : null,
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
                agent_id: input.agentId,
                // Agent-bound sequences get call-aware SMS auto-replies (same
                // default semantics as createSequenceCore's !!agentId).
                enable_chatbot_mode: true,
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

        // Insert step briefs as sequence_steps. Briefs for channels the tenant
        // can't send are dropped BEFORE numbering so no dead step rows are
        // pre-created (a filtered email row would dispatch into a failing queue).
        const capableBriefs = input.stepBriefs.filter((brief) =>
            enabledChannels.includes(brief.channel)
        );

        // Enforce the operator's first-touch pick. Until now it was a prompt
        // directive only: the briefs come from whatever timeline the model
        // returned, so if it opened on a different channel the pin was silently
        // lost and the campaign's first real touch went out on the wrong one , 
        // which is exactly how a calling campaign shipped as four SMS steps.
        // Reorder rather than rewrite: promoting an existing brief keeps its
        // intent and CTA intact, so nothing is fabricated.
        const pinned = input.firstTouch;
        if (pinned && capableBriefs.length > 1 && capableBriefs[0].channel !== pinned) {
            const idx = capableBriefs.findIndex((b) => b.channel === pinned);
            if (idx > 0) {
                const [promoted] = capableBriefs.splice(idx, 1);
                capableBriefs.unshift(promoted);
                console.warn(
                    `[WIZARD] Simulation opened on "${promoted.channel === pinned ? "?" : capableBriefs[1]?.channel}" despite a "${pinned}" first-touch pin, promoted the ${pinned} step to first.`
                );
            } else {
                console.warn(
                    `[WIZARD] First-touch pinned to "${pinned}" but the simulation produced no ${pinned} step; leaving the plan as generated.`
                );
            }
        }
        if (capableBriefs.length > 0) {
            const steps = capableBriefs.map((brief, idx) => {
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
                    // step_brief, without it, the placeholder content above
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
                // Sequence still created, steps failed, non-fatal for dynamic mode
            }
        }

        revalidatePath(`/client/${clientId}/sequences`);

        return { success: true, sequenceId: seq.id, replacedSequenceName };
    } catch (error: any) {
        console.error("createSequenceFromWizard error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Test-run pre-flight + post-flight
// ═══════════════════════════════════════════════════════════════════
//
// A test enrollment fires within ~5s but can silently do nothing: no Twilio
// account, no minutes, no VAPI slot, no email on the contact. These two
// actions make that visible instead of leaving the operator staring at a
// dialog that says "1 contact enrolled" while nothing arrives.

export type {
    TestChannel,
    PreflightIssue,
    TestPreflight,
    TestEventSeverity,
    TestRunEvent,
    TestRunEnrollment,
    TestRunStatus,
} from "@/lib/sequences/test-run-types";

import type {
    TestChannel,
    PreflightIssue,
    TestPreflight,
    TestEventSeverity,
    TestRunEvent,
    TestRunStatus,
} from "@/lib/sequences/test-run-types";

const TEST_CHANNELS: TestChannel[] = ["sms", "voice", "email"];

function isTestChannel(value: unknown): value is TestChannel {
    return value === "sms" || value === "voice" || value === "email";
}

/**
 * What will actually happen if the operator fires a test right now.
 */
export async function getSequenceTestPreflight(
    sequenceId: string,
    clientId: string
): Promise<{ success: boolean; error?: string; data?: TestPreflight }> {
    try {
        const access = await assertClientAccess(clientId);
        if (!access.ok) return { success: false, error: access.error };

        const { data: sequence, error: seqErr } = await supabase
            .from("sequences")
            .select("name, is_active, generation_mode, agent_id, sequence_strategy")
            .eq("id", sequenceId)
            .eq("client_id", clientId)
            .maybeSingle();

        if (seqErr) return { success: false, error: seqErr.message };
        if (!sequence) return { success: false, error: "Sequence not found" };

        const generationMode =
            sequence.generation_mode === "dynamic" ? "dynamic" : "static";

        // Which channels this sequence will try to use.
        let channels: TestChannel[] = [];
        let stepCount = 0;

        if (generationMode === "dynamic") {
            // NOTE: available_channels is a snapshot taken when the sequence
            // was created. It can be stale, the AI may be barred from a
            // channel that has since been provisioned (or vice versa). The
            // warnings below surface that drift rather than hiding it.
            const raw = (sequence.sequence_strategy as any)?.available_channels;
            channels = Array.isArray(raw) ? raw.filter(isTestChannel) : [];
            const { count } = await supabase
                .from("sequence_steps")
                .select("id", { count: "exact", head: true })
                .eq("sequence_id", sequenceId);
            stepCount = count ?? 0;
        } else {
            // enrollment_id IS NULL filters out per-enrollment JIT rows.
            const { data: steps } = await supabase
                .from("sequence_steps")
                .select("channel")
                .eq("sequence_id", sequenceId)
                .is("enrollment_id", null);
            const rows = steps || [];
            stepCount = rows.length;
            channels = TEST_CHANNELS.filter((ch) =>
                rows.some((s) => s.channel === ch)
            );
        }

        const readiness = await getChannelCapabilities(clientId, sequence.agent_id);

        const blockers: PreflightIssue[] = [];
        const warnings: PreflightIssue[] = [];

        if (stepCount === 0) {
            blockers.push({
                kind: "sequence",
                title: "No steps",
                detail: "This sequence has no steps, so a test would do nothing.",
            });
        }

        // Voice needs minutes on top of provisioning.
        let voiceBlockedByBilling = false;
        if (channels.includes("voice")) {
            const callAccess = await canPlaceCall(clientId);
            if (!callAccess.allowed) {
                voiceBlockedByBilling = true;
                blockers.push({
                    kind: "billing",
                    title:
                        callAccess.reason === "no_minutes"
                            ? "No voice minutes"
                            : "Calling paused",
                    detail:
                        callAccess.reason === "no_minutes"
                            ? "You have 0 voice minutes left, so calls in this sequence won't be placed."
                            : "This client's subscription isn't active, so calls won't be placed.",
                    fixHref: `/client/${clientId}/billing`,
                    fixLabel:
                        callAccess.reason === "no_minutes" ? "Add minutes" : "View billing",
                });
            }
        }

        // Per-channel readiness, with two diagnoses the generic reasons can't express.
        for (const ch of channels) {
            const state = readiness[ch];
            if (state.ready) continue;

            let detail = state.reason || `${ch} is not configured.`;
            let fixHref: string | undefined = `/client/${clientId}/phone-numbers`;
            let fixLabel: string | undefined = "Configure";

            if (ch === "sms") {
                const { data: twilio } = await supabase
                    .from("tenant_twilio_accounts")
                    .select(
                        "account_type, subaccount_sid, external_account_sid, messaging_service_sid"
                    )
                    .eq("client_id", clientId)
                    .eq("status", "active")
                    .maybeSingle();

                if (
                    twilio?.account_type === "type_a_byoa" &&
                    twilio.external_account_sid &&
                    !twilio.subaccount_sid
                ) {
                    detail =
                        "Your Twilio account is connected as BYOA. If SMS still doesn't send, the sequencer may not have picked up the BYOA fix yet.";
                } else if (!twilio?.messaging_service_sid) {
                    // The sequencer needs a number whose purpose is 'sequencer'.
                    // Assigning a tenant's only number to an agent flips it to
                    // 'dedicated' and silently kills SMS.
                    const { data: anyActive } = await supabase
                        .from("tenant_phone_numbers")
                        .select("id, purpose")
                        .eq("client_id", clientId)
                        .eq("status", "active");
                    const active = anyActive || [];
                    if (
                        active.length > 0 &&
                        !active.some((p) => p.purpose === "sequencer")
                    ) {
                        detail =
                            "Your phone numbers are all assigned to agents, so the sequencer has no number to text from.";
                    }
                }
            } else if (ch === "email") {
                fixHref = `/client/${clientId}/settings/integrations`;
                fixLabel = "Set up email";
            } else if (ch === "voice") {
                if (voiceBlockedByBilling) continue; // already reported above
                fixHref = `/client/${clientId}/agents`;
                fixLabel = "Check agent";
            }

            const issue: PreflightIssue = {
                kind: ch,
                title: `${ch === "sms" ? "SMS" : ch === "voice" ? "Voice" : "Email"} not ready`,
                detail,
                fixHref,
                fixLabel,
            };

            // If EVERY channel is dead nothing can fire, that's a blocker.
            // Otherwise the test still exercises the working channels.
            const allDead = channels.every((c) => !readiness[c].ready);
            (allDead ? blockers : warnings).push(issue);
        }

        if (!sequence.is_active) {
            // Test enrollments still fire, the scheduler gates on enrollment
            // status, not sequences.is_active, so this is informational.
            warnings.push({
                kind: "sequence",
                title: "Sequence is inactive",
                detail:
                    "Test enrollments still run, but no real leads will enter this sequence.",
            });
        }

        return {
            success: true,
            data: {
                sequenceName: sequence.name,
                isActive: !!sequence.is_active,
                generationMode,
                stepCount,
                channels,
                readiness,
                blockers,
                warnings,
            },
        };
    } catch (error: any) {
        console.error("getSequenceTestPreflight error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

const TERMINAL_STATUSES = new Set([
    "completed",
    "failed",
    "replied",
    "booked",
    "converted",
    "manual_stop",
    "unenrolled",
]);

/** Map an execution-log row onto something an operator can act on. */
function explainEvent(
    action: string,
    channel: TestChannel | null,
    providerId: string | null,
    providerResponse: any,
    clientId: string
): { severity: TestEventSeverity; explanation: string; fixHref?: string; fixLabel?: string } {
    const reason =
        typeof providerResponse?.reason === "string" ? providerResponse.reason : null;

    switch (action) {
        case "sent":
            if (channel === "sms") {
                return {
                    severity: "ok",
                    explanation: providerId
                        ? `SMS sent, Twilio SID ${providerId}`
                        : "SMS sent",
                };
            }
            return { severity: "ok", explanation: "Email sent" };
        case "sending":
            return { severity: "pending", explanation: "Email queued for delivery" };
        case "call_initiated":
            return {
                severity: "ok",
                explanation: providerId
                    ? `Call placed, VAPI call ${providerId}`
                    : "Call placed",
            };
        case "failed":
            return {
                severity: "error",
                explanation: reason ? `Send failed: ${reason}` : "Send failed",
            };
        case "skipped_no_access":
            return {
                severity: "error",
                explanation:
                    reason === "no_minutes"
                        ? "Call blocked: you have 0 voice minutes left."
                        : `Call blocked: ${reason || "no access"}`,
                fixHref: `/client/${clientId}/billing`,
                fixLabel: "Add minutes",
            };
        case "skipped_capacity":
            return {
                severity: "warn",
                explanation:
                    "No free VAPI call slot after 3 retries. The call was dropped, try again in a minute.",
            };
        case "skipped_opt_out":
            return {
                severity: "warn",
                explanation: "Contact is opted out, so nothing was sent.",
            };
        case "skipped":
            return {
                severity: "warn",
                explanation: reason || "Step skipped",
            };
        case "blocked_placeholder":
            return {
                severity: "error",
                explanation:
                    "Step content still had unrendered {{variables}}, so nothing was sent.",
            };
        case "blocked_empty_body":
            return {
                severity: "error",
                explanation: "Step content was empty, so nothing was sent.",
            };
        default:
            return {
                severity: "pending",
                explanation: reason ? `${action}: ${reason}` : action,
            };
    }
}

/**
 * Poll target for the post-flight panel: what has actually happened to these
 * test enrollments so far.
 */
export async function getTestRunStatus(
    enrollmentIds: string[],
    clientId: string
): Promise<{ success: boolean; error?: string; data?: TestRunStatus }> {
    try {
        const access = await assertClientAccess(clientId);
        if (!access.ok) return { success: false, error: access.error };

        if (!enrollmentIds || enrollmentIds.length === 0) {
            return { success: true, data: { enrollments: [], events: [], settled: true } };
        }

        const { data: rows, error: rowErr } = await supabase
            .from("sequence_enrollments")
            .select(
                "id, status, current_step_order, next_step_at, tenant_id, contacts(name, phone, email)"
            )
            .in("id", enrollmentIds);

        if (rowErr) return { success: false, error: rowErr.message };

        // Service-role client bypasses RLS, scope explicitly.
        const scoped = (rows || []).filter((r: any) => r.tenant_id === clientId);
        const scopedIds = scoped.map((r: any) => r.id);

        if (scopedIds.length === 0) {
            return { success: true, data: { enrollments: [], events: [], settled: true } };
        }

        const { data: logs, error: logErr } = await supabase
            .from("sequence_execution_log")
            .select(
                "id, enrollment_id, channel, action, provider_id, provider_response, executed_at, sequence_steps(step_order)"
            )
            .in("enrollment_id", scopedIds)
            .order("executed_at", { ascending: true });

        if (logErr) return { success: false, error: logErr.message };

        const events: TestRunEvent[] = (logs || []).map((row: any) => {
            const channel = isTestChannel(row.channel) ? row.channel : null;
            const { severity, explanation, fixHref, fixLabel } = explainEvent(
                row.action,
                channel,
                row.provider_id ?? null,
                row.provider_response,
                clientId
            );
            return {
                id: row.id,
                enrollmentId: row.enrollment_id,
                channel,
                action: row.action,
                severity,
                explanation,
                executedAt: row.executed_at,
                stepOrder: row.sequence_steps?.step_order ?? null,
                fixHref,
                fixLabel,
            };
        });

        return {
            success: true,
            data: {
                enrollments: scoped.map((r: any) => ({
                    enrollmentId: r.id,
                    status: r.status,
                    currentStepOrder: r.current_step_order,
                    nextStepAt: r.next_step_at,
                    contactName: r.contacts?.name ?? null,
                    contactPhone: r.contacts?.phone ?? null,
                    contactEmail: r.contacts?.email ?? null,
                })),
                events,
                settled: scoped.every((r: any) => TERMINAL_STATUSES.has(r.status)),
            },
        };
    } catch (error: any) {
        console.error("getTestRunStatus error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
