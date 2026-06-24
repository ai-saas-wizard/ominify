import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../http.js";
import { run } from "./helpers.js";

/** Read-only outcome/analytics tools — for iterating on sequences. */
export function registerAnalyticsTools(server: McpServer) {
    server.tool(
        "omnify_sequence_analytics",
        "Read a sequence's performance: conversion funnel, per-step stats, learning analytics, and the enrollment list.",
        { sequenceId: z.string() },
        async ({ sequenceId }) =>
            run(() => api.get(`/api/admin/mcp/sequences/${sequenceId}/analytics`))
    );

    server.tool(
        "omnify_enrollment_log",
        "Read one enrollment's outcomes: execution log (calls/SMS/emails), AI mutations, and self-healing actions.",
        { enrollmentId: z.string() },
        async ({ enrollmentId }) =>
            run(() => api.get(`/api/admin/mcp/enrollments/${enrollmentId}/log`))
    );
}
