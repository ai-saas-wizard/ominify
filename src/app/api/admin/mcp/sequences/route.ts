import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { getSequences } from "@/app/actions/sequence-actions";
import { createSequenceWithStepsCore } from "@/lib/sequences/sequence-core";

// GET /api/admin/mcp/sequences?clientId=...  → list sequences for a client.
export async function GET(req: NextRequest) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId) {
        return NextResponse.json(
            { success: false, error: "clientId query param is required" },
            { status: 400 }
        );
    }

    const result = await getSequences(clientId);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

// POST /api/admin/mcp/sequences  → create a sequence (optionally with steps in one shot).
// Body: { clientId, name, description?, trigger_type?, urgency_tier?, trigger_conditions?,
//         generation_mode?, max_touchpoints?, agentId?, steps?: StepInput[] }
// Sequences are always created inactive — activation is a separate, gated call.
export async function POST(req: NextRequest) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { clientId, steps, ...rest } = body || {};
    if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }
    if (!rest.name) {
        return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }

    const result = await createSequenceWithStepsCore(
        clientId,
        {
            name: rest.name,
            description: rest.description,
            trigger_type: rest.trigger_type,
            urgency_tier: rest.urgency_tier,
            trigger_conditions: rest.trigger_conditions,
            generation_mode: rest.generation_mode,
            max_touchpoints: rest.max_touchpoints,
            agentId: rest.agentId ?? rest.agent_id ?? null,
        },
        Array.isArray(steps) ? steps : undefined,
        { revalidate: revalidatePath }
    );

    return NextResponse.json(result, { status: result.success ? 201 : 400 });
}
