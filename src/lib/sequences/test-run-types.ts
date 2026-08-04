/**
 * Shared types for the "Test now" pre-flight and post-flight panels.
 *
 * Deliberately a plain module — no "use server", no "server-only". The dialog
 * is a client component and needs these shapes, while the queries that produce
 * them live in server actions.
 */

export type TestChannel = "sms" | "email" | "voice";

export interface PreflightIssue {
    kind: TestChannel | "sequence" | "billing";
    /** Short headline, e.g. "SMS not configured". */
    title: string;
    /** The actionable reason. */
    detail: string;
    fixHref?: string;
    fixLabel?: string;
}

export interface TestPreflight {
    sequenceName: string;
    isActive: boolean;
    generationMode: "static" | "dynamic" | null;
    stepCount: number;
    /** Channels this sequence will actually try to use. */
    channels: TestChannel[];
    readiness: Record<TestChannel, { ready: boolean; reason?: string }>;
    /** Nothing will fire. */
    blockers: PreflightIssue[];
    /** Some steps will be skipped, but the test is still worth running. */
    warnings: PreflightIssue[];
}

export type TestEventSeverity = "ok" | "pending" | "warn" | "error";

export interface TestRunEvent {
    id: string;
    enrollmentId: string;
    channel: TestChannel | null;
    action: string;
    severity: TestEventSeverity;
    /** Plain-English explanation shown to the operator. */
    explanation: string;
    executedAt: string;
    stepOrder: number | null;
    fixHref?: string;
    fixLabel?: string;
}

export interface TestRunEnrollment {
    enrollmentId: string;
    status: string;
    currentStepOrder: number;
    nextStepAt: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
}

export interface TestRunStatus {
    enrollments: TestRunEnrollment[];
    events: TestRunEvent[];
    /** True once every enrollment has reached a terminal status. */
    settled: boolean;
}
