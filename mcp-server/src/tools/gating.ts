import { api } from "../http.js";

// Rough worst-case minutes per voice touch, for the human-facing preview only.
// The authoritative hard gate is server-side (checkSpendCap).
const AVG_CALL_MIN = 2;

/**
 * Build a spend preview for the confirm/dry-run flow: counts voice steps in the
 * sequence and estimates worst-case minutes against current balance.
 */
export async function previewSpend(
    clientId: string,
    args: { enrollCount?: number; sequenceId?: string }
) {
    const balanceRes = await api.get("/api/admin/mcp/balance", { clientId });
    const bal = balanceRes?.data ?? {};

    let voiceSteps = 0;
    if (args.sequenceId) {
        const detail = await api.get(`/api/admin/mcp/sequences/${args.sequenceId}`);
        const steps = detail?.data?.sequence_steps || [];
        voiceSteps = steps.filter((s: any) => s.channel === "voice").length;
    }

    const contacts = args.enrollCount ?? 1;
    const estimatedMinutes = contacts * voiceSteps * AVG_CALL_MIN;
    const balanceMinutes =
        Number(bal.balance_minutes ?? 0) + Number(bal.subscription_minutes ?? 0);

    return {
        contacts,
        voiceStepsPerContact: voiceSteps,
        avgCallMinutes: AVG_CALL_MIN,
        estimatedMinutes,
        balanceMinutes,
        projectedMinutes: balanceMinutes - estimatedMinutes,
        canPlaceCall: bal.can_place_call ?? null,
    };
}
