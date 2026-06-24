import "server-only";
import { getOrCreateMinuteBalance } from "@/lib/billing";
import { canPlaceCall } from "@/lib/access";

/**
 * Spend gate for autonomous (MCP) actions that trigger real outreach.
 *
 * Today the only spend protection is at dispatch time: vapi-worker calls
 * canPlaceCall() and skips a call when the tenant has 0 minutes / no sub. There
 * is no *cap* — an autonomous agent could activate/enroll freely up to that
 * zero floor. This adds a configurable floor enforced BEFORE activation/enroll,
 * so the MCP path can't drain a balance to the wire.
 *
 * Enforced inside the admin route layer (the only path the MCP can reach), so
 * it cannot be bypassed by the autonomous caller. The human dashboard actions
 * are intentionally left as-is.
 */

export interface SpendDecision {
    allowed: boolean;
    reason?: string;
    balanceMinutes: number;
    floorMinutes: number;
    estimatedMinutes?: number;
    projectedMinutes?: number;
}

function floorFromEnv(): number {
    const n = Number(process.env.MCP_MIN_BALANCE_FLOOR_MINUTES ?? "30");
    return Number.isFinite(n) ? n : 30;
}

export async function checkSpendCap(
    clientId: string,
    opts?: { estimatedMinutes?: number; floorMinutes?: number }
): Promise<SpendDecision> {
    const floor = opts?.floorMinutes ?? floorFromEnv();

    const [balance, access] = await Promise.all([
        getOrCreateMinuteBalance(clientId),
        canPlaceCall(clientId),
    ]);

    const balanceMinutes =
        Number((balance as any).balance_minutes ?? 0) +
        Number((balance as any).subscription_minutes ?? 0);

    const est = opts?.estimatedMinutes;
    const projected = est != null ? balanceMinutes - est : undefined;

    // 1. Subscription / zero-balance gate (mirrors dispatch-time canPlaceCall).
    if (!access.allowed) {
        return {
            allowed: false,
            reason: (access as any).reason || "outreach_not_allowed",
            balanceMinutes,
            floorMinutes: floor,
            estimatedMinutes: est,
            projectedMinutes: projected,
        };
    }

    // 2. Configurable floor.
    if (balanceMinutes < floor) {
        return {
            allowed: false,
            reason: `balance ${balanceMinutes} min is below the ${floor} min floor (MCP_MIN_BALANCE_FLOOR_MINUTES)`,
            balanceMinutes,
            floorMinutes: floor,
            estimatedMinutes: est,
            projectedMinutes: projected,
        };
    }

    // 3. Don't let an estimated batch push the balance negative.
    if (projected != null && projected < 0) {
        return {
            allowed: false,
            reason: `estimated ${est} min exceeds available ${balanceMinutes} min`,
            balanceMinutes,
            floorMinutes: floor,
            estimatedMinutes: est,
            projectedMinutes: projected,
        };
    }

    return {
        allowed: true,
        balanceMinutes,
        floorMinutes: floor,
        estimatedMinutes: est,
        projectedMinutes: projected,
    };
}
