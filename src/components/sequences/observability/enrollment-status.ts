/**
 * Enrollment status → dot / text / progress-bar styling, shared by the lead
 * list, the journey header and the KPI strip so one lead never reads as two
 * different states across the page.
 *
 * Dynamic enrollments spend most of their life awaiting an outcome or
 * generating the next step — those are in-flight (sky). Terminal outcomes stay
 * neutral ink; only paused/failed carry warning/error color.
 */
export const ENROLLMENT_STATUS: Record<
    string,
    { dot: string; text: string; bar: string }
> = {
    active: { dot: "bg-sky-500", text: "text-sky-700", bar: "bg-sky-500" },
    awaiting_outcome: { dot: "bg-sky-500", text: "text-sky-700", bar: "bg-sky-500" },
    generating_next_step: { dot: "bg-sky-500", text: "text-sky-700", bar: "bg-sky-500" },
    paused: { dot: "bg-amber-500", text: "text-amber-700", bar: "bg-amber-500" },
    completed: { dot: "bg-gray-900", text: "text-gray-700", bar: "bg-gray-400" },
    replied: { dot: "bg-gray-900", text: "text-gray-700", bar: "bg-gray-400" },
    booked: { dot: "bg-gray-900", text: "text-gray-700", bar: "bg-gray-400" },
    failed: { dot: "bg-red-500", text: "text-red-700", bar: "bg-red-500" },
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
