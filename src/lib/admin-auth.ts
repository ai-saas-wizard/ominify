import "server-only";
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * Auth for the internal MCP / admin programmatic surface (`/api/admin/mcp/*`).
 *
 * This is deliberately different from `validateApiKey` (src/app/actions/api-key-actions.ts),
 * which is PER-CLIENT (it takes a clientId and looks up `client_api_keys`). The MCP server
 * acts as a single trusted operator across the whole account — it can create agents, deploy
 * verticals, and enroll contacts for any client — so it authenticates with one account-level
 * service token read from `MCP_ADMIN_TOKEN`.
 *
 * The token is a high-entropy random string compared in constant time. If `MCP_ADMIN_TOKEN`
 * is unset, the surface is disabled (fail closed).
 */
export function validateAdminToken(req: Request): { valid: boolean } {
    const expected = process.env.MCP_ADMIN_TOKEN;
    if (!expected) return { valid: false }; // not configured → surface disabled

    const header =
        req.headers.get("authorization") || req.headers.get("x-admin-token") || "";
    const provided = header.toLowerCase().startsWith("bearer ")
        ? header.slice(7).trim()
        : header.trim();

    if (!provided) return { valid: false };

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on length mismatch. Leaking
    // length is acceptable for a high-entropy token on an internal surface.
    if (a.length !== b.length) return { valid: false };
    try {
        return { valid: timingSafeEqual(a, b) };
    } catch {
        return { valid: false };
    }
}

/**
 * Route-handler guard. Returns a 401 NextResponse when the admin token is
 * missing/invalid, or `null` when the request is authorized.
 *
 * Usage:
 *   const unauth = requireAdmin(req);
 *   if (unauth) return unauth;
 */
export function requireAdmin(req: Request): NextResponse | null {
    const { valid } = validateAdminToken(req);
    if (!valid) {
        return NextResponse.json(
            { success: false, error: "Unauthorized: invalid or missing admin token" },
            { status: 401 }
        );
    }
    return null;
}
