import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";

/**
 * Append a single row to audit_log.
 *
 * NEVER include the actual secret value in `metadata`. Log the FACT that a
 * secret changed, plus the target and actor. Example: when rotating an
 * umbrella VAPI key, log { action: "update_umbrella_key", target: { type:
 * "umbrella", id }, metadata: { changedFields: ["vapi_api_key_encrypted"] } }.
 *
 * This function is best-effort: a failure to write the audit row should NOT
 * prevent the underlying action from completing (we log the error instead).
 */
export async function auditLog(
    action: string,
    target?: { type: string; id: string },
    metadata: Record<string, unknown> = {}
): Promise<void> {
    try {
        const { userId } = await auth();
        const user = userId ? await currentUser() : null;
        const h = await headers();

        const ipHeader =
            h.get("x-forwarded-for") ||
            h.get("x-real-ip") ||
            null;
        const ip = ipHeader ? ipHeader.split(",")[0]?.trim() || null : null;

        await supabase.from("audit_log").insert({
            actor_user_id: userId || "anonymous",
            actor_email: user?.emailAddresses[0]?.emailAddress || null,
            action,
            target_type: target?.type || null,
            target_id: target?.id || null,
            metadata,
            ip_address: ip,
            user_agent: h.get("user-agent") || null,
        });
    } catch (err) {
        // Never throw — audit logging must not break the calling action.
        console.error("[AUDIT LOG] Failed to record event:", action, err);
    }
}
