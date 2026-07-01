import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { validateApiKey } from "@/app/actions/api-key-actions";
import { assignContactToPipeline } from "@/app/actions/pipeline-actions";
import { evaluateAndAssignPipelines, evaluateStageRules } from "@/app/actions/pipeline-rule-actions";

// Enrollment for both new and existing contacts: stage rules first, then the
// explicit enroll_in_sequence request. UNIQUE(sequence_id, contact_id) on
// sequence_enrollments absorbs re-enrollment attempts (23505). The constraint
// is unconditional, so already_enrolled means "was enrolled at some point,
// ever" — terminal enrollments count too.
async function evaluateEnrollment(
    clientId: string,
    contactId: string,
    assignedStageId: string | null,
    enrollInSequence: string | undefined,
    source: string | undefined
): Promise<{ enrolledSequenceId: string | null; alreadyEnrolled: boolean }> {
    let enrolledSequenceId: string | null = null;
    let alreadyEnrolled = false;

    if (assignedStageId) {
        const { enrolled } = await evaluateStageRules(contactId, assignedStageId, clientId);
        if (enrolled && enrolled.length > 0) {
            enrolledSequenceId = enrolled[0];
        }
    }

    if (enrollInSequence && !enrolledSequenceId) {
        const { error: enrollError } = await supabase
            .from("sequence_enrollments")
            .insert({
                tenant_id: clientId,
                sequence_id: enrollInSequence,
                contact_id: contactId,
                status: "active",
                current_step_order: 0,
                next_step_at: new Date().toISOString(),
                enrollment_source: source || "api",
            });

        if (!enrollError) {
            enrolledSequenceId = enrollInSequence;
        } else if (enrollError.code === "23505") {
            alreadyEnrolled = true;
        } else {
            // A validated, explicitly-requested enrollment failed for some
            // other reason (transient DB error, constraint). Don't let the
            // 200 response silently masquerade as a deliberate no-op.
            console.error(
                `[LEADS] Enrollment insert failed for contact ${contactId} → sequence ${enrollInSequence}:`,
                enrollError
            );
        }
    }

    return { enrolledSequenceId, alreadyEnrolled };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    // ─── Authenticate via API key ────────────────────────────────────
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
        return NextResponse.json(
            { error: "Missing x-api-key header" },
            { status: 401 }
        );
    }

    const { valid } = await validateApiKey(clientId, apiKey);
    if (!valid) {
        return NextResponse.json(
            { error: "Invalid or inactive API key" },
            { status: 401 }
        );
    }

    // ─── Parse body ──────────────────────────────────────────────────
    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }

    const { phone, name, email, source, pipeline_id, stage_id, custom_fields, enroll_in_sequence } = body;

    if (!phone) {
        return NextResponse.json(
            { error: "phone is required" },
            { status: 400 }
        );
    }

    // ─── Validate enroll_in_sequence against the authenticated client ─
    if (enroll_in_sequence) {
        const { data: targetSequence, error: seqLookupError } = await supabase
            .from("sequences")
            .select("id, client_id, is_active")
            .eq("id", enroll_in_sequence)
            .maybeSingle();

        // A transient DB failure must not masquerade as an authorization
        // verdict (22P02 = not-a-uuid, which IS a caller problem).
        if (seqLookupError && seqLookupError.code !== "22P02") {
            return NextResponse.json(
                { error: "Failed to validate enroll_in_sequence" },
                { status: 500 }
            );
        }

        // One generic message for missing AND foreign sequences so a valid
        // key can't be used to probe which sequence ids exist on other
        // tenants.
        if (seqLookupError || !targetSequence || targetSequence.client_id !== clientId) {
            return NextResponse.json(
                { error: "enroll_in_sequence does not match a sequence for this client" },
                { status: 403 }
            );
        }
        if (!targetSequence.is_active) {
            return NextResponse.json(
                { error: "enroll_in_sequence references an inactive sequence" },
                { status: 400 }
            );
        }
    }

    // ─── Validate pipeline_id / stage_id the same way ─────────────────
    // assignContactToPipeline and evaluateStageRules key only on the raw
    // ids (service-role client, no RLS backstop), so unvalidated ids let a
    // valid key for client A write into client B's pipelines and enroll
    // through B's stage rules.
    if (pipeline_id) {
        const { data: targetPipeline, error: pipelineLookupError } = await supabase
            .from("pipelines")
            .select("id, client_id")
            .eq("id", pipeline_id)
            .maybeSingle();

        if (pipelineLookupError && pipelineLookupError.code !== "22P02") {
            return NextResponse.json(
                { error: "Failed to validate pipeline_id" },
                { status: 500 }
            );
        }
        if (pipelineLookupError || !targetPipeline || targetPipeline.client_id !== clientId) {
            return NextResponse.json(
                { error: "pipeline_id does not match a pipeline for this client" },
                { status: 403 }
            );
        }
    }
    if (stage_id) {
        const { data: targetStage, error: stageLookupError } = await supabase
            .from("pipeline_stages")
            .select("id, client_id, pipeline_id")
            .eq("id", stage_id)
            .maybeSingle();

        if (stageLookupError && stageLookupError.code !== "22P02") {
            return NextResponse.json(
                { error: "Failed to validate stage_id" },
                { status: 500 }
            );
        }
        if (stageLookupError || !targetStage || targetStage.client_id !== clientId) {
            return NextResponse.json(
                { error: "stage_id does not match a stage for this client" },
                { status: 403 }
            );
        }
        // pipeline_id is nullable on legacy stage rows — only enforce
        // consistency when both sides are known.
        if (pipeline_id && targetStage.pipeline_id && targetStage.pipeline_id !== pipeline_id) {
            return NextResponse.json(
                { error: "stage_id does not belong to pipeline_id" },
                { status: 400 }
            );
        }
    }

    // ─── Upsert contact ──────────────────────────────────────────────
    const { data: existingContact } = await supabase
        .from("contacts")
        .select("id, opted_out_at")
        .eq("client_id", clientId)
        .eq("phone", phone)
        .single();

    if (existingContact) {
        // Contact already exists — update fields if provided
        const updates: Record<string, any> = {};
        if (name) updates.name = name;
        if (email) updates.email = email;
        if (custom_fields) updates.custom_fields = custom_fields;

        if (Object.keys(updates).length > 0) {
            await supabase
                .from("contacts")
                .update(updates)
                .eq("id", existingContact.id);
        }

        // Still place in pipeline if requested
        let assignedPipelineId = pipeline_id;
        let assignedStageId = stage_id;

        if (pipeline_id) {
            const result = await assignContactToPipeline(existingContact.id, pipeline_id, stage_id || undefined);
            // Only treat the stage as entered when the placement actually
            // succeeded — stage rules must not fire off a stage the contact
            // never reached.
            assignedStageId = result.success ? result.stageId || stage_id : null;
        }

        // Get stage name
        let stageName = null;
        if (assignedStageId) {
            const { data: stageData } = await supabase
                .from("pipeline_stages")
                .select("name")
                .eq("id", assignedStageId)
                .single();
            stageName = stageData?.name || null;
        }

        // Enrollment — same logic as new contacts. Opted-out contacts are
        // never re-enrolled (mirrors the sequencer's lead-ingestion route).
        // Stage rules only fire for a stage the contact actually entered via
        // explicit pipeline placement in this request — a bare stage_id in
        // the body must not trigger them.
        let enrolledSequenceId: string | null = null;
        let alreadyEnrolled = false;
        const optedOut = Boolean(existingContact.opted_out_at);
        if (!optedOut) {
            ({ enrolledSequenceId, alreadyEnrolled } = await evaluateEnrollment(
                clientId,
                existingContact.id,
                pipeline_id ? assignedStageId || null : null,
                enroll_in_sequence,
                source
            ));
        }

        return NextResponse.json(
            {
                contact_id: existingContact.id,
                pipeline_id: assignedPipelineId || null,
                stage_id: assignedStageId || null,
                stage_name: stageName,
                enrolled_in_sequence: enrolledSequenceId,
                ...(alreadyEnrolled ? { already_enrolled: true } : {}),
                ...(optedOut ? { skipped_opted_out: true } : {}),
                existing: true,
            },
            { status: 200 }
        );
    }

    // ─── Create new contact ──────────────────────────────────────────
    const { data: newContact, error: createError } = await supabase
        .from("contacts")
        .insert({
            client_id: clientId,
            phone,
            name: name || null,
            email: email || null,
            custom_fields: custom_fields || {},
        })
        .select("id")
        .single();

    if (createError || !newContact) {
        // Check for unique constraint violation
        if (createError?.code === "23505") {
            return NextResponse.json(
                { error: "Contact with this phone already exists" },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { error: createError?.message || "Failed to create contact" },
            { status: 500 }
        );
    }

    const contactId = newContact.id;

    // ─── Assign to pipeline ──────────────────────────────────────────
    let assignedPipelineId: string | null = null;
    let assignedStageId: string | null = null;

    if (pipeline_id) {
        // Explicit pipeline placement. Only treat the stage as entered when
        // the placement actually succeeded — stage rules must not fire off a
        // stage the contact never reached.
        const result = await assignContactToPipeline(contactId, pipeline_id, stage_id || undefined);
        assignedPipelineId = pipeline_id;
        assignedStageId = result.success ? result.stageId || stage_id || null : null;
    } else {
        // Auto-assign based on rules
        const { assigned } = await evaluateAndAssignPipelines(contactId, clientId, source);
        if (assigned && assigned.length > 0) {
            assignedPipelineId = assigned[0];
            // Get the stage this contact was placed in
            const { data: pc } = await supabase
                .from("pipeline_contacts")
                .select("stage_id")
                .eq("pipeline_id", assigned[0])
                .eq("contact_id", contactId)
                .single();
            assignedStageId = pc?.stage_id || null;
        }
    }

    // ─── Enrollment (stage rules + explicit enroll_in_sequence) ──────
    const { enrolledSequenceId, alreadyEnrolled } = await evaluateEnrollment(
        clientId,
        contactId,
        assignedStageId,
        enroll_in_sequence,
        source
    );

    // ─── Get stage name for response ─────────────────────────────────
    let stageName = null;
    if (assignedStageId) {
        const { data: stageData } = await supabase
            .from("pipeline_stages")
            .select("name")
            .eq("id", assignedStageId)
            .single();
        stageName = stageData?.name || null;
    }

    return NextResponse.json(
        {
            contact_id: contactId,
            pipeline_id: assignedPipelineId,
            stage_id: assignedStageId,
            stage_name: stageName,
            enrolled_in_sequence: enrolledSequenceId,
            ...(alreadyEnrolled ? { already_enrolled: true } : {}),
        },
        { status: 201 }
    );
}
