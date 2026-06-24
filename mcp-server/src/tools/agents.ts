import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../http.js";
import { config, resolveClientId } from "../config.js";
import { run } from "./helpers.js";

/** Agent + vertical management. Creation tools make REAL VAPI assistants and are
 * NOT idempotent, so they honor the confirm/dry-run gate by default. */
export function registerAgentTools(server: McpServer) {
    server.tool(
        "omnify_list_verticals",
        "List available verticals (real_estate_investor, saas_companies) with their form schema, so you know what formData to supply when deploying.",
        {},
        async () => run(() => api.get("/api/admin/mcp/verticals"))
    );

    server.tool(
        "omnify_create_agent",
        "Create a single voice agent. Creates a REAL VAPI assistant. kind=generic needs agentType+agentName; vertical kinds need formData. Previews first unless confirm:true.",
        {
            clientId: z.string().optional(),
            kind: z.enum([
                "generic",
                "vertical_re",
                "vertical_re_outbound",
                "vertical_saas_outbound",
            ]),
            agentName: z.string(),
            agentType: z
                .enum(["inbound", "outbound"])
                .optional()
                .describe("Required for kind=generic"),
            formData: z
                .record(z.any())
                .optional()
                .describe("Required for vertical kinds (REInvestorFormData / SaaSFormData)"),
            confirm: z.boolean().optional(),
            dryRun: z.boolean().optional(),
        },
        async (args) => {
            const clientId = resolveClientId(args.clientId);
            const needPreview = args.dryRun || (config.requireConfirm && !args.confirm);
            if (needPreview) {
                return run(async () => ({
                    willExecute: false,
                    action: "create_agent",
                    reason: args.dryRun ? "dry_run" : "confirmation_required",
                    target: { kind: args.kind, agentName: args.agentName, agentType: args.agentType },
                    note: "Creates a real VAPI assistant (billable resource, not idempotent).",
                    nextStep: "Re-invoke with confirm:true to create.",
                }));
            }
            return run(() =>
                api.post("/api/admin/mcp/agents", {
                    clientId,
                    kind: args.kind,
                    agentName: args.agentName,
                    agentType: args.agentType,
                    formData: args.formData,
                })
            );
        }
    );

    server.tool(
        "omnify_deploy_vertical",
        "Deploy a vertical's pre-built agents (real_estate_investor or saas_companies). Creates multiple REAL VAPI assistants + a tenant profile; NOT idempotent. Previews first unless confirm:true.",
        {
            clientId: z.string().optional(),
            verticalId: z.enum(["real_estate_investor", "saas_companies"]),
            formData: z.record(z.any()).describe("Matches the vertical's form schema (see omnify_list_verticals)"),
            confirm: z.boolean().optional(),
            dryRun: z.boolean().optional(),
        },
        async (args) => {
            const clientId = resolveClientId(args.clientId);
            const needPreview = args.dryRun || (config.requireConfirm && !args.confirm);
            if (needPreview) {
                return run(async () => ({
                    willExecute: false,
                    action: "deploy_vertical",
                    reason: args.dryRun ? "dry_run" : "confirmation_required",
                    target: { verticalId: args.verticalId },
                    note: "Creates multiple real VAPI assistants + tenant profile. Re-running duplicates them.",
                    nextStep: "Re-invoke with confirm:true to deploy.",
                }));
            }
            return run(() =>
                api.post("/api/admin/mcp/verticals/deploy", {
                    clientId,
                    verticalId: args.verticalId,
                    formData: args.formData,
                })
            );
        }
    );
}
