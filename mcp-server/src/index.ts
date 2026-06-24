import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerEnrollTools } from "./tools/enroll.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAnalyticsTools } from "./tools/analytics.js";

async function main() {
    const server = new McpServer({ name: "omnify", version: "1.0.0" });

    registerReadTools(server);
    registerWriteTools(server);
    registerEnrollTools(server);
    registerAgentTools(server);
    registerAnalyticsTools(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // NOTE: stdout is the MCP protocol channel — never write to it. Logs → stderr.
    console.error(
        `[omnify-mcp] connected. base=${config.baseUrl} client=${config.defaultClientId || "(none)"} confirm=${config.requireConfirm}`
    );
}

main().catch((err) => {
    console.error("[omnify-mcp] fatal:", err);
    process.exit(1);
});
