"use server";

import { supabase } from "@/lib/supabase";
import { evaluateConditions } from "@/lib/pipeline-rule-evaluator";
import { assignContactToPipeline } from "@/app/actions/pipeline-actions";
import type { PipelineStageRule, PipelineAssignmentRule } from "@/types/pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// STAGE RULES — auto-enroll contacts in sequences when entering a stage
// ═══════════════════════════════════════════════════════════════════════════

export async function getStageRules(stageId: string): Promise<{
    success: boolean;
    rules: PipelineStageRule[];
    error?: string;
}> {
    try {
        const { data, error } = await supabase
            .from("pipeline_stage_rules")
            .select("*, sequences(name)")
            .eq("stage_id", stageId)
            .order("priority", { ascending: false });

        if (error) {
            console.error("getStageRules error:", error);
            return { success: false, rules: [], error: error.message };
        }

        const rules: PipelineStageRule[] = (data || []).map((r: any) => ({
            id: r.id,
            stage_id: r.stage_id,
            sequence_id: r.sequence_id,
            sequence_name: r.sequences?.name || null,
            conditions: r.conditions || {},
            priority: r.priority,
            is_active: r.is_active,
            created_at: r.created_at,
        }));

        return { success: true, rules };
    } catch (error: any) {
        console.error("getStageRules error:", error);
        return { success: false, rules: [], error: error?.message || "Internal error" };
    }
}

export async function createStageRule(
    stageId: string,
    sequenceId: string,
    conditions: Record<string, any>,
    priority: number = 0
) {
    try {
        const { data, error } = await supabase
            .from("pipeline_stage_rules")
            .insert({
                stage_id: stageId,
                sequence_id: sequenceId,
                conditions,
                priority,
                is_active: true,
            })
            .select("*, sequences(name)")
            .single();

        if (error) {
            console.error("createStageRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error("createStageRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function updateStageRule(
    ruleId: string,
    updates: { conditions?: Record<string, any>; priority?: number; is_active?: boolean; sequence_id?: string }
) {
    try {
        const { error } = await supabase
            .from("pipeline_stage_rules")
            .update(updates)
            .eq("id", ruleId);

        if (error) {
            console.error("updateStageRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("updateStageRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function deleteStageRule(ruleId: string) {
    try {
        const { error } = await supabase
            .from("pipeline_stage_rules")
            .delete()
            .eq("id", ruleId);

        if (error) {
            console.error("deleteStageRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("deleteStageRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

/**
 * Evaluate stage rules for a contact that just entered a stage.
 * Fetches active rules for the stage, evaluates conditions against the contact,
 * and enrolls in matching sequences.
 */
export async function evaluateStageRules(
    contactId: string,
    stageId: string,
    clientId: string
) {
    try {
        // Fetch active rules for the stage
        const { data: rules } = await supabase
            .from("pipeline_stage_rules")
            .select("*")
            .eq("stage_id", stageId)
            .eq("is_active", true)
            .order("priority", { ascending: false });

        if (!rules || rules.length === 0) {
            return { success: true, enrolled: [] };
        }

        // Fetch contact data for condition evaluation
        const { data: contact } = await supabase
            .from("contacts")
            .select("*")
            .eq("id", contactId)
            .single();

        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

        // Fetch most recent enrollment source
        const { data: enrollment } = await supabase
            .from("sequence_enrollments")
            .select("enrollment_source")
            .eq("contact_id", contactId)
            .order("enrolled_at", { ascending: false })
            .limit(1)
            .single();

        const contactData = {
            ...contact,
            enrollment_source: enrollment?.enrollment_source || null,
        };

        const enrolled: string[] = [];

        for (const rule of rules) {
            if (!evaluateConditions(contactData, rule.conditions || {})) {
                continue;
            }

            // Check if already enrolled in this sequence
            const { data: existingEnrollment } = await supabase
                .from("sequence_enrollments")
                .select("id")
                .eq("contact_id", contactId)
                .eq("sequence_id", rule.sequence_id)
                .in("status", ["active", "paused"])
                .limit(1);

            if (existingEnrollment && existingEnrollment.length > 0) {
                continue; // Already enrolled
            }

            // Enroll the contact
            const { error: enrollError } = await supabase
                .from("sequence_enrollments")
                .insert({
                    tenant_id: clientId,
                    sequence_id: rule.sequence_id,
                    contact_id: contactId,
                    status: "active",
                    current_step_order: 1,
                    next_step_at: new Date().toISOString(),
                    enrollment_source: contactData.enrollment_source || "auto_trigger",
                });

            if (!enrollError) {
                enrolled.push(rule.sequence_id);
            }
        }

        return { success: true, enrolled };
    } catch (error: any) {
        console.error("evaluateStageRules error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSIGNMENT RULES — auto-route contacts to pipelines
// ═══════════════════════════════════════════════════════════════════════════

export async function getAssignmentRules(pipelineId: string): Promise<{
    success: boolean;
    rules: PipelineAssignmentRule[];
    error?: string;
}> {
    try {
        const { data, error } = await supabase
            .from("pipeline_assignment_rules")
            .select("*")
            .eq("pipeline_id", pipelineId)
            .order("priority", { ascending: false });

        if (error) {
            console.error("getAssignmentRules error:", error);
            return { success: false, rules: [], error: error.message };
        }

        return { success: true, rules: data || [] };
    } catch (error: any) {
        console.error("getAssignmentRules error:", error);
        return { success: false, rules: [], error: error?.message || "Internal error" };
    }
}

export async function createAssignmentRule(
    pipelineId: string,
    conditions: Record<string, any>,
    priority: number = 0
) {
    try {
        const { data, error } = await supabase
            .from("pipeline_assignment_rules")
            .insert({
                pipeline_id: pipelineId,
                conditions,
                priority,
                is_active: true,
            })
            .select()
            .single();

        if (error) {
            console.error("createAssignmentRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error("createAssignmentRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function updateAssignmentRule(
    ruleId: string,
    updates: { conditions?: Record<string, any>; priority?: number; is_active?: boolean }
) {
    try {
        const { error } = await supabase
            .from("pipeline_assignment_rules")
            .update(updates)
            .eq("id", ruleId);

        if (error) {
            console.error("updateAssignmentRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("updateAssignmentRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function deleteAssignmentRule(ruleId: string) {
    try {
        const { error } = await supabase
            .from("pipeline_assignment_rules")
            .delete()
            .eq("id", ruleId);

        if (error) {
            console.error("deleteAssignmentRule error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("deleteAssignmentRule error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

/**
 * Evaluate all assignment rules for a client and assign contact to matching pipelines.
 * Returns the pipelines the contact was assigned to.
 */
export async function evaluateAndAssignPipelines(
    contactId: string,
    clientId: string,
    source?: string
) {
    try {
        // Fetch all active assignment rules for client's pipelines
        const { data: pipelines } = await supabase
            .from("pipelines")
            .select("id")
            .eq("client_id", clientId);

        if (!pipelines || pipelines.length === 0) {
            return { success: true, assigned: [] };
        }

        const pipelineIds = pipelines.map((p: any) => p.id);

        const { data: rules } = await supabase
            .from("pipeline_assignment_rules")
            .select("*")
            .in("pipeline_id", pipelineIds)
            .eq("is_active", true)
            .order("priority", { ascending: false });

        if (!rules || rules.length === 0) {
            // No rules — assign to default pipeline
            const { data: defaultPipeline } = await supabase
                .from("pipelines")
                .select("id")
                .eq("client_id", clientId)
                .eq("is_default", true)
                .single();

            if (defaultPipeline) {
                await assignContactToPipeline(contactId, defaultPipeline.id);
                return { success: true, assigned: [defaultPipeline.id] };
            }
            return { success: true, assigned: [] };
        }

        // Fetch contact data
        const { data: contact } = await supabase
            .from("contacts")
            .select("*")
            .eq("id", contactId)
            .single();

        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

        const contactData = { ...contact, enrollment_source: source || null };

        const assigned: string[] = [];

        for (const rule of rules) {
            if (evaluateConditions(contactData, rule.conditions || {})) {
                const result = await assignContactToPipeline(contactId, rule.pipeline_id);
                if (result.success) {
                    assigned.push(rule.pipeline_id);
                }
            }
        }

        // If no rules matched, assign to default
        if (assigned.length === 0) {
            const { data: defaultPipeline } = await supabase
                .from("pipelines")
                .select("id")
                .eq("client_id", clientId)
                .eq("is_default", true)
                .single();

            if (defaultPipeline) {
                await assignContactToPipeline(contactId, defaultPipeline.id);
                assigned.push(defaultPipeline.id);
            }
        }

        return { success: true, assigned };
    } catch (error: any) {
        console.error("evaluateAndAssignPipelines error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-PIPELINE AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function getAutomations(clientId: string) {
    try {
        const { data, error } = await supabase
            .from("pipeline_automations")
            .select(`
                *,
                trigger_pipeline:pipelines!pipeline_automations_trigger_pipeline_id_fkey(name),
                trigger_stage:pipeline_stages!pipeline_automations_trigger_stage_id_fkey(name),
                target_pipeline:pipelines!pipeline_automations_target_pipeline_id_fkey(name),
                target_stage:pipeline_stages!pipeline_automations_target_stage_id_fkey(name)
            `)
            .eq("client_id", clientId);

        if (error) {
            // Fallback to simple query if joins fail
            const { data: simpleData, error: simpleError } = await supabase
                .from("pipeline_automations")
                .select("*")
                .eq("client_id", clientId);

            if (simpleError) {
                return { success: false, automations: [], error: simpleError.message };
            }
            return { success: true, automations: simpleData || [] };
        }

        const automations = (data || []).map((a: any) => ({
            ...a,
            trigger_pipeline_name: a.trigger_pipeline?.name || null,
            trigger_stage_name: a.trigger_stage?.name || null,
            target_pipeline_name: a.target_pipeline?.name || null,
            target_stage_name: a.target_stage?.name || null,
        }));

        return { success: true, automations };
    } catch (error: any) {
        console.error("getAutomations error:", error);
        return { success: false, automations: [], error: error?.message || "Internal error" };
    }
}

export async function createAutomation(
    clientId: string,
    triggerPipelineId: string,
    triggerStageId: string,
    targetPipelineId: string,
    targetStageId?: string
) {
    try {
        const { data, error } = await supabase
            .from("pipeline_automations")
            .insert({
                client_id: clientId,
                trigger_pipeline_id: triggerPipelineId,
                trigger_stage_id: triggerStageId,
                target_pipeline_id: targetPipelineId,
                target_stage_id: targetStageId || null,
                is_active: true,
            })
            .select()
            .single();

        if (error) {
            console.error("createAutomation error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error("createAutomation error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function updateAutomation(
    automationId: string,
    updates: { is_active?: boolean; target_stage_id?: string }
) {
    try {
        const { error } = await supabase
            .from("pipeline_automations")
            .update(updates)
            .eq("id", automationId);

        if (error) {
            console.error("updateAutomation error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("updateAutomation error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

export async function deleteAutomation(automationId: string) {
    try {
        const { error } = await supabase
            .from("pipeline_automations")
            .delete()
            .eq("id", automationId);

        if (error) {
            console.error("deleteAutomation error:", error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error("deleteAutomation error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}

/**
 * Check and fire automations when a contact reaches a stage.
 * Called from moveContactToStage.
 */
export async function fireAutomations(contactId: string, stageId: string) {
    try {
        const { data: automations } = await supabase
            .from("pipeline_automations")
            .select("*")
            .eq("trigger_stage_id", stageId)
            .eq("is_active", true);

        if (!automations || automations.length === 0) {
            return { success: true, fired: [] };
        }

        const fired: string[] = [];

        for (const auto of automations) {
            const result = await assignContactToPipeline(
                contactId,
                auto.target_pipeline_id,
                auto.target_stage_id || undefined
            );
            if (result.success) {
                fired.push(auto.id);
            }
        }

        return { success: true, fired };
    } catch (error: any) {
        console.error("fireAutomations error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
