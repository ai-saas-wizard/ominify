import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { addSequenceStepCore, addStepsBatchCore } from "@/lib/sequences/sequence-core";

// POST /api/admin/mcp/sequences/[sequenceId]/steps  → add one step or many.
// Body: a single StepInput, or { steps: StepInput[] }.
export async function POST(
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

    const result = Array.isArray(body?.steps)
        ? await addStepsBatchCore(sequenceId, body.steps, { revalidate: revalidatePath })
        : await addSequenceStepCore(sequenceId, body, { revalidate: revalidatePath });

    return NextResponse.json(result, { status: result.success ? 201 : 400 });
}
