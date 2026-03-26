"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

// ─── Default stages seeded on first pipeline visit ──────────────────────────

const DEFAULT_STAGES = [
    { position: 0, name: "New Lead",   color: "#059669", is_default: true,  is_terminal: false },
    { position: 1, name: "Contacted",  color: "#3b82f6", is_default: false, is_terminal: false },
    { position: 2, name: "Engaged",    color: "#10b981", is_default: false, is_terminal: false },
    { position: 3, name: "Qualified",  color: "#f59e0b", is_default: false, is_terminal: false },
    { position: 4, name: "Booked",     color: "#10b981", is_default: false, is_terminal: true  },
    { position: 5, name: "Lost",       color: "#ef4444", is_default: false, is_terminal: true  },
];

// ─── Ensure pipeline stages exist (idempotent) ─────────────────────────────

export async function ensurePipelineStages(clientId: string) {
    try {
        const { data: existing, error: checkError } = await supabase
            .from("pipeline_stages")
            .select("id")
            .eq("client_id", clientId)
            .limit(1);

        if (checkError) {
            console.error("ensurePipelineStages check error:", checkError);
            return { success: false, error: checkError.message };
        }

        if (existing && existing.length > 0) {
            return { success: true, seeded: false };
        }

        const rows = DEFAULT_STAGES.map((s) => ({ ...s, client_id: clientId }));
        const { error: insertError } = await supabase
            .from("pipeline_stages")
            .insert(rows);

        if (insertError) {
            console.error("ensurePipelineStages insert error:", insertError);
            return { success: false, error: insertError.message };
        }

        return { success: true, seeded: true };
    } catch (error: any) {
        console.error("ensurePipelineStages error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Get pipeline data (stages + contacts) ──────────────────────────────────

export async function getPipelineData(clientId: string) {
    try {
        // Fetch stages
        const { data: stages, error: stagesError } = await supabase
            .from("pipeline_stages")
            .select("*")
            .eq("client_id", clientId)
            .order("position", { ascending: true });

        if (stagesError) {
            console.error("getPipelineData stages error:", stagesError);
            return { success: false, error: stagesError.message, stages: [], contacts: [] };
        }

        // Fetch contacts — simple query, no joins that could fail
        const { data: contacts, error: contactsError } = await supabase
            .from("contacts")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (contactsError) {
            console.error("getPipelineData contacts error:", contactsError);
            return { success: false, error: contactsError.message, stages: stages || [], contacts: [] };
        }

        console.log(`[PIPELINE] Found ${(contacts || []).length} contacts for client ${clientId}`);

        // Fetch enrollments separately to avoid join failures
        const contactIds = (contacts || []).map((c: any) => c.id);
        let enrollmentMap: Record<string, any> = {};

        if (contactIds.length > 0) {
            const { data: enrollments } = await supabase
                .from("sequence_enrollments")
                .select("id, contact_id, status, enrollment_source, sequences(name)")
                .in("contact_id", contactIds)
                .order("enrolled_at", { ascending: false });

            // Build map: contact_id → most recent enrollment
            for (const e of enrollments || []) {
                if (!enrollmentMap[e.contact_id]) {
                    enrollmentMap[e.contact_id] = e;
                }
            }
        }

        // Transform
        const transformedContacts = (contacts || []).map((c: any) => {
            const enrollment = enrollmentMap[c.id] || null;
            return {
                id: c.id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                pipeline_stage_id: c.pipeline_stage_id || null,
                pipeline_stage_moved_by: c.pipeline_stage_moved_by || null,
                engagement_score: c.engagement_score ?? null,
                sentiment_trend: c.sentiment_trend ?? null,
                conversation_summary: c.conversation_summary || null,
                last_call_at: c.last_call_at || null,
                total_calls: c.total_calls || 0,
                custom_fields: c.custom_fields || {},
                created_at: c.created_at,
                enrollment: enrollment
                    ? {
                        id: enrollment.id,
                        status: enrollment.status,
                        source: enrollment.enrollment_source,
                        sequence_name: enrollment.sequences?.name || null,
                    }
                    : null,
            };
        });

        return { success: true, stages: stages || [], contacts: transformedContacts };
    } catch (error: any) {
        console.error("getPipelineData error:", error);
        return { success: false, error: error?.message || "Internal error", stages: [], contacts: [] };
    }
}

// ─── Move contact to a pipeline stage ───────────────────────────────────────

export async function moveContactToStage(
    contactId: string,
    stageId: string,
    movedBy: "auto" | "user"
) {
    try {
        const { error } = await supabase
            .from("contacts")
            .update({
                pipeline_stage_id: stageId,
                pipeline_stage_moved_at: new Date().toISOString(),
                pipeline_stage_moved_by: movedBy,
            })
            .eq("id", contactId);

        if (error) {
            console.error("moveContactToStage error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("moveContactToStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Auto-advance contact stage (forward only, respects manual moves) ───────

export async function autoAdvanceContactStage(
    contactId: string,
    clientId: string,
    targetStageName: string
) {
    try {
        // Get current contact stage info
        const { data: contact, error: contactError } = await supabase
            .from("contacts")
            .select("pipeline_stage_id, pipeline_stage_moved_by")
            .eq("id", contactId)
            .single();

        if (contactError) {
            console.error("autoAdvanceContactStage contact error:", contactError);
            return { success: false, error: contactError.message };
        }

        // If user manually moved, skip auto-advance
        if (contact?.pipeline_stage_moved_by === "user") {
            return { success: true, skipped: true, reason: "manual_move" };
        }

        // Get all stages for this client
        const { data: stages, error: stagesError } = await supabase
            .from("pipeline_stages")
            .select("id, name, position, is_default")
            .eq("client_id", clientId)
            .order("position", { ascending: true });

        if (stagesError || !stages) {
            console.error("autoAdvanceContactStage stages error:", stagesError);
            return { success: false, error: stagesError?.message || "No stages found" };
        }

        const targetStage = stages.find((s) => s.name === targetStageName);
        if (!targetStage) {
            return { success: false, error: `Stage "${targetStageName}" not found` };
        }

        // If contact has no stage, always set it
        if (!contact?.pipeline_stage_id) {
            return await moveContactToStage(contactId, targetStage.id, "auto");
        }

        // Find current stage position
        const currentStage = stages.find((s) => s.id === contact.pipeline_stage_id);
        if (!currentStage) {
            // Stage was deleted, set to target
            return await moveContactToStage(contactId, targetStage.id, "auto");
        }

        // Only advance forward (never backward)
        if (targetStage.position > currentStage.position) {
            return await moveContactToStage(contactId, targetStage.id, "auto");
        }

        return { success: true, skipped: true, reason: "already_ahead" };
    } catch (error: any) {
        console.error("autoAdvanceContactStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Create a custom pipeline stage ─────────────────────────────────────────

export async function createPipelineStage(
    clientId: string,
    name: string,
    color: string
) {
    try {
        // Get max position
        const { data: maxStage } = await supabase
            .from("pipeline_stages")
            .select("position")
            .eq("client_id", clientId)
            .order("position", { ascending: false })
            .limit(1)
            .single();

        const nextPosition = (maxStage?.position ?? -1) + 1;

        const { data, error } = await supabase
            .from("pipeline_stages")
            .insert({
                client_id: clientId,
                name,
                color,
                position: nextPosition,
                is_default: false,
                is_terminal: false,
            })
            .select()
            .single();

        if (error) {
            console.error("createPipelineStage error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true, data };
    } catch (error: any) {
        console.error("createPipelineStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Update a pipeline stage ────────────────────────────────────────────────

export async function updatePipelineStage(
    stageId: string,
    updates: { name?: string; color?: string; position?: number }
) {
    try {
        const { error } = await supabase
            .from("pipeline_stages")
            .update(updates)
            .eq("id", stageId);

        if (error) {
            console.error("updatePipelineStage error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("updatePipelineStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Delete a pipeline stage (moves contacts to default first) ──────────────

export async function deletePipelineStage(stageId: string, clientId: string) {
    try {
        // Find the default stage
        const { data: defaultStage } = await supabase
            .from("pipeline_stages")
            .select("id")
            .eq("client_id", clientId)
            .eq("is_default", true)
            .single();

        if (!defaultStage) {
            return { success: false, error: "No default stage found" };
        }

        if (defaultStage.id === stageId) {
            return { success: false, error: "Cannot delete the default stage" };
        }

        // Move all contacts from this stage to default
        await supabase
            .from("contacts")
            .update({
                pipeline_stage_id: defaultStage.id,
                pipeline_stage_moved_at: new Date().toISOString(),
                pipeline_stage_moved_by: "auto",
            })
            .eq("pipeline_stage_id", stageId);

        // Delete the stage
        const { error } = await supabase
            .from("pipeline_stages")
            .delete()
            .eq("id", stageId);

        if (error) {
            console.error("deletePipelineStage error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true };
    } catch (error: any) {
        console.error("deletePipelineStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ─── Reorder pipeline stages ────────────────────────────────────────────────

export async function reorderPipelineStages(
    clientId: string,
    orderedStageIds: string[]
) {
    try {
        // Batch update positions
        const updates = orderedStageIds.map((id, index) =>
            supabase
                .from("pipeline_stages")
                .update({ position: index })
                .eq("id", id)
                .eq("client_id", clientId)
        );

        await Promise.all(updates);

        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true };
    } catch (error: any) {
        console.error("reorderPipelineStages error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
