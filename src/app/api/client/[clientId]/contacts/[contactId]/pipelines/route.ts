import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string; contactId: string }> }
) {
    const { contactId } = await params;

    try {
        // Get all pipeline_contacts for this contact, joined with pipeline and stage info
        const { data: pipelineContacts, error } = await supabase
            .from("pipeline_contacts")
            .select(`
                id,
                pipeline_id,
                stage_id,
                moved_at,
                moved_by,
                pipelines(name, color),
                pipeline_stages(name, color)
            `)
            .eq("contact_id", contactId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const pipelines = (pipelineContacts || []).map((pc: any) => ({
            pipeline_contact_id: pc.id,
            pipeline_id: pc.pipeline_id,
            pipeline_name: pc.pipelines?.name || "Unknown",
            pipeline_color: pc.pipelines?.color || "#059669",
            stage_id: pc.stage_id,
            stage_name: pc.pipeline_stages?.name || null,
            stage_color: pc.pipeline_stages?.color || null,
            moved_at: pc.moved_at,
            moved_by: pc.moved_by,
        }));

        return NextResponse.json({ pipelines });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Internal error" },
            { status: 500 }
        );
    }
}
