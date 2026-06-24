import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
    getSequenceLearningAnalytics,
    getStepAnalytics,
    getConversionFunnel,
    getEnrollments,
} from "@/app/actions/sequence-actions";

// GET /api/admin/mcp/sequences/[sequenceId]/analytics
// Aggregates conversion funnel, per-step stats, learning analytics, and the
// enrollment list so the caller can iterate on a sequence.
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sequenceId: string }> }
) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    const { sequenceId } = await params;
    const [learning, steps, funnel, enrollments] = await Promise.all([
        getSequenceLearningAnalytics(sequenceId),
        getStepAnalytics(sequenceId),
        getConversionFunnel(sequenceId),
        getEnrollments(sequenceId),
    ]);

    return NextResponse.json({
        success: true,
        data: { funnel, steps, learning, enrollments },
    });
}
