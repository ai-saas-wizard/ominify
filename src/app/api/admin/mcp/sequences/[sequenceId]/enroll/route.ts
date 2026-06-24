import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { enrollContact } from "@/app/actions/sequence-actions";
import { resolveOrCreateContact } from "@/lib/sequences/enrollment-core";
import { checkSpendCap } from "@/lib/spend/spend-guard";

// POST /api/admin/mcp/sequences/[sequenceId]/enroll
// Body: { clientId, contactId? | (phone?, name?, email?), source?, estimatedMinutes? }
// Spend-gated (hard stop). Reuses enrollContact's no-respam guard + pipeline advance.
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

    const clientId = body?.clientId;
    if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }

    // 1. Spend gate (unbypassable for the MCP path).
    const decision = await checkSpendCap(clientId, {
        estimatedMinutes:
            typeof body?.estimatedMinutes === "number" ? body.estimatedMinutes : undefined,
    });
    if (!decision.allowed) {
        return NextResponse.json(
            { success: false, error: `Spend cap blocked enrollment: ${decision.reason}`, spend: decision },
            { status: 402 }
        );
    }

    // 2. Resolve (or create) the contact.
    const resolved = await resolveOrCreateContact(clientId, {
        contactId: body?.contactId,
        phone: body?.phone,
        name: body?.name,
        email: body?.email,
    });
    if (resolved.error || !resolved.contactId) {
        return NextResponse.json(
            { success: false, error: resolved.error || "Could not resolve contact" },
            { status: 400 }
        );
    }

    // 3. Enroll (reuses the existing no-respam guard + pipeline auto-advance).
    const result = await enrollContact(
        sequenceId,
        resolved.contactId,
        clientId,
        body?.source || "mcp"
    );

    return NextResponse.json(
        { ...result, contactId: resolved.contactId, contactCreated: resolved.created },
        { status: result.success ? 201 : 400 }
    );
}
