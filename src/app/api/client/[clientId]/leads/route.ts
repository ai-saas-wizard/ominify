import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { validateApiKey } from "@/app/actions/api-key-actions";
import { assignContactToPipeline } from "@/app/actions/pipeline-actions";
import { evaluateAndAssignPipelines, evaluateStageRules } from "@/app/actions/pipeline-rule-actions";

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

    // ─── Upsert contact ──────────────────────────────────────────────
    const { data: existingContact } = await supabase
        .from("contacts")
        .select("id")
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
            assignedStageId = result.stageId || stage_id;
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

        return NextResponse.json(
            {
                contact_id: existingContact.id,
                pipeline_id: assignedPipelineId || null,
                stage_id: assignedStageId || null,
                stage_name: stageName,
                enrolled_in_sequence: null,
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
        // Explicit pipeline placement
        const result = await assignContactToPipeline(contactId, pipeline_id, stage_id || undefined);
        assignedPipelineId = pipeline_id;
        assignedStageId = result.stageId || stage_id || null;
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

    // ─── Evaluate stage rules (auto-enroll in sequences) ─────────────
    let enrolledSequenceId: string | null = null;

    if (assignedStageId) {
        const { enrolled } = await evaluateStageRules(contactId, assignedStageId, clientId);
        if (enrolled && enrolled.length > 0) {
            enrolledSequenceId = enrolled[0];
        }
    }

    // ─── Explicit sequence enrollment ────────────────────────────────
    if (enroll_in_sequence && !enrolledSequenceId) {
        const { error: enrollError } = await supabase
            .from("sequence_enrollments")
            .insert({
                tenant_id: clientId,
                sequence_id: enroll_in_sequence,
                contact_id: contactId,
                status: "active",
                current_step_order: 1,
                next_step_at: new Date().toISOString(),
                enrollment_source: source || "api",
            });

        if (!enrollError) {
            enrolledSequenceId = enroll_in_sequence;
        }
    }

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
        },
        { status: 201 }
    );
}
