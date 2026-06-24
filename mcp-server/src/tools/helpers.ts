// Shape tool output for the MCP protocol. All results are returned as text
// (JSON, pretty-printed) since the model consumes them as context.

export function toolText(data: unknown) {
    const text =
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
    return { content: [{ type: "text" as const, text }] };
}

export function toolError(message: string) {
    return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
    };
}

/** Run an async tool body, mapping success/throw to the MCP result shape. */
export async function run(fn: () => Promise<unknown>) {
    try {
        return toolText(await fn());
    } catch (e: any) {
        return toolError(e?.message || String(e));
    }
}
