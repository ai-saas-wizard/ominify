import { addDays } from 'date-fns';
import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';
import { TenantProfile } from './types.js';

/**
 * Shared TCPA / business-hours / calling-window helpers.
 *
 * All computations use formatInTimeZone on real instants — never
 * utcToZonedTime followed by another timezone conversion, which
 * double-shifts and produced reschedules in the past (review C6/I7).
 *
 * business_hours arrives in TWO shapes and normalizeBusinessHours() accepts
 * both (see its doc comment). Anything with no usable day range — including
 * the `{}` that every onboarded tenant used to store — is treated as
 * UNCONFIGURED and fails OPEN: the TCPA 8am-9pm gate still bounds every call,
 * but dispatch no longer defers +24h forever. The one exception is a profile
 * where the operator EXPLICITLY closed days (closed: true) and left nothing
 * open — that is a deliberate shutdown and fails CLOSED.
 *
 * Known limitation: windows are evaluated in the TENANT's timezone.
 * Contacts have no timezone field yet, so a tenant in one timezone
 * calling a lead in another can still fall outside the lead's local
 * 8am-9pm window.
 */

type DayHours = { start: string; end: string } | undefined;

/** Per-day opening ranges, indexed 0=Sun .. 6=Sat. */
export interface NormalizedBusinessHours {
    byDay: DayHours[];
    emergency24x7: boolean;
    /** Operator explicitly closed days and left none open — never dial. */
    allClosed: boolean;
}

/** A per-sequence dialing window, already validated and in tenant-local time. */
export interface CallingWindow {
    start: string; // 'HH:MM'
    end: string;   // 'HH:MM'
    durationMinutes: number;
}

const TCPA_EARLIEST = '08:00';
const TCPA_LATEST_HOUR = 21; // exclusive

// Onboarding writes business_hours keyed by these abbreviations; index in this
// array is the JS day-of-week (0=Sun..6=Sat).
const ONBOARDING_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'H:MM' | 'HH:MM' | 'HH:MM:SS[.fff]' (Postgres TIME) → 'HH:MM'. Invalid → null. */
function toHHMM(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
    if (!match) return null;
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    // Postgres TIME allows '24:00:00' as an end-of-day bound.
    if (hour === 24 && minute === 0) return '23:59';
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/**
 * Push a reschedule target forward by a random offset so a batch of deferred
 * enrollments doesn't collapse onto one instant (the 8:00:00.000 stampede).
 * Spread over ~90% of the window when its duration is known, else 0-15min —
 * small enough that even a short configured window isn't jittered past close.
 */
export function withJitter(target: Date, windowMinutes: number | null = null): Date {
    const spreadMs =
        windowMinutes && windowMinutes > 0
            ? windowMinutes * 0.9 * 60_000
            : 15 * 60_000;
    return new Date(target.getTime() + Math.random() * spreadMs);
}

function minutesOfDay(hhmm: string): number {
    return parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10);
}

function coerceRange(start: unknown, end: unknown): DayHours {
    const s = toHHMM(start);
    const e = toHHMM(end);
    if (!s || !e || s >= e) return undefined;
    return { start: s, end: e };
}

/** Day-of-week (0=Sun..6=Sat) of an instant, in the given timezone. */
function dayOfWeekInZone(instant: Date, timezone: string): number {
    // 'i' = ISO day of week, Mon=1..Sun=7
    return parseInt(formatInTimeZone(instant, timezone, 'i'), 10) % 7;
}

/**
 * Normalize the two business_hours shapes in the wild into one per-day lookup:
 *
 *   sequencer shape:  { weekdays: {start,end}, saturday, sunday, emergency_24_7 }
 *   onboarding shape: { mon..sun: { open, close, closed } }
 *                     (src/components/onboarding/types.ts — this is what every
 *                     onboarded tenant actually has; the sequencer used to read
 *                     right past it and behave as if hours were `{}`)
 *
 * Per-day granularity from the onboarding shape is preserved — mon–fri are NOT
 * collapsed into a single `weekdays` range.
 *
 * Returns null when nothing usable is configured (`{}`, garbage times) —
 * callers treat null as "no restriction". A profile whose only recognized
 * configuration is explicitly-closed days returns allClosed: true instead:
 * that is a deliberate shutdown, not a misconfiguration.
 */
export function normalizeBusinessHours(businessHours: unknown): NormalizedBusinessHours | null {
    if (!businessHours || typeof businessHours !== 'object') return null;
    const raw = businessHours as Record<string, any>;

    const emergency24x7 = raw.emergency_24_7 === true;
    const byDay: DayHours[] = new Array(7).fill(undefined);
    let closedDays = 0;

    // ── Sequencer shape
    const weekdays = coerceRange(raw.weekdays?.start, raw.weekdays?.end);
    if (weekdays) {
        for (let day = 1; day <= 5; day++) byDay[day] = weekdays;
    }
    byDay[6] = coerceRange(raw.saturday?.start, raw.saturday?.end) ?? byDay[6];
    byDay[0] = coerceRange(raw.sunday?.start, raw.sunday?.end) ?? byDay[0];

    // ── Onboarding shape (wins per-day when present, since it is the more
    // specific configuration).
    ONBOARDING_DAY_KEYS.forEach((key, day) => {
        const entry = raw[key];
        if (!entry || typeof entry !== 'object') return;
        if (entry.closed === true) {
            byDay[day] = undefined;
            closedDays++;
            return;
        }
        const range = coerceRange(entry.open, entry.close);
        if (range) byDay[day] = range;
    });

    // Usability is derived from the merged result, never tracked per-branch —
    // a branch that opened a day the other branch closed must not count.
    const hasUsableDay = byDay.some(Boolean);

    if (!hasUsableDay && !emergency24x7) {
        // Operator explicitly closed days and opened none → honor the shutdown.
        if (closedDays > 0) return { byDay, emergency24x7: false, allClosed: true };
        return null;
    }
    return { byDay, emergency24x7, allClosed: false };
}

/** Current time is within the TCPA-compliant window (8am - 9pm local). */
export function isTCPACompliant(timezone: string, now: Date = new Date()): boolean {
    const hour = parseInt(formatInTimeZone(now, timezone, 'HH'), 10);
    return hour >= 8 && hour < TCPA_LATEST_HOUR;
}

/** Current time is within the tenant's configured business hours. */
export function isWithinBusinessHours(
    timezone: string,
    businessHours: TenantProfile['business_hours'],
    now: Date = new Date()
): boolean {
    const normalized = normalizeBusinessHours(businessHours);
    if (!normalized) return true;
    if (normalized.allClosed) return false;
    if (normalized.emergency24x7) return true;

    const hours = normalized.byDay[dayOfWeekInZone(now, timezone)];
    if (!hours) return false;

    const currentTime = formatInTimeZone(now, timezone, 'HH:mm');
    return currentTime >= hours.start && currentTime <= hours.end;
}

/**
 * Next instant at which the tenant's business-hours window opens,
 * honoring the per-day configured start times (clamped to the 8am TCPA
 * floor) and skipping closed days. Always strictly in the future.
 */
export function getNextBusinessHoursStart(
    timezone: string,
    businessHours: TenantProfile['business_hours'],
    now: Date = new Date()
): Date {
    const normalized = normalizeBusinessHours(businessHours);

    for (let i = 0; i < 8; i++) {
        const candidate = addDays(now, i);
        const dateStr = formatInTimeZone(candidate, timezone, 'yyyy-MM-dd');
        const day = dayOfWeekInZone(candidate, timezone);

        // Unconfigured hours fall back to the TCPA window itself, so an
        // onboarded tenant with `{}` opens tomorrow at 8am instead of being
        // pushed +24h on every single tick, forever. An explicit all-closed
        // shutdown keeps every day closed and lands on the +24h fallback.
        let hours: DayHours = normalized
            ? normalized.allClosed
                ? undefined
                : normalized.byDay[day]
            : { start: TCPA_EARLIEST, end: '21:00' };
        if (normalized?.emergency24x7 && !hours) hours = { start: TCPA_EARLIEST, end: '21:00' };
        if (!hours) continue; // closed that day

        const start = hours.start > TCPA_EARLIEST ? hours.start : TCPA_EARLIEST;
        const startUtc = zonedTimeToUtc(`${dateStr}T${start}:00`, timezone);
        if (startUtc.getTime() > now.getTime()) return startUtc;
    }

    // No configured window found in 8 days (misconfigured hours) —
    // fall back to 24h from now rather than looping hot.
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/** Next instant the TCPA window (8am local) opens. Strictly in the future. */
export function getNextTCPAWindow(timezone: string, now: Date = new Date()): Date {
    for (let i = 0; i < 2; i++) {
        const dateStr = formatInTimeZone(addDays(now, i), timezone, 'yyyy-MM-dd');
        const startUtc = zonedTimeToUtc(`${dateStr}T${TCPA_EARLIEST}:00`, timezone);
        if (startUtc.getTime() > now.getTime()) return startUtc;
    }
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Validate a sequence's calling_window_start/end pair (Postgres TIME strings).
 * Returns null when unset or unusable, in which case there is no per-sequence
 * window and only business hours + TCPA apply.
 */
export function parseCallingWindow(start: unknown, end: unknown): CallingWindow | null {
    const s = toHHMM(start);
    const e = toHHMM(end);
    if (!s || !e || s >= e) return null;
    return { start: s, end: e, durationMinutes: minutesOfDay(e) - minutesOfDay(s) };
}

/** Current tenant-local time falls inside the sequence's calling window. */
export function isWithinCallingWindow(
    timezone: string,
    window: CallingWindow,
    now: Date = new Date()
): boolean {
    const currentTime = formatInTimeZone(now, timezone, 'HH:mm');
    return currentTime >= window.start && currentTime < window.end;
}

/**
 * Day-of-week allow-list for dialing. Input is the stored TEXT[] of
 * 'sun'..'sat' keys; output is a Set of JS day indexes (0=Sun..6=Sat).
 * null = no restriction (unset, unrecognized, or all seven days).
 */
export function parseCallingDays(value: unknown): Set<number> | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const days = new Set<number>();
    for (const v of value) {
        const idx = ONBOARDING_DAY_KEYS.indexOf(String(v).toLowerCase());
        if (idx >= 0) days.add(idx);
    }
    if (days.size === 0 || days.size === 7) return null;
    return days;
}

/** Current tenant-local day is one the sequence may dial on. */
export function isCallingDayAllowed(
    timezone: string,
    days: Set<number> | null,
    now: Date = new Date()
): boolean {
    if (!days) return true;
    return days.has(dayOfWeekInZone(now, timezone));
}

/**
 * Next instant the sequence may dial again: the window's opening time (or the
 * 8am TCPA floor when no window is set) on the next allowed day. Strictly in
 * the future — called from inside today's window, this returns the NEXT
 * opening (exactly what the daily-cap defer wants). Scans two weeks so a
 * single-day-per-week schedule still resolves.
 */
export function getNextCallingWindowStart(
    timezone: string,
    window: CallingWindow | null,
    allowedDays: Set<number> | null = null,
    now: Date = new Date()
): Date {
    const start = window?.start && window.start > TCPA_EARLIEST ? window.start : TCPA_EARLIEST;
    for (let i = 0; i < 14; i++) {
        const candidate = addDays(now, i);
        if (allowedDays && !allowedDays.has(dayOfWeekInZone(candidate, timezone))) continue;
        const dateStr = formatInTimeZone(candidate, timezone, 'yyyy-MM-dd');
        const startUtc = zonedTimeToUtc(`${dateStr}T${start}:00`, timezone);
        if (startUtc.getTime() > now.getTime()) return startUtc;
    }
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
