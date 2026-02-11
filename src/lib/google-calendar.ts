import { google } from "googleapis";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════
// GOOGLE CALENDAR INTEGRATION
// OAuth + FreeBusy + Event Creation
// ═══════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI!;

function getOAuth2Client() {
    return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// ─── OAUTH HELPERS ───

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
            google_access_token_encrypted: tokens.access_token,
            google_refresh_token_encrypted: tokens.refresh_token,
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

// ─── TOKEN MANAGEMENT ───

interface CalendarConfig {
    access_token: string;
    refresh_token: string | null;
    calendar_id: string;
    token_expires_at: string | null;
    default_duration_minutes: number;
    buffer_minutes: number;
    booking_window_days: number;
}

async function getCalendarConfig(clientId: string): Promise<CalendarConfig | null> {
    const { data, error } = await supabase
        .from("tenant_google_calendar")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .single();

    if (error || !data) return null;

    return {
        access_token: data.google_access_token_encrypted,
        refresh_token: data.google_refresh_token_encrypted,
        calendar_id: data.google_calendar_id || "primary",
        token_expires_at: data.token_expires_at,
        default_duration_minutes: data.default_duration_minutes || 60,
        buffer_minutes: data.buffer_minutes || 15,
        booking_window_days: data.booking_window_days || 14,
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
            // Update stored tokens
            await supabase
                .from("tenant_google_calendar")
                .update({
                    google_access_token_encrypted: credentials.access_token,
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

// ─── CALENDAR OPERATIONS ───

export async function getAvailableSlots(
    clientId: string,
    preferredDate?: string,
    durationMinutes?: number
): Promise<{ slots: string[]; formatted: string } | null> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) return null;

    const { oauth2Client, config } = authResult;
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const duration = durationMinutes || config.default_duration_minutes;
    const buffer = config.buffer_minutes;

    // Determine date range
    const startDate = preferredDate ? new Date(preferredDate) : new Date();
    if (startDate < new Date()) {
        startDate.setTime(Date.now());
    }
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (preferredDate ? 1 : config.booking_window_days));

    // Get busy times
    const freeBusy = await calendar.freebusy.query({
        requestBody: {
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            items: [{ id: config.calendar_id }],
        },
    });

    const busySlots =
        freeBusy.data.calendars?.[config.calendar_id]?.busy || [];

    // Generate available slots (9 AM to 5 PM, every hour)
    const available: Date[] = [];
    const current = new Date(startDate);

    while (current < endDate && available.length < 6) {
        // Skip weekends
        if (current.getDay() === 0 || current.getDay() === 6) {
            current.setDate(current.getDate() + 1);
            current.setHours(9, 0, 0, 0);
            continue;
        }

        // Business hours: 9 AM - 5 PM
        if (current.getHours() < 9) {
            current.setHours(9, 0, 0, 0);
        }
        if (current.getHours() >= 17) {
            current.setDate(current.getDate() + 1);
            current.setHours(9, 0, 0, 0);
            continue;
        }

        // Skip past times
        if (current < new Date()) {
            current.setHours(current.getHours() + 1, 0, 0, 0);
            continue;
        }

        const slotEnd = new Date(current.getTime() + duration * 60_000);
        const slotWithBuffer = new Date(slotEnd.getTime() + buffer * 60_000);

        // Check if slot conflicts with any busy time
        const isBusy = busySlots.some((busy) => {
            const busyStart = new Date(busy.start!);
            const busyEnd = new Date(busy.end!);
            return current < busyEnd && slotWithBuffer > busyStart;
        });

        if (!isBusy) {
            available.push(new Date(current));
        }

        current.setHours(current.getHours() + 1, 0, 0, 0);
    }

    // Format for voice
    const slots = available.map((d) => d.toISOString());
    const formatted = available
        .map((d) => formatDateForVoice(d))
        .join(", or ");

    return { slots, formatted: formatted || "No available slots found in the requested time range" };
}

export async function createEvent(
    clientId: string,
    params: {
        date: string;
        time: string;
        customerName: string;
        customerPhone: string;
        serviceType?: string;
        notes?: string;
    }
): Promise<{ success: boolean; eventId?: string; formatted?: string; error?: string }> {
    const authResult = await getAuthenticatedClient(clientId);
    if (!authResult) {
        return { success: false, error: "Google Calendar not connected" };
    }

    const { oauth2Client, config } = authResult;
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Parse date and time
    const startDateTime = new Date(`${params.date}T${params.time}:00`);
    const endDateTime = new Date(
        startDateTime.getTime() + config.default_duration_minutes * 60_000
    );

    const event = await calendar.events.insert({
        calendarId: config.calendar_id,
        requestBody: {
            summary: `${params.serviceType || "Appointment"} - ${params.customerName}`,
            description: [
                `Customer: ${params.customerName}`,
                `Phone: ${params.customerPhone}`,
                params.serviceType ? `Service: ${params.serviceType}` : "",
                params.notes ? `Notes: ${params.notes}` : "",
                "",
                "Booked via AI Assistant",
            ]
                .filter(Boolean)
                .join("\n"),
            start: { dateTime: startDateTime.toISOString() },
            end: { dateTime: endDateTime.toISOString() },
        },
    });

    return {
        success: true,
        eventId: event.data.id || undefined,
        formatted: `${formatDateForVoice(startDateTime)} for ${config.default_duration_minutes} minutes`,
    };
}

// ─── FORMATTING ───

function formatDateForVoice(date: Date): string {
    const days = [
        "Sunday", "Monday", "Tuesday", "Wednesday",
        "Thursday", "Friday", "Saturday",
    ];
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const dayNum = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
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

// ─── CONNECTION STATUS ───

export async function getCalendarConnectionStatus(clientId: string) {
    const { data } = await supabase
        .from("tenant_google_calendar")
        .select("is_active, connected_at, google_calendar_id, default_duration_minutes, buffer_minutes, booking_window_days")
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
