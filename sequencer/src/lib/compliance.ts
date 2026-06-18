import { addDays } from 'date-fns';
import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';
import { TenantProfile } from './types.js';

/**
 * Shared TCPA / business-hours helpers.
 *
 * All computations use formatInTimeZone on real instants — never
 * utcToZonedTime followed by another timezone conversion, which
 * double-shifts and produced reschedules in the past (review C6/I7).
 *
 * Known limitation: windows are evaluated in the TENANT's timezone.
 * Contacts have no timezone field yet, so a tenant in one timezone
 * calling a lead in another can still fall outside the lead's local
 * 8am-9pm window.
 */

type DayHours = { start: string; end: string } | undefined;

const TCPA_EARLIEST = '08:00';
const TCPA_LATEST_HOUR = 21; // exclusive

/** Day-of-week (0=Sun..6=Sat) of an instant, in the given timezone. */
function dayOfWeekInZone(instant: Date, timezone: string): number {
    // 'i' = ISO day of week, Mon=1..Sun=7
    return parseInt(formatInTimeZone(instant, timezone, 'i'), 10) % 7;
}

function hoursForDay(businessHours: TenantProfile['business_hours'], day: number): DayHours {
    if (!businessHours) return { start: TCPA_EARLIEST, end: '21:00' };
    if (day === 0) return businessHours.sunday;
    if (day === 6) return businessHours.saturday;
    return businessHours.weekdays;
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
    if (!businessHours) return true;
    if (businessHours.emergency_24_7) return true;

    const day = dayOfWeekInZone(now, timezone);
    const currentTime = formatInTimeZone(now, timezone, 'HH:mm');
    const hours = hoursForDay(businessHours, day);
    if (!hours) return false;

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
    const is24x7 = businessHours?.emergency_24_7 === true;

    for (let i = 0; i < 8; i++) {
        const candidate = addDays(now, i);
        const dateStr = formatInTimeZone(candidate, timezone, 'yyyy-MM-dd');
        const day = dayOfWeekInZone(candidate, timezone);

        let hours = hoursForDay(businessHours, day);
        if (is24x7 && !hours) hours = { start: TCPA_EARLIEST, end: '21:00' };
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
