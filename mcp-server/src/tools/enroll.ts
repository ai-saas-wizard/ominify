import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../http.js";
import { config, resolveClientId } from "../config.js";
import { run } from "./helpers.js";
import { previewSpend } from "./gating.js";

/**
 * Spend-affecting tools. Two-layer safety:
 *  - MCP side: when OMNIFY_REQUIRE_CONFIRM=true, the first call returns a preview
 *    (estimated spend, projected balance) and does NOT execute; caller must
 *    re-invoke with confirm:true. dryRun:true always previews.
 *  - Server side: every execute path runs checkSpendCap (hard floor) regardless,
 *    so autonomy is bounded even with confirmation disabled.
 */
export function registerEnrollTools(server: McpServer) {
    server.tool(
        "omnify_enroll_contact",
        "Enroll a contact into a sequence — by contactId, or by phone to find-or-create. Triggers REAL outreach once the sequence is active; spend-gated. Default: returns a preview first; call again with confirm:true to execute.",
        {
            sequenceId: z.string(),
            clientId: z.string().optional(),
            contactId: z.string().optional(),
            phone: z
                .string()
                .optional()
                .describe("E.164 or local number; used to find-or-create when contactId omitted"),
            name: z.string().optional(),
            email: z.string().optional(),
            source: z.string().optional(),
            confirm: z.boolean().optional().describe("Set true to actually enroll"),
            dryRun: z.boolean().optional().describe("Always preview, never execute"),
        },
        async (args) => {
            const clientId = resolveClientId(args.clientId);
            const needPreview = args.dryRun || (config.requireConfirm && !args.confirm);
            if (needPreview) {
                return run(async () => ({
                    willExecute: false,
                    action: "enroll_contact",
                    reason: args.dryRun ? "dry_run" : "confirmation_required",
                    target: { contactId: args.contactId, phone: args.phone },
                    impact: await previewSpend(clientId, {
                        enrollCount: 1,
                        sequenceId: args.sequenceId,
                    }),
                    nextStep: "Re-invoke with confirm:true to enroll.",
                }));
            }
            return run(() =>
                api.post(`/api/admin/mcp/sequences/${args.sequenceId}/enroll`, {
                    clientId,
                    contactId: args.contactId,
                    phone: args.phone,
                    name: args.name,
                    email: args.email,
                    source: args.source,
                })
            );
        }
    );

    server.tool(
        "omnify_activate_sequence",
        "Activate a sequence so the scheduler begins outreach for its enrollments. Spend-gated. Default: preview first, then confirm:true to execute.",
        {
            sequenceId: z.string(),
            clientId: z.string().optional(),
            confirm: z.boolean().optional(),
            dryRun: z.boolean().optional(),
        },
        async (args) => {
            const clientId = resolveClientId(args.clientId);
            const needPreview = args.dryRun || (config.requireConfirm && !args.confirm);
            if (needPreview) {
                return run(async () => ({
                    willExecute: false,
                    action: "activate_sequence",
                    reason: args.dryRun ? "dry_run" : "confirmation_required",
                    sequenceId: args.sequenceId,
                    impact: await previewSpend(clientId, { sequenceId: args.sequenceId }),
                    nextStep: "Re-invoke with confirm:true to activate.",
                }));
            }
            return run(() =>
                api.post(`/api/admin/mcp/sequences/${args.sequenceId}/activate`, {
                    active: true,
                })
            );
        }
    );

    server.tool(
        "omnify_pause_sequence",
        "KILL SWITCH: deactivate a sequence AND pause its in-flight enrollments so dispatch truly stops. Always allowed (only reduces spend); no confirmation needed.",
        { sequenceId: z.string() },
        async ({ sequenceId }) =>
            run(() =>
                api.post(`/api/admin/mcp/sequences/${sequenceId}/activate`, {
                    active: false,
                })
            )
    );
}
