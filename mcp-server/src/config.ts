import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load mcp-server/.env regardless of the launching cwd (Claude Desktop spawns
// the process from an arbitrary directory). Inline env from the mcpServers
// config takes precedence — dotenv does not override already-set vars.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

function required(name: string): string {
    const v = process.env[name];
    if (!v) {
        console.error(`[omnify-mcp] FATAL: missing required env var ${name}`);
        process.exit(1);
    }
    return v;
}

export const config = {
    baseUrl: process.env.OMNIFY_BASE_URL || "http://localhost:3000",
    adminToken: required("MCP_ADMIN_TOKEN"),
    defaultClientId: process.env.OMNIFY_DEFAULT_CLIENT_ID || "",
    requireConfirm: (process.env.OMNIFY_REQUIRE_CONFIRM ?? "true") !== "false",
    minBalanceFloorMinutes: Number(process.env.MCP_MIN_BALANCE_FLOOR_MINUTES ?? "30"),
    maxEnrollPerCall: Number(process.env.MCP_MAX_ENROLL_PER_CALL ?? "50"),
};

/** Resolve a clientId, falling back to OMNIFY_DEFAULT_CLIENT_ID. */
export function resolveClientId(clientId?: string): string {
    const id = clientId || config.defaultClientId;
    if (!id) {
        throw new Error(
            "No clientId provided and OMNIFY_DEFAULT_CLIENT_ID is not set"
        );
    }
    return id;
}
