import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { updateSequenceStepCore } from "@/lib/sequences/sequence-core";

// PATCH /api/admin/mcp/steps/[stepId]  → edit a step (partial).
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ stepId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { stepId } = await params;
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await updateSequenceStepCore(stepId, body, { revalidate: revalidatePath });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
