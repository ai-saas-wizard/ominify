import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getOrCreateMinuteBalance } from "@/lib/billing";
import { canPlaceCall } from "@/lib/access";

// GET /api/admin/mcp/balance?clientId=...  → minute balance + whether outreach can run.
// Surfaced as its own tool so the MCP/Claude can check spend headroom before
// enrolling or activating (the spend gate uses the same numbers).
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

    try {
        const [balance, access] = await Promise.all([
            getOrCreateMinuteBalance(clientId),
            canPlaceCall(clientId),
        ]);
        return NextResponse.json({
            success: true,
            data: {
                balance_minutes: balance.balance_minutes,
                subscription_minutes: (balance as any).subscription_minutes ?? null,
                total_purchased: (balance as any).total_purchased ?? null,
                total_used: (balance as any).total_used ?? null,
                can_place_call: access.allowed,
                blocked_reason: access.allowed ? null : (access as any).reason,
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { success: false, error: err?.message || "Failed to load balance" },
            { status: 500 }
        );
    }
}
