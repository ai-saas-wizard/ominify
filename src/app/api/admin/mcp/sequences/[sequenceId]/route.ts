import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { getSequenceDetail } from "@/app/actions/sequence-actions";
import { updateSequenceCore } from "@/lib/sequences/sequence-core";

// GET /api/admin/mcp/sequences/[sequenceId]  → full sequence with steps + enrollment stats.
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sequenceId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { sequenceId } = await params;
    const result = await getSequenceDetail(sequenceId);
    return NextResponse.json(result, { status: result.success ? 200 : 404 });
}

// PATCH /api/admin/mcp/sequences/[sequenceId]  → update sequence metadata.
// Body: { name?, description?, trigger_type?, urgency_tier?, trigger_conditions? }
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ sequenceId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { sequenceId } = await params;
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await updateSequenceCore(
        sequenceId,
        {
            name: body.name,
            description: body.description,
            trigger_type: body.trigger_type,
            urgency_tier: body.urgency_tier,
            trigger_conditions: body.trigger_conditions,
        },
        { revalidate: revalidatePath }
    );
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
