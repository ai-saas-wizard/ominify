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

        // Phase 3: Mutation settings
        const enable_ai_mutation = formData.get("enable_ai_mutation") === "true";
        const mutation_instructions = formData.get("mutation_instructions") as string;

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
                enable_ai_mutation,
                mutation_instructions: mutation_instructions || null,
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

        // Phase 3: Enrich with mutation data for this enrollment
        let mutations: any[] = [];
        // Phase 4: Enrich with healing data for this enrollment
        let healings: any[] = [];

        if (data && data.length > 0) {
            const [mutResult, healResult] = await Promise.all([
                supabase
                    .from("step_mutations")
                    .select("*")
                    .eq("enrollment_id", enrollmentId),
                supabase
                    .from("healing_log")
                    .select("*")
                    .eq("enrollment_id", enrollmentId),
            ]);
            mutations = mutResult.data || [];
            healings = healResult.data || [];
        }

        // Attach mutation + healing info to matching log entries
        const enrichedData = (data || []).map((log: any) => {
            const mutation = mutations.find(
                (m: any) => m.step_id === log.step_id
            );
            const healing = healings.find(
                (h: any) => h.step_id === log.step_id
            );
            return {
                ...log,
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
            .eq("tenant_id", clientId)
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
            .eq("sequence_id", sequenceId);

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
