import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAllVerticals } from "@/lib/verticals/registry";

// GET /api/admin/mcp/verticals  → list available verticals + their form schema,
// so the caller knows what formData to supply when deploying.
export async function GET(req: NextRequest) {
    const unauth = requireAdmin(req);
    if (unauth) return unauth;

    return NextResponse.json({ success: true, data: getAllVerticals() });
}
