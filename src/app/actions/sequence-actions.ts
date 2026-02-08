"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

// ─── List all sequences for a client ───────────────────────────────────────────

export async function getSequences(clientId: string) {
    try {
        const { data, error } = await supabase
            .from("sequences")
            .select(`
                *,
                sequence_steps(id),
                sequence_enrollments(id, status)
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("getSequences error:", error);
            return { success: false, error: error.message, data: [] };
        }

        const sequences = (data || []).map((seq: any) => ({
            ...seq,
            step_count: seq.sequence_steps?.length || 0,
            enrolled_count: seq.sequence_enrollments?.filter(
                (e: any) => e.status === "active" || e.status === "paused"
            ).length || 0,
            completed_count: seq.sequence_enrollments?.filter(
                (e: any) => e.status === "completed" || e.status === "booked"
            ).length || 0,
            total_enrolled: seq.sequence_enrollments?.length || 0,
            sequence_steps: undefined,
            sequence_enrollments: undefined,
        }));

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
                sequence_enrollments(id, status, current_step_order, enrolled_at, contact_id, contacts(id, name, phone, email))
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

        // Compute enrollment stats
        const enrollments = sequence?.sequence_enrollments || [];
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

export async function createSequence(clientId: string, formData: FormData) {
    try {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const trigger_type = formData.get("trigger_type") as string;
        const urgency_tier = formData.get("urgency_tier") as string;
        const trigger_conditions = formData.get("trigger_conditions") as string;

        if (!name) {
            return { success: false, error: "Sequence name is required" };
        }

        let parsedConditions = null;
        if (trigger_conditions) {
            try {
                parsedConditions = JSON.parse(trigger_conditions);
            } catch {
                return { success: false, error: "Invalid JSON in trigger conditions" };
            }
        }

        const { data, error } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name,
                description: description || null,
                trigger_type: trigger_type || "manual",
                urgency_tier: urgency_tier || "medium",
                trigger_conditions: parsedConditions,
                is_active: false,
            })
            .select("id")
            .single();

        if (error) {
            console.error("createSequence error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: data?.id };
    } catch (error) {
        console.error("createSequence error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Update a sequence ─────────────────────────────────────────────────────────

export async function updateSequence(sequenceId: string, formData: FormData) {
    try {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const trigger_type = formData.get("trigger_type") as string;
        const urgency_tier = formData.get("urgency_tier") as string;
        const trigger_conditions = formData.get("trigger_conditions") as string;

        const updates: Record<string, any> = {};
        if (name) updates.name = name;
        if (description !== null) updates.description = description || null;
        if (trigger_type) updates.trigger_type = trigger_type;
        if (urgency_tier) updates.urgency_tier = urgency_tier;

        if (trigger_conditions) {
            try {
                updates.trigger_conditions = JSON.parse(trigger_conditions);
            } catch {
                return { success: false, error: "Invalid JSON in trigger conditions" };
            }
        }

        const { error } = await supabase
            .from("sequences")
            .update(updates)
            .eq("id", sequenceId);

        if (error) {
            console.error("updateSequence error:", error);
            return { success: false, error: error.message };
        }

        // Get client_id for revalidation
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences`);
            revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }

        return { success: true };
    } catch (error) {
        console.error("updateSequence error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Toggle sequence active/inactive ───────────────────────────────────────────

export async function toggleSequenceActive(sequenceId: string, isActive: boolean) {
    try {
        const { error } = await supabase
            .from("sequences")
            .update({ is_active: isActive })
            .eq("id", sequenceId);

        if (error) {
            console.error("toggleSequenceActive error:", error);
            return { success: false, error: error.message };
        }

        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences`);
            revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }

        return { success: true };
    } catch (error) {
        console.error("toggleSequenceActive error:", error);
        return { success: false, error: "Internal error" };
    }
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
    try {
        const channel = formData.get("channel") as string;
        const delay_minutes = parseInt(formData.get("delay_minutes") as string) || 0;
        const delay_type = formData.get("delay_type") as string;
        const content_template = formData.get("content_template") as string;
        const skip_conditions = formData.get("skip_conditions") as string;
        const on_success = formData.get("on_success") as string;
        const on_failure = formData.get("on_failure") as string;

        if (!channel) {
            return { success: false, error: "Channel is required" };
        }

        let parsedTemplate = null;
        if (content_template) {
            try {
                parsedTemplate = JSON.parse(content_template);
            } catch {
                return { success: false, error: "Invalid JSON in content template" };
            }
        }

        let parsedSkip = null;
        if (skip_conditions) {
            try {
                parsedSkip = JSON.parse(skip_conditions);
            } catch {
                return { success: false, error: "Invalid JSON in skip conditions" };
            }
        }

        let parsedOnSuccess = null;
        if (on_success) {
            try {
                parsedOnSuccess = JSON.parse(on_success);
            } catch {
                parsedOnSuccess = { action: on_success };
            }
        }

        let parsedOnFailure = null;
        if (on_failure) {
            try {
                parsedOnFailure = JSON.parse(on_failure);
            } catch {
                parsedOnFailure = { action: on_failure };
            }
        }

        // Get current max step_order
        const { data: existingSteps } = await supabase
            .from("sequence_steps")
            .select("step_order")
            .eq("sequence_id", sequenceId)
            .order("step_order", { ascending: false })
            .limit(1);

        const nextOrder = existingSteps && existingSteps.length > 0
            ? existingSteps[0].step_order + 1
            : 1;

        const { data, error } = await supabase
            .from("sequence_steps")
            .insert({
                sequence_id: sequenceId,
                step_order: nextOrder,
                channel,
                delay_minutes,
                delay_type: delay_type || "fixed_delay",
                content_template: parsedTemplate,
                skip_conditions: parsedSkip,
                on_success: parsedOnSuccess,
                on_failure: parsedOnFailure,
            })
            .select("id")
            .single();

        if (error) {
            console.error("addSequenceStep error:", error);
            return { success: false, error: error.message };
        }

        // Revalidate
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();

        if (seq) {
            revalidatePath(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }

        return { success: true, stepId: data?.id };
    } catch (error) {
        console.error("addSequenceStep error:", error);
        return { success: false, error: "Internal error" };
    }
}

// ─── Update a sequence step ────────────────────────────────────────────────────

export async function updateSequenceStep(stepId: string, formData: FormData) {
    try {
        const channel = formData.get("channel") as string;
        const delay_minutes = formData.get("delay_minutes") as string;
        const delay_type = formData.get("delay_type") as string;
        const content_template = formData.get("content_template") as string;
        const skip_conditions = formData.get("skip_conditions") as string;
        const on_success = formData.get("on_success") as string;
        const on_failure = formData.get("on_failure") as string;

        const updates: Record<string, any> = {};
        if (channel) updates.channel = channel;
        if (delay_minutes !== null) updates.delay_minutes = parseInt(delay_minutes) || 0;
        if (delay_type) updates.delay_type = delay_type;

        if (content_template) {
            try {
                updates.content_template = JSON.parse(content_template);
            } catch {
                return { success: false, error: "Invalid JSON in content template" };
            }
        }

        if (skip_conditions) {
            try {
                updates.skip_conditions = JSON.parse(skip_conditions);
            } catch {
                return { success: false, error: "Invalid JSON in skip conditions" };
            }
        }

        if (on_success) {
            try {
                updates.on_success = JSON.parse(on_success);
            } catch {
                updates.on_success = { action: on_success };
            }
        }

        if (on_failure) {
            try {
                updates.on_failure = JSON.parse(on_failure);
            } catch {
                updates.on_failure = { action: on_failure };
            }
        }

        const { error } = await supabase
            .from("sequence_steps")
            .update(updates)
            .eq("id", stepId);

        if (error) {
            console.error("updateSequenceStep error:", error);
            return { success: false, error: error.message };
        }

        // Revalidate
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
        console.error("updateSequenceStep error:", error);
        return { success: false, error: "Internal error" };
    }
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
                client_id: clientId,
                status: "active",
                current_step_order: 1,
                source: source || "manual",
                enrolled_at: new Date().toISOString(),
            })
            .select("id")
            .single();

        if (error) {
            console.error("enrollContact error:", error);
            return { success: false, error: error.message };
        }

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
            .select("sequence_id, client_id")
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
                `/client/${enrollment.client_id}/sequences/${enrollment.sequence_id}`
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

// ─── Get execution log for an enrollment ───────────────────────────────────────

export async function getExecutionLog(enrollmentId: string) {
    try {
        const { data, error } = await supabase
            .from("sequence_execution_log")
            .select(`
                *,
                sequence_steps(step_order, channel, content_template)
            `)
            .eq("enrollment_id", enrollmentId)
            .order("executed_at", { ascending: true });

        if (error) {
            console.error("getExecutionLog error:", error);
            return { success: false, error: error.message, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("getExecutionLog error:", error);
        return { success: false, error: "Internal error", data: [] };
    }
}
