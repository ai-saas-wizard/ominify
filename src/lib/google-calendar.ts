import "server-only";
import { google } from "googleapis";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt } from "@/lib/encryption-helpers";

// ═══════════════════════════════════════════════════════════
// GOOGLE CALENDAR INTEGRATION
// OAuth + FreeBusy + Event Creation + Appointment Persistence
// ═══════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI!;

const DEFAULT_TIMEZONE = "America/New_York";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

interface BusinessHourWindow {
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
}
type BusinessHoursMap = Partial<Record<WeekdayKey, BusinessHourWindow>>;

const DEFAULT_BUSINESS_HOURS: BusinessHoursMap = {
    mon: { start: "09:00", end: "17:00" },
    tue: { start: "09:00", end: "17:00" },
    wed: { start: "09:00", end: "17:00" },
    thu: { start: "09:00", end: "17:00" },
    fri: { start: "09:00", end: "17:00" },
};

// ═══════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════

export type AppointmentStatus =
    | "booked"
    | "cancelled"
    | "rescheduled"
    | "failed"
    | "no_show";

export interface AppointmentSummary {
    id: string;
    googleEventId: string | null;
    scheduledAt: string;        // ISO UTC
    scheduledAtLocal: string;   // human voice-friendly, in tenant TZ
    durationMinutes: number;
    status: AppointmentStatus;
    serviceType: string | null;
}

// ═══════════════════════════════════════════════════════════
// OAUTH HELPERS (preserved)
// ═══════════════════════════════════════════════════════════

function getOAuth2Client() {
    return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function getAuthorizationUrl(clientId: string): string {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
        ],
        state: clientId,
    });
}

export async function exchangeCodeForTokens(code: string, clientId: string) {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    const { error } = await supabase.from("tenant_google_calendar").upsert(
        {
            client_id: clientId,
            google_access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
            google_refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            google_calendar_id: "primary",
            token_expires_at: tokens.expiry_date
                ? new Date(tokens.expiry_date).toISOString()
                : null,
            is_active: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" }
    );

    if (error) {
        console.error("[GOOGLE CALENDAR] Failed to save tokens:", error);
        throw new Error("Failed to save calendar connection");
    }

    return tokens;
}

// ═══════════════════════════════════════════════════════════
// TOKEN / CONFIG MANAGEMENT
// ═══════════════════════════════════════════════════════════

interface CalendarConfig {
    access_token: string;
    refresh_token: string | null;
    calendar_id: string;
    token_expires_at: string | null;
    default_duration_minutes: number;
    buffer_minutes: number;
    booking_window_days: number;
    min_lead_minutes: number;
    business_hours: BusinessHoursMap;
}

async function getCalendarConfig(clientId: string): Promise<CalendarConfig | null> {
    const { data, error } = await supabase
        .from("tenant_google_calendar")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .single();

    if (error || !data) return null;

    const accessToken = safeDecrypt(data.google_access_token_encrypted);
    if (!accessToken) return null;

    let businessHours: BusinessHoursMap = DEFAULT_BUSINESS_HOURS;
    if (data.business_hours_json && typeof data.business_hours_json === "object") {
        businessHours = data.business_hours_json as BusinessHoursMap;
    }

    return {
        access_token: accessToken,
        refresh_token: safeDecrypt(data.google_refresh_token_encrypted),
        calendar_id: data.google_calendar_id || "primary",
        token_expires_at: data.token_expires_at,
        default_duration_minutes: data.default_duration_minutes || 60,
        buffer_minutes: data.buffer_minutes ?? 15,
        booking_window_days: data.booking_window_days || 14,
        min_lead_minutes: data.min_lead_minutes ?? 60,
        business_hours: businessHours,
    };
}

async function getAuthenticatedClient(clientId: string) {
    const config = await getCalendarConfig(clientId);
    if (!config) return null;

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: config.access_token,
        refresh_token: config.refresh_token,
    });

    // Check if token needs refresh
    const expiresAt = config.token_expires_at ? new Date(config.token_expires_at) : null;
    const isExpired = expiresAt && expiresAt.getTime() < Date.now() + 60_000; // 1 min buffer

    if (isExpired && config.refresh_token) {
        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            await supabase
                .from("tenant_google_calendar")
                .update({
                    google_access_token_encrypted: credentials.access_token
                        ? encrypt(credentials.access_token)
                        : null,
                    token_expires_at: credentials.expiry_date
                        ? new Date(credentials.expiry_date).toISOString()
                        : null,
                    updated_at: new Date().toISOString(),
                })
                .eq("client_id", clientId);

            oauth2Client.setCredentials(credentials);
        } catch (err) {
            console.error("[GOOGLE CALENDAR] Token refresh failed:", err);
            return null;
        }
    }

    return { oauth2Client, config };
}

// ═══════════════════════════════════════════════════════════
// INTERNAL HELPERS — TIMEZONE / PHONE / HOURS
// ═══════════════════════════════════════════════════════════

async function getTenantTimezone(clientId: string): Promise<string> {
    try {
        const { data } = await supabase
            .from("tenant_profiles")
            .select("timezone")
            .eq("client_id", clientId)
            .single();
        const tz = (data as { timezone?: string } | null)?.timezone;
        if (tz && typeof tz === "string" && tz.trim().length > 0) return tz;
    } catch (err) {
        console.warn("[GOOGLE CALENDAR] Failed to read tenant timezone:", err);
    }
    return DEFAULT_TIMEZONE;
}

function normalizeE164(phone: string): string {
    if (!phone) return "";
    const digits = phone.replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (phone.trim().startsWith("+")) return `+${digits}`;
    return `+${digits}`;
}

function weekdayKeyForZoned(date: Date, tz: string): WeekdayKey {
    // formatInTimeZone with "i" returns ISO weekday 1-7 (Mon-Sun)
    const isoWeekday = parseInt(formatInTimeZone(date, tz, "i"), 10); // 1=Mon..7=Sun
    const map: Record<number, WeekdayKey> = {
        1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun",
    };
    return map[isoWeekday];
}

function timeStringToMinutes(t: string): number {
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    return h * 60 + (m || 0);
}

function isWithinBusinessHours(
    instant: Date,
    durationMinutes: number,
    tz: string,
    hours: BusinessHoursMap
): boolean {
    const wkKey = weekdayKeyForZoned(instant, tz);
    const window = hours[wkKey];
    if (!window) return false;
    const startMin = timeStringToMinutes(window.start);
    const endMin = timeStringToMinutes(window.end);

    const localHM = formatInTimeZone(instant, tz, "HH:mm");
    const slotStartMin = timeStringToMinutes(localHM);
    const slotEndMin = slotStartMin + durationMinutes;

    return slotStartMin >= startMin && slotEndMin <= endMin;
}

/** Build a UTC Date for a tenant-local date+time. */
function localDateTimeToUtc(dateYmd: string, timeHm: string, tz: string): Date {
    return fromZonedTime(`${dateYmd}T${timeHm}:00`, tz);
}

// ═══════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════

export async function getAvailableSlots(
    clientId: string,
    opts: {
        preferredDate?: string;      // YYYY-MM-DD, interpreted in tenant TZ
        daysAhead?: number;          // how many days forward to scan
        durationMinutes?: number;
        timeOfDay?: "morning" | "afternoon" | "evening" | "any";
        earliestTime?: string;       // HH:MM in tenant TZ
        latestTime?: string;         // HH:MM in tenant TZ
    } = {}
): Promise<{ slots: string[]; formatted: string } | null> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) return null;

    const { oauth2Client, config } = authResult;
    const tz = await getTenantTimezone(clientId);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const duration = opts.durationMinutes || config.default_duration_minutes;
    const buffer = config.buffer_minutes;
    const minLead = config.min_lead_minutes;

    // Earliest instant we'd ever propose:
    const minStart = new Date(Date.now() + minLead * 60_000);

    // Determine scan window (in tenant-local days).
    const daysAhead = opts.preferredDate
        ? 1
        : (opts.daysAhead ?? config.booking_window_days);

    // Compute scan start at 00:00 tenant-local on either preferredDate or "today"
    const todayLocalYmd = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
    const startYmd = opts.preferredDate || todayLocalYmd;
    const scanStartUtc = fromZonedTime(`${startYmd}T00:00:00`, tz);

    // Scan end at 24:00 tenant-local on the last day
    const scanEndLocal = new Date(scanStartUtc.getTime());
    scanEndLocal.setUTCDate(scanEndLocal.getUTCDate() + daysAhead);

    // FreeBusy
    const freeBusy = await calendar.freebusy.query({
        requestBody: {
            timeMin: scanStartUtc.toISOString(),
            timeMax: scanEndLocal.toISOString(),
            items: [{ id: config.calendar_id }],
        },
    });
    const busySlots = freeBusy.data.calendars?.[config.calendar_id]?.busy || [];

    // Time-of-day filter window in local minutes
    const todWindow = (() => {
        switch (opts.timeOfDay) {
            case "morning":   return { startMin: 0,        endMin: 12 * 60 };
            case "afternoon": return { startMin: 12 * 60,  endMin: 17 * 60 };
            case "evening":   return { startMin: 17 * 60,  endMin: 24 * 60 };
            default:          return null;
        }
    })();

    const earliestMin = opts.earliestTime ? timeStringToMinutes(opts.earliestTime) : null;
    const latestMin = opts.latestTime ? timeStringToMinutes(opts.latestTime) : null;

    const available: Date[] = [];

    // Iterate day-by-day in tenant TZ.
    for (let dayOffset = 0; dayOffset < daysAhead && available.length < 6; dayOffset++) {
        // Compute the local YMD for this offset.
        const dayInstant = new Date(scanStartUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const dayYmd = formatInTimeZone(dayInstant, tz, "yyyy-MM-dd");
        const wkKey = weekdayKeyForZoned(dayInstant, tz);
        const window = config.business_hours[wkKey];
        if (!window) continue;

        const dayStartMin = timeStringToMinutes(window.start);
        const dayEndMin = timeStringToMinutes(window.end);

        // Iterate hourly slots inside window.
        for (let mins = dayStartMin; mins + duration <= dayEndMin; mins += 60) {
            // Apply optional filters
            if (todWindow && (mins < todWindow.startMin || mins >= todWindow.endMin)) continue;
            if (earliestMin !== null && mins < earliestMin) continue;
            if (latestMin !== null && mins + duration > latestMin) continue;

            const hh = String(Math.floor(mins / 60)).padStart(2, "0");
            const mm = String(mins % 60).padStart(2, "0");
            const slotStartUtc = localDateTimeToUtc(dayYmd, `${hh}:${mm}`, tz);
            if (slotStartUtc < minStart) continue;

            const slotEndUtc = new Date(slotStartUtc.getTime() + duration * 60_000);
            const slotEndWithBuffer = new Date(slotEndUtc.getTime() + buffer * 60_000);

            const isBusy = busySlots.some((busy) => {
                const busyStart = new Date(busy.start!);
                const busyEnd = new Date(busy.end!);
                return slotStartUtc < busyEnd && slotEndWithBuffer > busyStart;
            });
            if (isBusy) continue;

            available.push(slotStartUtc);
            if (available.length >= 6) break;
        }
    }

    const slots = available.map((d) => d.toISOString());
    const formatted = available
        .map((d) => formatDateForVoice(d, tz))
        .join(", or ");

    return {
        slots,
        formatted: formatted || "No available slots found in the requested time range",
    };
}

// ═══════════════════════════════════════════════════════════
// CREATE EVENT
// ═══════════════════════════════════════════════════════════

export async function createEvent(
    clientId: string,
    params: {
        date: string;
        time: string;
        customerName: string;
        customerPhone: string;
        customerEmail?: string;
        timezone?: string;
        serviceType?: string;
        notes?: string;
        vapiCallId?: string;
    }
): Promise<{
    success: boolean;
    eventId?: string;
    appointmentId?: string;
    formatted?: string;
    error?: string;
    code?: "duplicate" | "too_soon" | "calendar_not_connected" | "conflict" | "outside_hours" | "unknown";
}> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) {
        return { success: false, error: "Google Calendar not connected", code: "calendar_not_connected" };
    }

    const { oauth2Client, config } = authResult;
    const tz = params.timezone || (await getTenantTimezone(clientId));
    const phoneE164 = normalizeE164(params.customerPhone);
    const duration = config.default_duration_minutes;

    // Build the scheduled instant honoring tenant TZ.
    const scheduledAt = localDateTimeToUtc(params.date, params.time, tz);
    if (Number.isNaN(scheduledAt.getTime())) {
        return { success: false, error: "Invalid date/time", code: "unknown" };
    }
    const scheduledEnd = new Date(scheduledAt.getTime() + duration * 60_000);

    // Min lead-time guard
    const minLeadMs = config.min_lead_minutes * 60_000;
    if (scheduledAt.getTime() - Date.now() < minLeadMs) {
        await persistFailedAppointment(clientId, params, phoneE164, scheduledAt, duration, tz, "too_soon");
        return {
            success: false,
            error: `Bookings require at least ${config.min_lead_minutes} minutes lead time`,
            code: "too_soon",
        };
    }

    // Business-hours guard
    if (!isWithinBusinessHours(scheduledAt, duration, tz, config.business_hours)) {
        await persistFailedAppointment(clientId, params, phoneE164, scheduledAt, duration, tz, "outside_hours");
        return {
            success: false,
            error: "Requested time is outside configured business hours",
            code: "outside_hours",
        };
    }

    // Duplicate guard (±2h, same client + phone, status=booked)
    const dupWindowMs = 2 * 60 * 60 * 1000;
    const dupStart = new Date(scheduledAt.getTime() - dupWindowMs).toISOString();
    const dupEnd = new Date(scheduledAt.getTime() + dupWindowMs).toISOString();
    const { data: dupRows } = await supabase
        .from("appointments")
        .select("id")
        .eq("client_id", clientId)
        .eq("customer_phone_e164", phoneE164)
        .eq("status", "booked")
        .gte("scheduled_at", dupStart)
        .lte("scheduled_at", dupEnd)
        .limit(1);
    if (dupRows && dupRows.length > 0) {
        return {
            success: false,
            error: "An appointment for this caller already exists near that time",
            code: "duplicate",
        };
    }

    // Insert into Google Calendar
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    let eventId: string | undefined;
    try {
        const event = await calendar.events.insert({
            calendarId: config.calendar_id,
            requestBody: {
                summary: `${params.serviceType || "Appointment"} - ${params.customerName}`,
                description: [
                    `Customer: ${params.customerName}`,
                    `Phone: ${phoneE164}`,
                    params.customerEmail ? `Email: ${params.customerEmail}` : "",
                    params.serviceType ? `Service: ${params.serviceType}` : "",
                    params.notes ? `Notes: ${params.notes}` : "",
                    "",
                    "Booked via AI Assistant",
                ].filter(Boolean).join("\n"),
                start: { dateTime: scheduledAt.toISOString(), timeZone: tz },
                end: { dateTime: scheduledEnd.toISOString(), timeZone: tz },
            },
        });
        eventId = event.data.id || undefined;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown calendar error";
        const code: "conflict" | "unknown" = message.toLowerCase().includes("conflict") ? "conflict" : "unknown";
        await persistFailedAppointment(clientId, params, phoneE164, scheduledAt, duration, tz, message);
        return { success: false, error: message, code };
    }

    // Persist booked appointment
    const { data: inserted, error: insertErr } = await supabase
        .from("appointments")
        .insert({
            client_id: clientId,
            vapi_call_id: params.vapiCallId || null,
            google_event_id: eventId || null,
            customer_name: params.customerName,
            customer_phone_e164: phoneE164,
            customer_email: params.customerEmail || null,
            service_type: params.serviceType || null,
            notes: params.notes || null,
            scheduled_at: scheduledAt.toISOString(),
            duration_minutes: duration,
            timezone: tz,
            status: "booked",
        })
        .select("id")
        .single();

    if (insertErr) {
        console.error("[GOOGLE CALENDAR] Failed to persist appointment:", insertErr);
    }

    const appointmentId = inserted?.id as string | undefined;

    // Fire-and-forget notification (no await on purpose).
    if (appointmentId) {
        void sendBookingNotification(clientId, appointmentId);
    }

    return {
        success: true,
        eventId,
        appointmentId,
        formatted: `${formatDateForVoice(scheduledAt, tz)} for ${duration} minutes`,
    };
}

async function persistFailedAppointment(
    clientId: string,
    params: {
        customerName: string;
        customerEmail?: string;
        serviceType?: string;
        notes?: string;
        vapiCallId?: string;
    },
    phoneE164: string,
    scheduledAt: Date,
    duration: number,
    tz: string,
    reason: string
) {
    try {
        await supabase.from("appointments").insert({
            client_id: clientId,
            vapi_call_id: params.vapiCallId || null,
            google_event_id: null,
            customer_name: params.customerName,
            customer_phone_e164: phoneE164,
            customer_email: params.customerEmail || null,
            service_type: params.serviceType || null,
            notes: params.notes || null,
            scheduled_at: scheduledAt.toISOString(),
            duration_minutes: duration,
            timezone: tz,
            status: "failed",
            error_reason: reason,
        });
    } catch (err) {
        console.error("[GOOGLE CALENDAR] Failed to persist failed appointment:", err);
    }
}

// ═══════════════════════════════════════════════════════════
// LOOKUP / RESCHEDULE / CANCEL
// ═══════════════════════════════════════════════════════════

export async function lookupAppointmentByPhone(
    clientId: string,
    phone: string
): Promise<{ found: boolean; appointments: AppointmentSummary[] }> {
    const phoneE164 = normalizeE164(phone);
    const tz = await getTenantTimezone(clientId);

    const { data, error } = await supabase
        .from("appointments")
        .select("id, google_event_id, scheduled_at, duration_minutes, status, service_type")
        .eq("client_id", clientId)
        .eq("customer_phone_e164", phoneE164)
        .in("status", ["booked", "rescheduled"])
        .order("scheduled_at", { ascending: true });

    if (error || !data) return { found: false, appointments: [] };

    const appointments: AppointmentSummary[] = data.map((row) => {
        const scheduledAt = new Date(row.scheduled_at as string);
        return {
            id: row.id as string,
            googleEventId: (row.google_event_id as string | null) ?? null,
            scheduledAt: scheduledAt.toISOString(),
            scheduledAtLocal: formatDateForVoice(scheduledAt, tz),
            durationMinutes: (row.duration_minutes as number) ?? 60,
            status: row.status as AppointmentStatus,
            serviceType: (row.service_type as string | null) ?? null,
        };
    });

    return { found: appointments.length > 0, appointments };
}

export async function rescheduleEvent(
    clientId: string,
    phone: string,
    newDate: string,
    newTime: string,
    timezone?: string
): Promise<{
    success: boolean;
    formatted?: string;
    error?: string;
    code?: "not_found" | "duplicate" | "too_soon" | "calendar_not_connected" | "conflict" | "outside_hours" | "unknown";
}> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) {
        return { success: false, error: "Google Calendar not connected", code: "calendar_not_connected" };
    }
    const { oauth2Client, config } = authResult;
    const tz = timezone || (await getTenantTimezone(clientId));
    const phoneE164 = normalizeE164(phone);

    const lookup = await lookupAppointmentByPhone(clientId, phoneE164);
    if (!lookup.found) {
        return { success: false, error: "No upcoming appointment found for that phone", code: "not_found" };
    }

    // Reschedule the soonest upcoming appointment (it's already filtered to booked/rescheduled).
    const target = lookup.appointments.find((a) => new Date(a.scheduledAt).getTime() > Date.now())
        || lookup.appointments[0];

    const newStart = localDateTimeToUtc(newDate, newTime, tz);
    if (Number.isNaN(newStart.getTime())) {
        return { success: false, error: "Invalid date/time", code: "unknown" };
    }
    const duration = target.durationMinutes || config.default_duration_minutes;
    const newEnd = new Date(newStart.getTime() + duration * 60_000);

    if (newStart.getTime() - Date.now() < config.min_lead_minutes * 60_000) {
        return {
            success: false,
            error: `Bookings require at least ${config.min_lead_minutes} minutes lead time`,
            code: "too_soon",
        };
    }
    if (!isWithinBusinessHours(newStart, duration, tz, config.business_hours)) {
        return { success: false, error: "Requested time is outside configured business hours", code: "outside_hours" };
    }

    // Duplicate guard against OTHER appointments
    const dupWindowMs = 2 * 60 * 60 * 1000;
    const dupStart = new Date(newStart.getTime() - dupWindowMs).toISOString();
    const dupEnd = new Date(newStart.getTime() + dupWindowMs).toISOString();
    const { data: dupRows } = await supabase
        .from("appointments")
        .select("id")
        .eq("client_id", clientId)
        .eq("customer_phone_e164", phoneE164)
        .eq("status", "booked")
        .neq("id", target.id)
        .gte("scheduled_at", dupStart)
        .lte("scheduled_at", dupEnd)
        .limit(1);
    if (dupRows && dupRows.length > 0) {
        return { success: false, error: "Another appointment exists near that time", code: "duplicate" };
    }

    // Patch the Google event (if we have one).
    if (target.googleEventId) {
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        try {
            await calendar.events.patch({
                calendarId: config.calendar_id,
                eventId: target.googleEventId,
                requestBody: {
                    start: { dateTime: newStart.toISOString(), timeZone: tz },
                    end: { dateTime: newEnd.toISOString(), timeZone: tz },
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown calendar error";
            const code: "conflict" | "unknown" = message.toLowerCase().includes("conflict") ? "conflict" : "unknown";
            return { success: false, error: message, code };
        }
    }

    // Update DB row — keep status='booked', just shift scheduled_at.
    const { error: updateErr } = await supabase
        .from("appointments")
        .update({
            scheduled_at: newStart.toISOString(),
            status: "booked",
            updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);

    if (updateErr) {
        console.error("[GOOGLE CALENDAR] Failed to update rescheduled appointment:", updateErr);
        return { success: false, error: "Failed to update appointment record", code: "unknown" };
    }

    return {
        success: true,
        formatted: `${formatDateForVoice(newStart, tz)} for ${duration} minutes`,
    };
}

export async function cancelEvent(
    clientId: string,
    phone: string
): Promise<{
    success: boolean;
    cancelled?: number;
    error?: string;
    code?: "not_found" | "calendar_not_connected" | "unknown";
}> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) {
        return { success: false, error: "Google Calendar not connected", code: "calendar_not_connected" };
    }
    const { oauth2Client, config } = authResult;
    const phoneE164 = normalizeE164(phone);

    const lookup = await lookupAppointmentByPhone(clientId, phoneE164);
    if (!lookup.found) {
        return { success: false, error: "No upcoming appointment found", code: "not_found" };
    }

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    let cancelledCount = 0;

    for (const appt of lookup.appointments) {
        // Best-effort delete on Google side.
        if (appt.googleEventId) {
            try {
                await calendar.events.delete({
                    calendarId: config.calendar_id,
                    eventId: appt.googleEventId,
                });
            } catch (err) {
                console.warn("[GOOGLE CALENDAR] Event delete failed (continuing):", err);
            }
        }
        const { error: updateErr } = await supabase
            .from("appointments")
            .update({
                status: "cancelled",
                updated_at: new Date().toISOString(),
            })
            .eq("id", appt.id);
        if (!updateErr) cancelledCount++;
    }

    if (cancelledCount === 0) {
        return { success: false, error: "Failed to cancel any appointments", code: "unknown" };
    }

    return { success: true, cancelled: cancelledCount };
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATION (stub)
// ═══════════════════════════════════════════════════════════

// TODO: wire to Resend/Twilio
export async function sendBookingNotification(
    clientId: string,
    appointmentId: string
): Promise<void> {
    console.log("[NOTIFY]", { clientId, appointmentId });
}

// ═══════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════

function formatDateForVoice(date: Date, tz: string = DEFAULT_TIMEZONE): string {
    const days = [
        "Sunday", "Monday", "Tuesday", "Wednesday",
        "Thursday", "Friday", "Saturday",
    ];
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    // Convert UTC instant to wall-clock components in the tenant TZ.
    const zoned = toZonedTime(date, tz);
    const dayName = days[zoned.getDay()];
    const monthName = months[zoned.getMonth()];
    const dayNum = zoned.getDate();
    const hour = zoned.getHours();
    const minute = zoned.getMinutes();
    const period = hour >= 12 ? "PM" : "AM";
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

    const timeStr =
        minute === 0
            ? `${numberToWords(hour12)} ${period}`
            : `${numberToWords(hour12)} ${numberToWords(minute)} ${period}`;

    return `${dayName} ${monthName} ${numberToWords(dayNum)} at ${timeStr}`;
}

function numberToWords(n: number): string {
    const ones = [
        "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen",
    ];
    const tens = [
        "", "", "twenty", "thirty", "forty", "fifty",
    ];

    if (n < 20) return ones[n];
    if (n < 60) {
        const remainder = n % 10;
        return tens[Math.floor(n / 10)] + (remainder ? " " + ones[remainder] : "");
    }
    return String(n);
}

// ═══════════════════════════════════════════════════════════
// CONNECTION STATUS / SETTINGS (preserved)
// ═══════════════════════════════════════════════════════════

export async function getCalendarConnectionStatus(clientId: string) {
    const { data } = await supabase
        .from("tenant_google_calendar")
        .select(
            "is_active, connected_at, google_calendar_id, default_duration_minutes, buffer_minutes, booking_window_days, min_lead_minutes, business_hours_json"
        )
        .eq("client_id", clientId)
        .single();

    return data;
}

export async function disconnectCalendar(clientId: string) {
    const { error } = await supabase
        .from("tenant_google_calendar")
        .update({
            is_active: false,
            google_access_token_encrypted: null,
            google_refresh_token_encrypted: null,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return !error;
}

export async function updateCalendarSettings(
    clientId: string,
    settings: {
        default_duration_minutes?: number;
        buffer_minutes?: number;
        booking_window_days?: number;
        google_calendar_id?: string;
        min_lead_minutes?: number;
        business_hours_json?: BusinessHoursMap;
    }
) {
    const { error } = await supabase
        .from("tenant_google_calendar")
        .update({
            ...settings,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return !error;
}
