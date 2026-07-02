import "server-only";
import { supabase } from "@/lib/supabase";
import { deriveAvailableChannels } from "@/lib/channels/capabilities";
import type {
    CoreOpts,
    CoreResult,
    CreateSequenceInput,
    StepInput,
    UpdateSequenceInput,
    UpdateStepInput,
} from "./types";

/**
 * Canonical sequence/step write logic, extracted from the FormData server
 * actions in src/app/actions/sequence-actions.ts so BOTH the dashboard
 * (server actions, which parse FormData then delegate here) and the internal
 * MCP/admin HTTP routes (which pass typed JSON) share one implementation.
 *
 * These functions take plain typed inputs and never import next/cache — the
 * caller injects revalidatePath via opts.revalidate when UI cache-busting is
 * wanted. Behavior is intended to be byte-identical to the original actions.
 */

/**
 * Gate: a bound agent must exist, belong to the client, and be
 * outbound-capable (an inbound-only receptionist can't run sequences).
 */
export async function assertOutboundAgent(
    clientId: string,
    agentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const { data: agent } = await supabase
        .from("agents")
        .select("agent_type")
        .eq("id", agentId)
        .eq("client_id", clientId)
        .single();
    if (!agent) return { ok: false, error: "Selected agent not found" };
    if (agent.agent_type !== "outbound") {
        return {
            ok: false,
            error: "Selected agent is inbound-only. Outbound sequences require an outbound agent.",
        };
    }
    return { ok: true };
}

/**
 * Gate: step authoring is only allowed on static sequences. Dynamic sequences'
 * steps are generated per lead by the AI — hand-editing them would corrupt
 * per-enrollment histories. Enforced here (not just in the UI) so the MCP
 * route and stale clients can't write either.
 */
export async function assertSequenceEditable(
    sequenceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const { data: seq } = await supabase
        .from("sequences")
        .select("generation_mode")
        .eq("id", sequenceId)
        .single();
    if (!seq) return { ok: false, error: "Sequence not found" };
    if (seq.generation_mode === "dynamic") {
        return {
            ok: false,
            error: "This sequence is AI-managed; its steps are generated per lead and cannot be edited.",
        };
    }
    return { ok: true };
}

function defaultMutationInstructions(channel: string): string | null {
    switch (channel) {
        case "sms":
            return "Keep under 160 chars. Reference prior conversation naturally. Match brand voice.";
        case "email":
            return "Reference prior interactions in the opening. Address known objections. Keep professional tone.";
        case "voice":
            return "Adjust opening based on prior calls. Reference any objections or topics discussed.";
        default:
            return null;
    }
}

export async function createSequenceCore(
    clientId: string,
    input: CreateSequenceInput,
    opts?: CoreOpts
): Promise<CoreResult> {
    try {
        const name = input.name;
        if (!name) return { success: false, error: "Sequence name is required" };

        // Gate: if an agent is bound, it must be outbound-capable.
        if (input.agentId) {
            const gate = await assertOutboundAgent(clientId, input.agentId);
            if (!gate.ok) return { success: false, error: gate.error };
        }

        // AI-first default: new sequences are dynamic (the AI decides channel/
        // content/timing per lead) unless the caller explicitly asks for static.
        const generation_mode = input.generation_mode || "dynamic";
        if (generation_mode === "dynamic" && !input.agentId) {
            return {
                success: false,
                error: "AI sequences require an outbound agent. Deploy one from the Agents page, or pass generation_mode: \"static\" for a manual sequence.",
            };
        }

        const max_touchpoints = input.max_touchpoints || 8;
        const description = input.description ?? null;

        let sequence_strategy: Record<string, any> | null = null;
        if (generation_mode === "dynamic") {
            // Offer the AI only channels this tenant can actually send on.
            const available_channels = await deriveAvailableChannels(
                clientId,
                input.agentId
            );
            if (available_channels.length === 0) {
                return {
                    success: false,
                    error: "No outreach channels are configured. Set up SMS, email, or a voice agent first.",
                };
            }
            sequence_strategy = {
                goal: description || "Follow up with lead",
                max_steps: max_touchpoints,
                available_channels,
                agent_context: name,
            };
        }

        // Default the call-aware SMS auto-reply chatbot ON when an outbound
        // agent is bound (the agent's SMS persona + shared context drive
        // replies); honor an explicit input override either way.
        const enable_chatbot_mode =
            input.enable_chatbot_mode ?? !!input.agentId;

        const { data, error } = await supabase
            .from("sequences")
            .insert({
                client_id: clientId,
                name,
                description: description || null,
                trigger_type: input.trigger_type || "manual",
                urgency_tier: input.urgency_tier || "medium",
                trigger_conditions: input.trigger_conditions ?? null,
                is_active: false,
                agent_id: input.agentId || null,
                generation_mode,
                enable_chatbot_mode,
                // AI-first: the adaptive-mutation master switch is on unless the
                // caller opts out (sequence-mutator honors per-step flags too).
                enable_adaptive_mutation: input.enable_adaptive_mutation ?? true,
                sequence_strategy,
            })
            .select("id")
            .single();

        if (error) {
            console.error("createSequenceCore error:", error);
            return { success: false, error: error.message };
        }

        opts?.revalidate?.(`/client/${clientId}/sequences`);
        return { success: true, sequenceId: data?.id };
    } catch (e: any) {
        console.error("createSequenceCore error:", e);
        return { success: false, error: "Internal error" };
    }
}

export async function updateSequenceCore(
    sequenceId: string,
    input: UpdateSequenceInput,
    opts?: CoreOpts
): Promise<CoreResult> {
    try {
        const updates: Record<string, any> = {};
        if (input.name) updates.name = input.name;
        // null/"" → set to null; undefined → leave untouched (matches old action).
        if (input.description !== null && input.description !== undefined)
            updates.description = input.description || null;
        if (input.trigger_type) updates.trigger_type = input.trigger_type;
        if (input.urgency_tier) updates.urgency_tier = input.urgency_tier;
        if (input.trigger_conditions !== undefined && input.trigger_conditions !== null)
            updates.trigger_conditions = input.trigger_conditions;
        // Re-bind / unbind the outbound agent (drives voice + SMS at runtime).
        if (input.agentId !== undefined) {
            const { data: seqRow } = await supabase
                .from("sequences")
                .select("client_id, generation_mode")
                .eq("id", sequenceId)
                .single();
            if (input.agentId) {
                // Gate: a bound agent must be outbound-capable. Scope the lookup
                // to the sequence's client so you can't bind another tenant's agent.
                const gate = await assertOutboundAgent(
                    seqRow?.client_id || "",
                    input.agentId
                );
                if (!gate.ok) return { success: false, error: gate.error };
            } else if (seqRow?.generation_mode === "dynamic") {
                // Mirror the create-time invariant: AI sequences act as an agent.
                return {
                    success: false,
                    error: "AI sequences require an outbound agent — bind a different agent instead of unassigning.",
                };
            }
            updates.agent_id = input.agentId || null;
        }

        const { error } = await supabase
            .from("sequences")
            .update(updates)
            .eq("id", sequenceId);
        if (error) {
            console.error("updateSequenceCore error:", error);
            return { success: false, error: error.message };
        }

        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();
        if (seq) {
            opts?.revalidate?.(`/client/${seq.client_id}/sequences`);
            opts?.revalidate?.(`/client/${seq.client_id}/sequences/${sequenceId}`);
        }
        return { success: true };
    } catch (e: any) {
        console.error("updateSequenceCore error:", e);
        return { success: false, error: "Internal error" };
    }
}

export async function addSequenceStepCore(
    sequenceId: string,
    input: StepInput,
    opts?: CoreOpts
): Promise<CoreResult> {
    try {
        if (!input.channel) return { success: false, error: "Channel is required" };

        const editable = await assertSequenceEditable(sequenceId);
        if (!editable.ok) return { success: false, error: editable.error };

        const { data: existingSteps } = await supabase
            .from("sequence_steps")
            .select("step_order")
            .eq("sequence_id", sequenceId)
            .order("step_order", { ascending: false })
            .limit(1);

        const nextOrder =
            existingSteps && existingSteps.length > 0
                ? existingSteps[0].step_order + 1
                : 1;

        const enableMutation = input.enable_ai_mutation ?? true;

        const { data, error } = await supabase
            .from("sequence_steps")
            .insert({
                sequence_id: sequenceId,
                step_order: nextOrder,
                channel: input.channel,
                delay_minutes: input.delay_minutes ?? 0,
                content: input.content ?? null,
                skip_conditions: input.skip_conditions ?? null,
                enable_ai_mutation: enableMutation,
                mutation_instructions:
                    input.mutation_instructions ||
                    defaultMutationInstructions(input.channel),
            })
            .select("id")
            .single();

        if (error) {
            console.error("addSequenceStepCore error:", error);
            return { success: false, error: error.message };
        }

        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();
        if (seq) opts?.revalidate?.(`/client/${seq.client_id}/sequences/${sequenceId}`);

        return { success: true, stepId: data?.id };
    } catch (e: any) {
        console.error("addSequenceStepCore error:", e);
        return { success: false, error: "Internal error" };
    }
}

export async function updateSequenceStepCore(
    stepId: string,
    input: UpdateStepInput,
    opts?: CoreOpts
): Promise<CoreResult> {
    try {
        // Resolve the step's sequence BEFORE writing so AI-managed sequences
        // and per-lead generated rows can't be hand-edited.
        const { data: step } = await supabase
            .from("sequence_steps")
            .select("sequence_id, enrollment_id, generated_dynamically, sequences(client_id, generation_mode)")
            .eq("id", stepId)
            .single();
        if (!step) return { success: false, error: "Step not found" };
        if (step.enrollment_id || step.generated_dynamically) {
            return {
                success: false,
                error: "This step was generated by the AI for a specific lead and cannot be edited.",
            };
        }
        if ((step.sequences as any)?.generation_mode === "dynamic") {
            return {
                success: false,
                error: "This sequence is AI-managed; its steps are generated per lead and cannot be edited.",
            };
        }

        const updates: Record<string, any> = {};
        if (input.channel) updates.channel = input.channel;
        if (input.delay_minutes !== undefined)
            updates.delay_minutes = input.delay_minutes ?? 0;
        if (input.content !== undefined) updates.content = input.content;
        if (input.skip_conditions !== undefined)
            updates.skip_conditions = input.skip_conditions;
        if (input.enable_ai_mutation !== undefined)
            updates.enable_ai_mutation = input.enable_ai_mutation;
        if (input.mutation_instructions !== undefined)
            updates.mutation_instructions = input.mutation_instructions;

        const { error } = await supabase
            .from("sequence_steps")
            .update(updates)
            .eq("id", stepId);
        if (error) {
            console.error("updateSequenceStepCore error:", error);
            return { success: false, error: error.message };
        }

        if (step.sequences) {
            const clientId = (step.sequences as any).client_id;
            opts?.revalidate?.(`/client/${clientId}/sequences/${step.sequence_id}`);
        }
        return { success: true };
    } catch (e: any) {
        console.error("updateSequenceStepCore error:", e);
        return { success: false, error: "Internal error" };
    }
}

/** Insert multiple steps in order. Fail-fast: returns ids created so far on error. */
export async function addStepsBatchCore(
    sequenceId: string,
    steps: StepInput[],
    opts?: CoreOpts
): Promise<CoreResult> {
    const stepIds: string[] = [];
    for (const step of steps) {
        const res = await addSequenceStepCore(sequenceId, step, opts);
        if (!res.success) {
            return { success: false, error: res.error, stepIds };
        }
        if (res.stepId) stepIds.push(res.stepId);
    }
    return { success: true, stepIds };
}

/** Create a sequence and (optionally) its steps in one call — the MCP one-shot path. */
export async function createSequenceWithStepsCore(
    clientId: string,
    input: CreateSequenceInput,
    steps: StepInput[] | undefined,
    opts?: CoreOpts
): Promise<CoreResult> {
    // Steps on an explicitly-dynamic sequence are a contradiction — reject
    // BEFORE the sequence insert so no orphan row is left behind when the
    // step-authoring gate would refuse them anyway.
    if (input.generation_mode === "dynamic" && steps && steps.length > 0) {
        return {
            success: false,
            error: "Steps cannot be provided for an AI-managed (dynamic) sequence — its steps are generated per lead. Omit steps, or pass generation_mode: \"static\".",
        };
    }
    // A caller authoring fixed steps is authoring a static sequence — infer it
    // so the dynamic default doesn't reject step-ful MCP payloads for missing
    // an agent, then fail the step inserts on the editable gate.
    if (!input.generation_mode && steps && steps.length > 0) {
        input = { ...input, generation_mode: "static" };
    }
    const created = await createSequenceCore(clientId, input, opts);
    if (!created.success) return created;
    const sequenceId = created.sequenceId as string;

    if (steps && steps.length > 0) {
        const batch = await addStepsBatchCore(sequenceId, steps, opts);
        return {
            success: batch.success,
            error: batch.error,
            sequenceId,
            stepIds: batch.stepIds,
        };
    }
    return { success: true, sequenceId, stepIds: [] };
}

/**
 * Activate or deactivate a sequence — the REAL kill switch.
 *
 * The scheduler's claim RPC (claim_due_enrollments) filters only on enrollment
 * status='active' + next_step_at; it never checks sequences.is_active. So
 * flipping is_active=false ALONE does not stop in-flight enrollments — they keep
 * getting dialed/texted. Deactivation here also pauses active enrollments
 * (status='paused', next_step_at=null) so dispatch truly halts, mirroring the
 * pattern already used in deleteSequence.
 *
 * Re-activating sets is_active=true but does NOT auto-resume paused enrollments
 * (errs toward not dialing); new enrollments flow normally.
 *
 * NOTE: the spend gate is intentionally NOT here — it lives in the admin/MCP
 * route layer so the autonomous path is gated while the human dashboard toggle
 * keeps its current behavior (plus this kill-switch fix).
 */
export async function setSequenceActiveCore(
    sequenceId: string,
    isActive: boolean,
    opts?: CoreOpts
): Promise<CoreResult> {
    try {
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();
        if (!seq) return { success: false, error: "Sequence not found" };

        if (isActive) {
            const { error } = await supabase
                .from("sequences")
                .update({ is_active: true })
                .eq("id", sequenceId);
            if (error) return { success: false, error: error.message };

            opts?.revalidate?.(`/client/${seq.client_id}/sequences`);
            opts?.revalidate?.(`/client/${seq.client_id}/sequences/${sequenceId}`);
            return { success: true, is_active: true };
        }

        // Deactivate, then halt in-flight enrollments so the scheduler stops.
        // Dynamic enrollments live in awaiting_outcome/generating_next_step —
        // without pausing those too, the outcome-timeout poll self-resumes
        // them and the "kill switch" doesn't kill.
        const { error: deErr } = await supabase
            .from("sequences")
            .update({ is_active: false })
            .eq("id", sequenceId);
        if (deErr) return { success: false, error: deErr.message };

        const { data: paused, error: pErr } = await supabase
            .from("sequence_enrollments")
            .update({ status: "paused", next_step_at: null, outcome_timeout_at: null })
            .eq("sequence_id", sequenceId)
            .in("status", ["active", "awaiting_outcome", "generating_next_step"])
            .select("id");
        if (pErr) return { success: false, error: pErr.message };

        opts?.revalidate?.(`/client/${seq.client_id}/sequences`);
        opts?.revalidate?.(`/client/${seq.client_id}/sequences/${sequenceId}`);
        return {
            success: true,
            is_active: false,
            paused_enrollments: paused?.length ?? 0,
        };
    } catch (e: any) {
        console.error("setSequenceActiveCore error:", e);
        return { success: false, error: "Internal error" };
    }
}
