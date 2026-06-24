import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../http.js";
import { resolveClientId } from "../config.js";
import { run } from "./helpers.js";

const stepSchema = z.object({
    channel: z.enum(["sms", "email", "voice"]),
    delay_minutes: z
        .number()
        .optional()
        .describe("Delay before this step fires, in minutes"),
    delay_type: z
        .enum(["after_previous", "after_enrollment", "specific_time"])
        .optional(),
    content: z
        .record(z.any())
        .optional()
        .describe(
            "Channel content. SMS: {body}. Email: {subject, body_html, body_text}. Voice: {first_message, system_prompt}."
        ),
    skip_conditions: z
        .record(z.any())
        .optional()
        .describe('e.g. {"skip_if": ["contact_replied", "appointment_booked"]}'),
    on_success: z.record(z.any()).optional(),
    on_failure: z.record(z.any()).optional(),
    enable_ai_mutation: z.boolean().optional(),
    mutation_instructions: z.string().optional(),
});

/** Sequence/step authoring tools. Creating a sequence does NOT start outreach —
 * sequences are created inactive; activation + enrollment are separate gated tools. */
export function registerWriteTools(server: McpServer) {
    server.tool(
        "omnify_create_sequence",
        "Create an outbound sequence (optionally with all its steps in one call). Created INACTIVE — no outreach happens until you activate it and enroll contacts.",
        {
            clientId: z.string().optional(),
            name: z.string(),
            description: z.string().optional(),
            urgency_tier: z.enum(["critical", "high", "medium", "low"]).optional(),
            trigger_type: z.string().optional(),
            trigger_conditions: z.record(z.any()).optional(),
            generation_mode: z
                .enum(["static", "dynamic"])
                .optional()
                .describe("static = fixed steps; dynamic = AI picks next step at runtime"),
            max_touchpoints: z.number().optional(),
            agentId: z
                .string()
                .optional()
                .describe("Outbound voice agent id to bind (must be agent_type=outbound)"),
            steps: z.array(stepSchema).optional(),
        },
        async ({ clientId, ...rest }) =>
            run(() =>
                api.post("/api/admin/mcp/sequences", {
                    clientId: resolveClientId(clientId),
                    ...rest,
                })
            )
    );

    server.tool(
        "omnify_update_sequence",
        "Update a sequence's metadata (name, description, urgency, trigger conditions). Does not touch steps.",
        {
            sequenceId: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            urgency_tier: z.enum(["critical", "high", "medium", "low"]).optional(),
            trigger_type: z.string().optional(),
            trigger_conditions: z.record(z.any()).optional(),
        },
        async ({ sequenceId, ...rest }) =>
            run(() => api.patch(`/api/admin/mcp/sequences/${sequenceId}`, rest))
    );

    server.tool(
        "omnify_add_step",
        "Append a step (or several) to a sequence. Pass one step's fields, or { steps: [...] } for many.",
        {
            sequenceId: z.string(),
            channel: z.enum(["sms", "email", "voice"]).optional(),
            delay_minutes: z.number().optional(),
            delay_type: z
                .enum(["after_previous", "after_enrollment", "specific_time"])
                .optional(),
            content: z.record(z.any()).optional(),
            skip_conditions: z.record(z.any()).optional(),
            on_success: z.record(z.any()).optional(),
            on_failure: z.record(z.any()).optional(),
            enable_ai_mutation: z.boolean().optional(),
            mutation_instructions: z.string().optional(),
            steps: z.array(stepSchema).optional().describe("Batch mode: add many steps at once"),
        },
        async ({ sequenceId, ...rest }) =>
            run(() =>
                api.post(`/api/admin/mcp/sequences/${sequenceId}/steps`, rest)
            )
    );

    server.tool(
        "omnify_update_step",
        "Edit an existing sequence step (partial update).",
        {
            stepId: z.string(),
            channel: z.enum(["sms", "email", "voice"]).optional(),
            delay_minutes: z.number().optional(),
            delay_type: z
                .enum(["after_previous", "after_enrollment", "specific_time"])
                .optional(),
            content: z.record(z.any()).optional(),
            skip_conditions: z.record(z.any()).optional(),
            on_success: z.record(z.any()).optional(),
            on_failure: z.record(z.any()).optional(),
            enable_ai_mutation: z.boolean().optional(),
            mutation_instructions: z.string().optional(),
        },
        async ({ stepId, ...rest }) =>
            run(() => api.patch(`/api/admin/mcp/steps/${stepId}`, rest))
    );
}
