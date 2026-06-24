import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";
import { createSingleAgent } from "@/app/actions/create-single-agent-actions";

// GET /api/admin/mcp/agents?clientId=...  → list voice agents for a client.
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

    const { data, error } = await supabase
        .from("agents")
        .select("id, name, agent_type, vapi_id, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: data || [] });
}

// POST /api/admin/mcp/agents  → create a single voice agent (creates a real VAPI assistant).
// Body: { clientId, kind, agentName, agentType? (generic), formData? (vertical kinds) }
//   kind: "generic" | "vertical_re" | "vertical_re_outbound" | "vertical_saas_outbound"
export async function POST(req: NextRequest) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { clientId, kind, agentType, agentName, formData } = body || {};
    if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }
    if (!kind || !agentName) {
        return NextResponse.json(
            { success: false, error: "kind and agentName are required" },
            { status: 400 }
        );
    }

    let input: any;
    if (kind === "generic") {
        input = { kind, agentType: agentType || "outbound", agentName };
    } else if (
        kind === "vertical_re" ||
        kind === "vertical_re_outbound" ||
        kind === "vertical_saas_outbound"
    ) {
        if (!formData) {
            return NextResponse.json(
                { success: false, error: `formData is required for kind=${kind}` },
                { status: 400 }
            );
        }
        input = { kind, agentName, formData };
    } else {
        return NextResponse.json({ success: false, error: `Unknown kind: ${kind}` }, { status: 400 });
    }

    const result = await createSingleAgent(clientId, input);
    return NextResponse.json(result, { status: result.success ? 201 : 400 });
}
