import "server-only";

// ═══════════════════════════════════════════════════════════
// Lightweight server-action rate limiter.
// ═══════════════════════════════════════════════════════════
// This is a process-local sliding-window counter. Good enough for a single
// Next.js instance and for preventing runaway per-user spam. Known limits:
//
//   - No cross-process coordination: behind multiple app instances each one
//     has its own counter, so the effective limit is N × window_limit.
//   - In-memory: state is lost on restart.
//
// When the app goes to prod behind a load balancer, swap the `buckets` map
// for `@upstash/ratelimit + @upstash/redis` keyed by the same shape. The
// `requireRateLimit(key, policy)` API is the stable surface callers depend on.

export type RatePolicy = {
    /** Max number of events in the window. */
    max: number;
    /** Window length in milliseconds. */
    windowMs: number;
};

export const RATE_POLICIES = {
    /** General admin write operations (create/update/delete). */
    adminWrite: { max: 10, windowMs: 60 * 1000 } satisfies RatePolicy,
    /** AI-powered onboarding — expensive, throttle aggressively. */
    aiOnboarding: { max: 5, windowMs: 10 * 60 * 1000 } satisfies RatePolicy,
    /** Credential/key rotation — very low cap. */
    keyRotation: { max: 3, windowMs: 60 * 60 * 1000 } satisfies RatePolicy,
    /** Webhook ingestion per source. */
    webhook: { max: 100, windowMs: 1000 } satisfies RatePolicy,
} as const;

export type PolicyName = keyof typeof RATE_POLICIES;

// Per-key history of event timestamps within the current window.
const buckets = new Map<string, number[]>();

// Lazy cleanup: every N operations, prune stale buckets so memory stays bounded.
let opCounter = 0;
const CLEANUP_EVERY = 500;

function maybeCleanup(now: number) {
    opCounter++;
    if (opCounter % CLEANUP_EVERY !== 0) return;
    for (const [k, stamps] of buckets.entries()) {
        // Assume the longest window is the onboarding one; drop any bucket
        // whose newest event is older than that window.
        const longest = RATE_POLICIES.keyRotation.windowMs;
        if (stamps.length === 0 || now - stamps[stamps.length - 1] > longest) {
            buckets.delete(k);
        }
    }
}

/**
 * Throws an Error if the caller has exceeded the policy for the given key.
 *
 * Key shape convention: `${userId}:${actionName}` or `${ip}:${actionName}`
 * for unauthenticated paths.
 */
export function requireRateLimit(key: string, policy: RatePolicy): void {
    const now = Date.now();
    const windowStart = now - policy.windowMs;
    const stamps = buckets.get(key) || [];

    // Drop anything outside the sliding window.
    const recent = stamps.filter((ts) => ts > windowStart);

    if (recent.length >= policy.max) {
        const oldest = recent[0];
        const retryAfterMs = oldest + policy.windowMs - now;
        throw new Error(
            `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
        );
    }

    recent.push(now);
    buckets.set(key, recent);
    maybeCleanup(now);
}

/**
 * Build a rate-limit key for a server action scoped to a user.
 * Returns `anonymous:<action>` if userId is null.
 */
export function userActionKey(userId: string | null | undefined, action: string): string {
    return `${userId || "anonymous"}:${action}`;
}
