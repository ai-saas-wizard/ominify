import type { SaaSFormData, TransferSpecialist } from "../types";
import { normalizeToE164 } from "@/lib/phone-utils";
import {
    buildCalendarToolDefinitions,
    CALENDAR_TOOL_NAMES,
    transferToolNameFor,
    type CalendarToolIdMap,
} from "../real-estate-investor/tools";

export { transferToolNameFor };

export interface BuildSaaSToolsOptions {
    /**
     * Map of calendar tool name → registered VAPI tool ID. When provided (UMBRELLA
     * accounts), inline calendar tool definitions are OMITTED — the caller attaches
     * the umbrella's registered tool IDs via the assistant payload's `model.toolIds`.
     */
    calendarToolIds?: CalendarToolIdMap;
}

/**
 * Builds a warm/cold transferCall tool for the SaaS outbound agent.
 * Mirrors the RE `buildTransferTool` shape but with SaaS sales wording
 * ("lead/prospect" + "qualified demo" handoff instead of "seller/offer").
 * The agent warm-transfers HOT leads to a human closer.
 */
export function buildSaaSTransferTool(
    specialist: TransferSpecialist
): Record<string, unknown> | null {
    if (!specialist.phone) return null;

    // VAPI rejects non-E.164 numbers — drop the tool but let the agent deploy.
    const phoneE164 = normalizeToE164(specialist.phone);
    if (!phoneE164) {
        console.warn(
            `[buildSaaSTransferTool] dropping transfer tool — unparseable phone: "${specialist.phone}"`
        );
        return null;
    }

    const fname = specialist.firstName || "the team";
    const role = specialist.role || "account executive";
    const toolName = transferToolNameFor(specialist);
    const isWarmSummary = specialist.mode === "warm-summary";

    const summaryPlan = isWarmSummary
        ? {
              enabled: true,
              messages: [
                  {
                      role: "system",
                      content: `You are briefing your ${role} ${fname} on a sales call that just happened. Give a concise, spoken-style summary in 3–4 sentences: the lead's name, their company, the pain or use case they described, where the conversation left off (their interest level, any objections), and what ${fname} should pick up on. Do not read the transcript verbatim or list bullets — sound like one rep handing off to another verbally.`,
                  },
                  {
                      role: "user",
                      content: "Transcript of the call:\n\n{{transcript}}",
                  },
              ],
              timeoutSeconds: 5,
              useAssistantLlm: false,
          }
        : undefined;

    const transferPlan = isWarmSummary
        ? {
              mode: "warm-transfer-wait-for-operator-to-speak-first-and-then-say-summary",
              sipVerb: "refer",
              summaryPlan,
          }
        : { mode: "blind-transfer" };

    return {
        type: "transferCall",
        function: {
            name: toolName,
            parameters: null,
            description: `${isWarmSummary ? "Warm" : "Cold"}-transfer the call to ${fname}, the ${role}, when the lead asks to speak to a human, is clearly a hot/qualified prospect who wants to talk now, or asks a detailed question only a human should answer. ${
                isWarmSummary
                    ? `${fname} will hear a short spoken summary before the lead is connected.`
                    : `The lead will be connected immediately with no summary.`
            }`,
        },
        messages: [{ type: "request-start", blocking: false }],
        destinations: [
            {
                type: "number",
                number: phoneE164,
                message: `Of course — let me get ${fname} on the line for you real quick. Just give me one second.`,
                description: `${isWarmSummary ? "Warm" : "Cold"}-transfer to ${fname} (${role}). Invoke when (1) the lead asks to speak to a human / be transferred, OR (2) the lead is hot and wants to move forward right now, OR (3) the lead asks if you're an AI for the SECOND time after the first-time deflection. Never invoke for any other reason.`,
                transferPlan,
                numberE164CheckEnabled: true,
            },
        ],
    };
}

/**
 * Builds the VAPI tools array for the SaaS outbound sales agent: the calendar
 * surface (for booking demos) + a warm/cold transferCall to a human closer.
 *
 * If `opts.calendarToolIds` is provided, inline calendar tools are omitted —
 * the caller attaches them via `model.toolIds` (UMBRELLA accounts). `endCall`
 * is appended by the payload builder, not here.
 */
export function buildSaaSOutboundTools(
    clientId: string,
    appUrl: string,
    formData: SaaSFormData,
    opts: BuildSaaSToolsOptions = {}
): unknown[] {
    const serverUrl = `${appUrl}/api/vapi/tools/calendar`;
    const tools: unknown[] = [];

    if (!opts.calendarToolIds) {
        const calendarTools = buildCalendarToolDefinitions(serverUrl);
        for (const name of CALENDAR_TOOL_NAMES) {
            tools.push(calendarTools[name]);
        }
    }

    const transferTool = buildSaaSTransferTool(formData.outboundTransfer);
    if (transferTool) tools.push(transferTool);

    return tools;
}
