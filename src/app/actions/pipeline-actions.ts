"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import type { Pipeline, PipelineStage, PipelineContact } from "@/types/pipeline";

// ─── Default stages seeded when creating a new pipeline ───────────────────

const DEFAULT_STAGES = [
    { position: 0, name: "New Lead",   color: "#059669", is_default: true,  is_terminal: false },
    { position: 1, name: "Contacted",  color: "#3b82f6", is_default: false, is_terminal: false },
    { position: 2, name: "Engaged",    color: "#10b981", is_default: false, is_terminal: false },
    { position: 3, name: "Qualified",  color: "#f59e0b", is_default: false, is_terminal: false },
    { position: 4, name: "Booked",     color: "#10b981", is_default: false, is_terminal: true  },
    { position: 5, name: "Lost",       color: "#ef4444", is_default: false, is_terminal: true  },
];

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE CRUD
// ═══════════════════════════════════════════════════════════════════════════

export async function ensureDefaultPipeline(clientId: string) {
    try {
        const { data: existing } = await supabase
            .from("pipelines")
            .select("id")
            .eq("client_id", clientId)
            .limit(1);

        if (existing && existing.length > 0) {
            return { success: true, seeded: false };
        }

        // Create default pipeline
        const { data: pipeline, error: pipelineError } = await supabase
            .from("pipelines")
            .insert({
                client_id: clientId,
                name: "Sales Pipeline",
                color: "#059669",
                is_default: true,
                position: 0,
            })
            .select()
            .single();

        if (pipelineError || !pipeline) {
            console.error("ensureDefaultPipeline pipeline error:", pipelineError);
            return { success: false, error: pipelineError?.message || "Failed to create pipeline" };
        }

        // Seed stages for the pipeline
        const rows = DEFAULT_STAGES.map((s) => ({
            ...s,
            client_id: clientId,
            pipeline_id: pipeline.id,
        }));
        const { error: stagesError } = await supabase
            .from("pipeline_stages")
            .insert(rows);

        if (stagesError) {
            console.error("ensureDefaultPipeline stages error:", stagesError);
            return { success: false, error: stagesError.message };
        }

        return { success: true, seeded: true, pipelineId: pipeline.id };
    } catch (error: any) {
        console.error("ensureDefaultPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function getPipelines(clientId: string): Promise<{
    success: boolean;
    pipelines: (Pipeline & { contact_count: number })[];
    error?: string;
}> {
    try {
        const { data: pipelines, error } = await supabase
            .from("pipelines")
            .select("*")
            .eq("client_id", clientId)
            .order("position", { ascending: true });

        if (error) {
            console.error("getPipelines error:", error);
            return { success: false, pipelines: [], error: error.message };
        }

        // Get contact counts per pipeline
        const pipelineIds = (pipelines || []).map((p: any) => p.id);
        let countMap: Record<string, number> = {};

        if (pipelineIds.length > 0) {
            const { data: counts } = await supabase
                .from("pipeline_contacts")
                .select("pipeline_id")
                .in("pipeline_id", pipelineIds);

            for (const row of counts || []) {
                countMap[row.pipeline_id] = (countMap[row.pipeline_id] || 0) + 1;
            }
        }

        const result = (pipelines || []).map((p: any) => ({
            ...p,
            contact_count: countMap[p.id] || 0,
        }));

        return { success: true, pipelines: result };
    } catch (error: any) {
        console.error("getPipelines error:", error);
        return { success: false, pipelines: [], error: error?.message || "Internal error" };
    }
}

export async function createPipeline(
    clientId: string,
    name: string,
    description?: string,
    color?: string,
    copyFromPipelineId?: string
) {
    try {
        // Get max position
        const { data: maxPipeline } = await supabase
            .from("pipelines")
            .select("position")
            .eq("client_id", clientId)
            .order("position", { ascending: false })
            .limit(1)
            .single();

        const nextPosition = (maxPipeline?.position ?? -1) + 1;

        // Check if this is the first pipeline
        const { data: existingPipelines } = await supabase
            .from("pipelines")
            .select("id")
            .eq("client_id", clientId)
            .limit(1);

        const isFirst = !existingPipelines || existingPipelines.length === 0;

        const { data: pipeline, error } = await supabase
            .from("pipelines")
            .insert({
                client_id: clientId,
                name,
                description: description || null,
                color: color || "#059669",
                is_default: isFirst,
                position: nextPosition,
            })
            .select()
            .single();

        if (error || !pipeline) {
            console.error("createPipeline error:", error);
            return { success: false, error: error?.message || "Failed to create pipeline" };
        }

        // Seed stages — either copy from existing or use defaults
        let stagesToCreate = DEFAULT_STAGES;

        if (copyFromPipelineId) {
            const { data: sourceStages } = await supabase
                .from("pipeline_stages")
                .select("name, color, position, is_default, is_terminal")
                .eq("pipeline_id", copyFromPipelineId)
                .order("position", { ascending: true });

            if (sourceStages && sourceStages.length > 0) {
                stagesToCreate = sourceStages;
            }
        }

        const rows = stagesToCreate.map((s) => ({
            ...s,
            client_id: clientId,
            pipeline_id: pipeline.id,
        }));

        const { error: stagesError } = await supabase
            .from("pipeline_stages")
            .insert(rows);

        if (stagesError) {
            console.error("createPipeline stages error:", stagesError);
        }

        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true, data: pipeline };
    } catch (error: any) {
        console.error("createPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function updatePipeline(
    pipelineId: string,
    updates: { name?: string; description?: string; color?: string }
) {
    try {
        const { error } = await supabase
            .from("pipelines")
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq("id", pipelineId);

        if (error) {
            console.error("updatePipeline error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("updatePipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function deletePipeline(pipelineId: string, clientId: string) {
    try {
        // Cannot delete default pipeline
        const { data: pipeline } = await supabase
            .from("pipelines")
            .select("is_default")
            .eq("id", pipelineId)
            .single();

        if (pipeline?.is_default) {
            return { success: false, error: "Cannot delete the default pipeline" };
        }

        // Cascade handles pipeline_contacts, stages, rules, etc.
        const { error } = await supabase
            .from("pipelines")
            .delete()
            .eq("id", pipelineId);

        if (error) {
            console.error("deletePipeline error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true };
    } catch (error: any) {
        console.error("deletePipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function reorderPipelines(clientId: string, orderedPipelineIds: string[]) {
    try {
        const updates = orderedPipelineIds.map((id, index) =>
            supabase
                .from("pipelines")
                .update({ position: index })
                .eq("id", id)
                .eq("client_id", clientId)
        );
        await Promise.all(updates);
        revalidatePath(`/client/${clientId}/pipeline`);
        return { success: true };
    } catch (error: any) {
        console.error("reorderPipelines error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE DATA (stages + contacts for a specific pipeline)
// ═══════════════════════════════════════════════════════════════════════════

export async function getPipelineData(clientId: string, pipelineId: string) {
    try {
        // Fetch stages for this pipeline
        const { data: stages, error: stagesError } = await supabase
            .from("pipeline_stages")
            .select("*")
            .eq("pipeline_id", pipelineId)
            .order("position", { ascending: true });

        if (stagesError) {
            console.error("getPipelineData stages error:", stagesError);
            return { success: false, error: stagesError.message, stages: [], contacts: [] };
        }

        // Fetch pipeline_contacts joined with contacts
        const { data: pipelineContacts, error: pcError } = await supabase
            .from("pipeline_contacts")
            .select("id, stage_id, moved_at, moved_by, contact_id, contacts(*)")
            .eq("pipeline_id", pipelineId);

        if (pcError) {
            console.error("getPipelineData contacts error:", pcError);
            return { success: false, error: pcError.message, stages: stages || [], contacts: [] };
        }

        const contactIds = (pipelineContacts || []).map((pc: any) => pc.contact_id);
        let enrollmentMap: Record<string, any> = {};

        if (contactIds.length > 0) {
            const { data: enrollments } = await supabase
                .from("sequence_enrollments")
                .select("id, contact_id, status, enrollment_source, sequences(name)")
                .in("contact_id", contactIds)
                .order("enrolled_at", { ascending: false });

            for (const e of enrollments || []) {
                if (!enrollmentMap[e.contact_id]) {
                    enrollmentMap[e.contact_id] = e;
                }
            }
        }

        // Transform to PipelineContact shape
        const transformedContacts: PipelineContact[] = (pipelineContacts || []).map((pc: any) => {
            const c = pc.contacts;
            if (!c) return null;
            const enrollment = enrollmentMap[c.id] || null;
            return {
                id: c.id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                pipeline_contact_id: pc.id,
                stage_id: pc.stage_id || null,
                moved_at: pc.moved_at || null,
                moved_by: pc.moved_by || null,
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
        }).filter(Boolean) as PipelineContact[];

        return { success: true, stages: stages || [], contacts: transformedContacts };
    } catch (error: any) {
        console.error("getPipelineData error:", error);
        return { success: false, error: error?.message || "Internal error", stages: [], contacts: [] };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT ↔ PIPELINE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function moveContactToStage(
    contactId: string,
    pipelineId: string,
    stageId: string,
    movedBy: "auto" | "user"
) {
    try {
        // Get current stage for history tracking
        const { data: currentPc } = await supabase
            .from("pipeline_contacts")
            .select("id, stage_id")
            .eq("pipeline_id", pipelineId)
            .eq("contact_id", contactId)
            .single();

        const now = new Date().toISOString();

        if (currentPc) {
            // Update existing pipeline_contacts row
            const { error } = await supabase
                .from("pipeline_contacts")
                .update({
                    stage_id: stageId,
                    moved_at: now,
                    moved_by: movedBy,
                })
                .eq("id", currentPc.id);

            if (error) {
                console.error("moveContactToStage error:", error);
                return { success: false, error: error.message };
            }

            // Record history
            await supabase.from("pipeline_contact_history").insert({
                pipeline_contact_id: currentPc.id,
                from_stage_id: currentPc.stage_id,
                to_stage_id: stageId,
                moved_by: movedBy,
                moved_at: now,
            });
        } else {
            // Contact not in this pipeline yet — insert
            const { data: newPc, error } = await supabase
                .from("pipeline_contacts")
                .insert({
                    pipeline_id: pipelineId,
                    contact_id: contactId,
                    stage_id: stageId,
                    moved_at: now,
                    moved_by: movedBy,
                })
                .select("id")
                .single();

            if (error) {
                console.error("moveContactToStage insert error:", error);
                return { success: false, error: error.message };
            }

            if (newPc) {
                await supabase.from("pipeline_contact_history").insert({
                    pipeline_contact_id: newPc.id,
                    from_stage_id: null,
                    to_stage_id: stageId,
                    moved_by: movedBy,
                    moved_at: now,
                });
            }
        }

        // Backward compat: also update contacts.pipeline_stage_id for default pipeline
        const { data: pipeline } = await supabase
            .from("pipelines")
            .select("is_default")
            .eq("id", pipelineId)
            .single();

        if (pipeline?.is_default) {
            await supabase
                .from("contacts")
                .update({
                    pipeline_stage_id: stageId,
                    pipeline_stage_moved_at: now,
                    pipeline_stage_moved_by: movedBy,
                })
                .eq("id", contactId);
        }

        return { success: true };
    } catch (error: any) {
        console.error("moveContactToStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function autoAdvanceContactStage(
    contactId: string,
    clientId: string,
    targetStageName: string,
    pipelineId?: string
) {
    try {
        // If pipelineId given, advance in that pipeline only; otherwise advance in ALL
        let pipelineIds: string[] = [];

        if (pipelineId) {
            pipelineIds = [pipelineId];
        } else {
            // Get all pipelines this contact belongs to
            const { data: pcs } = await supabase
                .from("pipeline_contacts")
                .select("pipeline_id")
                .eq("contact_id", contactId);

            if (!pcs || pcs.length === 0) {
                // Contact not in any pipeline — try to assign to default
                const { data: defaultPipeline } = await supabase
                    .from("pipelines")
                    .select("id")
                    .eq("client_id", clientId)
                    .eq("is_default", true)
                    .single();

                if (defaultPipeline) {
                    pipelineIds = [defaultPipeline.id];
                } else {
                    return { success: true, skipped: true, reason: "no_pipeline" };
                }
            } else {
                pipelineIds = pcs.map((pc: any) => pc.pipeline_id);
            }
        }

        const results = [];

        for (const pid of pipelineIds) {
            // Get pipeline_contact row
            const { data: pc } = await supabase
                .from("pipeline_contacts")
                .select("id, stage_id, moved_by")
                .eq("pipeline_id", pid)
                .eq("contact_id", contactId)
                .single();

            // If user manually moved, skip auto-advance
            if (pc?.moved_by === "user") {
                results.push({ pipelineId: pid, skipped: true, reason: "manual_move" });
                continue;
            }

            // Get all stages for this pipeline
            const { data: stages } = await supabase
                .from("pipeline_stages")
                .select("id, name, position, is_default")
                .eq("pipeline_id", pid)
                .order("position", { ascending: true });

            if (!stages || stages.length === 0) {
                results.push({ pipelineId: pid, skipped: true, reason: "no_stages" });
                continue;
            }

            const targetStage = stages.find((s: any) => s.name === targetStageName);
            if (!targetStage) {
                results.push({ pipelineId: pid, skipped: true, reason: "stage_not_found" });
                continue;
            }

            // No existing pipeline_contact — create one at target stage
            if (!pc) {
                await moveContactToStage(contactId, pid, targetStage.id, "auto");
                results.push({ pipelineId: pid, advanced: true });
                continue;
            }

            // No current stage — set to target
            if (!pc.stage_id) {
                await moveContactToStage(contactId, pid, targetStage.id, "auto");
                results.push({ pipelineId: pid, advanced: true });
                continue;
            }

            // Forward-only check
            const currentStage = stages.find((s: any) => s.id === pc.stage_id);
            if (!currentStage) {
                await moveContactToStage(contactId, pid, targetStage.id, "auto");
                results.push({ pipelineId: pid, advanced: true });
                continue;
            }

            if (targetStage.position > currentStage.position) {
                await moveContactToStage(contactId, pid, targetStage.id, "auto");
                results.push({ pipelineId: pid, advanced: true });
            } else {
                results.push({ pipelineId: pid, skipped: true, reason: "already_ahead" });
            }
        }

        return { success: true, results };
    } catch (error: any) {
        console.error("autoAdvanceContactStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function assignContactToPipeline(
    contactId: string,
    pipelineId: string,
    stageId?: string
) {
    try {
        // If no stageId, use the default stage
        let targetStageId = stageId;
        if (!targetStageId) {
            const { data: defaultStage } = await supabase
                .from("pipeline_stages")
                .select("id")
                .eq("pipeline_id", pipelineId)
                .eq("is_default", true)
                .single();

            targetStageId = defaultStage?.id;

            if (!targetStageId) {
                // Fallback: first stage by position
                const { data: firstStage } = await supabase
                    .from("pipeline_stages")
                    .select("id")
                    .eq("pipeline_id", pipelineId)
                    .order("position", { ascending: true })
                    .limit(1)
                    .single();
                targetStageId = firstStage?.id;
            }
        }

        if (!targetStageId) {
            return { success: false, error: "No stages found in pipeline" };
        }

        const { data, error } = await supabase
            .from("pipeline_contacts")
            .upsert(
                {
                    pipeline_id: pipelineId,
                    contact_id: contactId,
                    stage_id: targetStageId,
                    moved_at: new Date().toISOString(),
                    moved_by: "auto",
                },
                { onConflict: "pipeline_id,contact_id" }
            )
            .select("id")
            .single();

        if (error) {
            console.error("assignContactToPipeline error:", error);
            return { success: false, error: error.message };
        }

        // Record history
        if (data) {
            await supabase.from("pipeline_contact_history").insert({
                pipeline_contact_id: data.id,
                from_stage_id: null,
                to_stage_id: targetStageId,
                moved_by: "auto",
            });
        }

        return { success: true, stageId: targetStageId };
    } catch (error: any) {
        console.error("assignContactToPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function removeContactFromPipeline(contactId: string, pipelineId: string) {
    try {
        const { error } = await supabase
            .from("pipeline_contacts")
            .delete()
            .eq("pipeline_id", pipelineId)
            .eq("contact_id", contactId);

        if (error) {
            console.error("removeContactFromPipeline error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("removeContactFromPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function bulkMoveContactsToStage(
    contactIds: string[],
    pipelineId: string,
    stageId: string
) {
    try {
        const now = new Date().toISOString();

        // Get current pipeline_contacts for history
        const { data: currentPcs } = await supabase
            .from("pipeline_contacts")
            .select("id, contact_id, stage_id")
            .eq("pipeline_id", pipelineId)
            .in("contact_id", contactIds);

        // Batch update
        const { error } = await supabase
            .from("pipeline_contacts")
            .update({
                stage_id: stageId,
                moved_at: now,
                moved_by: "user",
            })
            .eq("pipeline_id", pipelineId)
            .in("contact_id", contactIds);

        if (error) {
            console.error("bulkMoveContactsToStage error:", error);
            return { success: false, error: error.message };
        }

        // Record history for each
        if (currentPcs && currentPcs.length > 0) {
            const historyRows = currentPcs.map((pc: any) => ({
                pipeline_contact_id: pc.id,
                from_stage_id: pc.stage_id,
                to_stage_id: stageId,
                moved_by: "user",
                moved_at: now,
            }));
            await supabase.from("pipeline_contact_history").insert(historyRows);
        }

        return { success: true, count: contactIds.length };
    } catch (error: any) {
        console.error("bulkMoveContactsToStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function bulkAssignToPipeline(
    contactIds: string[],
    pipelineId: string,
    stageId?: string
) {
    try {
        let targetStageId = stageId;
        if (!targetStageId) {
            const { data: defaultStage } = await supabase
                .from("pipeline_stages")
                .select("id")
                .eq("pipeline_id", pipelineId)
                .eq("is_default", true)
                .single();
            targetStageId = defaultStage?.id;
        }

        if (!targetStageId) {
            return { success: false, error: "No stages found in pipeline" };
        }

        const rows = contactIds.map((contactId) => ({
            pipeline_id: pipelineId,
            contact_id: contactId,
            stage_id: targetStageId,
            moved_at: new Date().toISOString(),
            moved_by: "user" as const,
        }));

        const { error } = await supabase
            .from("pipeline_contacts")
            .upsert(rows, { onConflict: "pipeline_id,contact_id" });

        if (error) {
            console.error("bulkAssignToPipeline error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, count: contactIds.length };
    } catch (error: any) {
        console.error("bulkAssignToPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function bulkRemoveFromPipeline(contactIds: string[], pipelineId: string) {
    try {
        const { error } = await supabase
            .from("pipeline_contacts")
            .delete()
            .eq("pipeline_id", pipelineId)
            .in("contact_id", contactIds);

        if (error) {
            console.error("bulkRemoveFromPipeline error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, count: contactIds.length };
    } catch (error: any) {
        console.error("bulkRemoveFromPipeline error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE CRUD (pipeline-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export async function createPipelineStage(
    pipelineId: string,
    name: string,
    color: string
) {
    try {
        // Get pipeline's client_id for revalidation
        const { data: pipeline } = await supabase
            .from("pipelines")
            .select("client_id")
            .eq("id", pipelineId)
            .single();

        // Get max position within this pipeline
        const { data: maxStage } = await supabase
            .from("pipeline_stages")
            .select("position")
            .eq("pipeline_id", pipelineId)
            .order("position", { ascending: false })
            .limit(1)
            .single();

        const nextPosition = (maxStage?.position ?? -1) + 1;

        const { data, error } = await supabase
            .from("pipeline_stages")
            .insert({
                client_id: pipeline?.client_id,
                pipeline_id: pipelineId,
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

        if (pipeline?.client_id) {
            revalidatePath(`/client/${pipeline.client_id}/pipeline`);
        }
        return { success: true, data };
    } catch (error: any) {
        console.error("createPipelineStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

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

export async function deletePipelineStage(stageId: string, pipelineId: string) {
    try {
        // Find the default stage for this pipeline
        const { data: defaultStage } = await supabase
            .from("pipeline_stages")
            .select("id")
            .eq("pipeline_id", pipelineId)
            .eq("is_default", true)
            .single();

        if (!defaultStage) {
            return { success: false, error: "No default stage found" };
        }

        if (defaultStage.id === stageId) {
            return { success: false, error: "Cannot delete the default stage" };
        }

        // Move pipeline_contacts from this stage to default
        await supabase
            .from("pipeline_contacts")
            .update({
                stage_id: defaultStage.id,
                moved_at: new Date().toISOString(),
                moved_by: "auto",
            })
            .eq("stage_id", stageId);

        // Delete the stage
        const { error } = await supabase
            .from("pipeline_stages")
            .delete()
            .eq("id", stageId);

        if (error) {
            console.error("deletePipelineStage error:", error);
            return { success: false, error: error.message };
        }

        // Get client_id for revalidation
        const { data: pipeline } = await supabase
            .from("pipelines")
            .select("client_id")
            .eq("id", pipelineId)
            .single();

        if (pipeline?.client_id) {
            revalidatePath(`/client/${pipeline.client_id}/pipeline`);
        }
        return { success: true };
    } catch (error: any) {
        console.error("deletePipelineStage error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function reorderPipelineStages(
    pipelineId: string,
    orderedStageIds: string[]
) {
    try {
        const updates = orderedStageIds.map((id, index) =>
            supabase
                .from("pipeline_stages")
                .update({ position: index })
                .eq("id", id)
                .eq("pipeline_id", pipelineId)
        );
        await Promise.all(updates);

        const { data: pipeline } = await supabase
            .from("pipelines")
            .select("client_id")
            .eq("id", pipelineId)
            .single();

        if (pipeline?.client_id) {
            revalidatePath(`/client/${pipeline.client_id}/pipeline`);
        }
        return { success: true };
    } catch (error: any) {
        console.error("reorderPipelineStages error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
