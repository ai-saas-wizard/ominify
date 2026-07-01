import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
    getEnrollmentExecutionLog,
    getMutationHistory,
    getHealingLog,
} from "@/app/actions/sequence-actions";

// GET /api/admin/mcp/enrollments/[enrollmentId]/log
// Per-enrollment outcomes: execution log + AI mutations + self-healing actions.
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ enrollmentId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { enrollmentId } = await params;
    const [log, mutations, healing] = await Promise.all([
        getEnrollmentExecutionLog(enrollmentId),
        getMutationHistory(enrollmentId),
        getHealingLog(enrollmentId),
    ]);

    return NextResponse.json({ success: true, data: { log, mutations, healing } });
}
