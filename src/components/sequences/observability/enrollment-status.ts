/**
 * Enrollment status → dot / text / progress-bar styling, shared by the lead
 * list, the KPI strip and the journey header so one lead never reads as two
 * different states across the page.
 *
 * One hue per meaning, taken from the sequence detail design:
 *   emerald → running normally (the healthy default, so it dominates the page)
 *   blue    → the lead answered
 *   violet  → the lead booked
 *   amber   → paused
 *   red     → failed
 *   neutral → finished or removed, nothing left to watch
 *
 * A dynamic enrollment spends most of its life in awaiting_outcome /
 * generating_next_step, so those read as running rather than as a state of
 * their own — otherwise a healthy campaign looks like it is doing nothing.
 */
export const ENROLLMENT_STATUS: Record<
    string,
    { dot: string; text: string; bar: string }
> = {
    active: { dot: "bg-emerald-500", text: "text-emerald-700", bar: "bg-emerald-500" },
    awaiting_outcome: {
        dot: "bg-emerald-500",
        text: "text-emerald-700",
        bar: "bg-emerald-500",
    },
    generating_next_step: {
        dot: "bg-emerald-500",
        text: "text-emerald-700",
        bar: "bg-emerald-500",
    },
    replied: { dot: "bg-blue-600", text: "text-blue-700", bar: "bg-blue-600" },
    booked: { dot: "bg-violet-600", text: "text-violet-700", bar: "bg-violet-600" },
    paused: { dot: "bg-amber-500", text: "text-amber-700", bar: "bg-amber-500" },
    failed: { dot: "bg-red-500", text: "text-red-700", bar: "bg-red-500" },
    completed: { dot: "bg-gray-400", text: "text-gray-600", bar: "bg-gray-400" },
    unenrolled: { dot: "bg-gray-300", text: "text-gray-500", bar: "bg-gray-300" },
    manual_stop: { dot: "bg-gray-300", text: "text-gray-500", bar: "bg-gray-300" },
};

export const STATUS_LABELS: Record<string, string> = {
    awaiting_outcome: "awaiting outcome",
    generating_next_step: "thinking...",
    manual_stop: "stopped",
};

/**
 * The statuses that count as "still running". Kept in one place because
 * counting only status='active' makes a live dynamic sequence report zero
 * active leads.
 */
export const IN_FLIGHT_STATUSES = [
    "active",
    "awaiting_outcome",
    "generating_next_step",
] as const;

export function isInFlight(status: string): boolean {
    return (IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}
