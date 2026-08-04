/**
 * Fast-test policy for `sequence_enrollments.is_test`.
 *
 * Test enrollments bypass business-hours/TCPA (scheduler-worker.ts) and
 * compress every wait so an operator can watch a whole sequence run inside one
 * sitting instead of over days.
 *
 * This lives here rather than in scheduler-worker.ts because the JIT/dynamic
 * path in dynamic-step-generator.ts needs the same policy, and types.ts is a
 * type-only module (every consumer imports it with `import type`, so a runtime
 * const there would be unimportable from those sites).
 */

/** Ceiling on any wait for a test enrollment. */
export const TEST_MODE_DELAY_SECONDS = 30;

/**
 * Clamp a delay for test enrollments. Only ever SHORTENS — never lengthens.
 *
 * `Math.min` rather than a flat assignment is deliberate: the dynamic step
 * generator's LLM emits `delay_seconds: 60-120` for the "SMS right after
 * voicemail" rule, and a flat 30 would *lengthen* a `delay_seconds: 0` step.
 */
export function clampTestDelaySeconds(delaySeconds: number, isTest: boolean): number {
    const base = Math.max(0, delaySeconds || 0);
    return isTest ? Math.min(base, TEST_MODE_DELAY_SECONDS) : base;
}

/** Same policy in milliseconds, for outcome_timeout_at / park windows. */
export function clampTestDelayMs(delayMs: number, isTest: boolean): number {
    const base = Math.max(0, delayMs || 0);
    return isTest ? Math.min(base, TEST_MODE_DELAY_SECONDS * 1000) : base;
}
