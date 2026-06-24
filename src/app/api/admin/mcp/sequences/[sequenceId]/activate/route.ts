import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";
import { setSequenceActiveCore } from "@/lib/sequences/sequence-core";
import { checkSpendCap } from "@/lib/spend/spend-guard";

// POST /api/admin/mcp/sequences/[sequenceId]/activate
// Body: { active?: boolean (default true), estimatedMinutes?: number }
// Activation is spend-gated (hard stop). Deactivation is the kill switch and is
// never blocked (it only reduces spend) — it also pauses in-flight enrollments.
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sequenceId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { sequenceId } = await params;
    let body: any = {};
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    const active = body?.active !== false; // default true
    const estimatedMinutes =
        typeof body?.estimatedMinutes === "number" ? body.estimatedMinutes : undefined;

    if (active) {
        const { data: seq } = await supabase
            .from("sequences")
            .select("client_id")
            .eq("id", sequenceId)
            .single();
        if (!seq) {
            return NextResponse.json(
                { success: false, error: "Sequence not found" },
                { status: 404 }
            );
        }

        const decision = await checkSpendCap(seq.client_id, { estimatedMinutes });
        if (!decision.allowed) {
            return NextResponse.json(
                { success: false, error: `Spend cap blocked activation: ${decision.reason}`, spend: decision },
                { status: 402 }
            );
        }
    }

    const result = await setSequenceActiveCore(sequenceId, active, {
        revalidate: revalidatePath,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
