import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../http.js";
import { resolveClientId } from "../config.js";
import { run } from "./helpers.js";

/** Read-only tools: zero spend risk. */
export function registerReadTools(server: McpServer) {
    server.tool(
        "omnify_list_sequences",
        "List outbound sequences for a client: name, active status, step count, enrolled/completed counts.",
        {
            clientId: z
                .string()
                .optional()
                .describe("Client/tenant id; defaults to OMNIFY_DEFAULT_CLIENT_ID"),
        },
        async ({ clientId }) =>
            run(() =>
                api.get("/api/admin/mcp/sequences", {
                    clientId: resolveClientId(clientId),
                })
            )
    );

    server.tool(
        "omnify_get_sequence",
        "Get one sequence with its full ordered steps and live enrollment stats.",
        { sequenceId: z.string().describe("Sequence id") },
        async ({ sequenceId }) =>
            run(() => api.get(`/api/admin/mcp/sequences/${sequenceId}`))
    );

    server.tool(
        "omnify_list_agents",
        "List the voice agents (inbound/outbound) configured for a client.",
        { clientId: z.string().optional() },
        async ({ clientId }) =>
            run(() =>
                api.get("/api/admin/mcp/agents", {
                    clientId: resolveClientId(clientId),
                })
            )
    );

    server.tool(
        "omnify_get_balance",
        "Get a client's minute balance and whether outreach can currently run (spend headroom).",
        { clientId: z.string().optional() },
        async ({ clientId }) =>
            run(() =>
                api.get("/api/admin/mcp/balance", {
                    clientId: resolveClientId(clientId),
                })
            )
    );
}
