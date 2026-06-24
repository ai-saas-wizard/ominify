import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
    deployVerticalAgents,
    deploySaaSAgents,
} from "@/app/actions/vertical-deployment-actions";

// POST /api/admin/mcp/verticals/deploy  → deploy a vertical's pre-built agents.
// Body: { clientId, verticalId, formData }
//   verticalId: "real_estate_investor" | "saas_companies"
// NOT idempotent — re-running creates duplicate VAPI assistants. The MCP tool
// gates this behind a confirmation step.
export async function POST(req: NextRequest) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { clientId, verticalId, formData } = body || {};
    if (!clientId || !verticalId || !formData) {
        return NextResponse.json(
            { success: false, error: "clientId, verticalId and formData are required" },
            { status: 400 }
        );
    }

    let result;
    if (verticalId === "real_estate_investor") {
        result = await deployVerticalAgents(clientId, formData);
    } else if (verticalId === "saas_companies") {
        result = await deploySaaSAgents(clientId, formData);
    } else {
        return NextResponse.json(
            { success: false, error: `Unknown verticalId: ${verticalId}` },
            { status: 400 }
        );
    }

    return NextResponse.json(result, { status: result.success ? 201 : 400 });
}
