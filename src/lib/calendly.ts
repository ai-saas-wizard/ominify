import "server-only";
import crypto from "crypto";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt } from "@/lib/encryption-helpers";

// ═══════════════════════════════════════════════════════════
// CALENDLY INTEGRATION (Personal Access Token auth)
// ═══════════════════════════════════════════════════════════

const CALENDLY_API = "https://api.calendly.com";
const DEFAULT_TIMEZONE = "America/New_York";
const AVAILABILITY_WINDOW_DAYS = 7; // Calendly caps /event_type_available_times at 7 days per call.

// ─── Calendly API shapes (minimal, only what we use) ───

interface CalendlyUser {
    uri: string;
    name: string;
    email: string;
    current_organization: string;
    scheduling_url: string;
    timezone: string;
}

export interface CalendlyEventType {
    uri: string;
    name: string;
    duration: number;
    active: boolean;
    scheduling_url: string;
    kind: string; // "solo" | "group"
}

interface CalendlyAvailableTime {
    status: "available";
    invitees_remaining: number;
    start_time: string; // ISO UTC
    scheduling_url: string;
}

interface CalendlyInvitee {
    uri: string;
    event: string; // scheduled_event URI
    name: string;
    email: string;
    status: "active" | "canceled";
    cancel_url: string;
    reschedule_url: string;
    timezone: string;
}

export type AppointmentStatus =
    | "booked"
    | "cancelled"
    | "rescheduled"
    | "failed"
    | "no_show";

export interface AppointmentSummary {
    id: string;
    calendlyEventUri: string | null;
    calendlyInviteeUri: string | null;
    scheduledAt: string;
    scheduledAtLocal: string;
    durationMinutes: number;
    status: AppointmentStatus;
    serviceType: string | null;
}

// ═══════════════════════════════════════════════════════════
// HTTP HELPER
// ═══════════════════════════════════════════════════════════

async function calendlyFetch<T>(
    pat: string,
    path: string,
    init: RequestInit = {}
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    const res = await fetch(`${CALENDLY_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${pat}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
        cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = { raw: text };
    }

    if (!res.ok) {
        const err = parsed as { message?: string; title?: string; details?: unknown };
        const message =
            err?.message || err?.title || `Calendly API ${res.status}`;
        return { ok: false, status: res.status, error: message };
    }

    return { ok: true, data: parsed as T };
}

// ═══════════════════════════════════════════════════════════
// CONNECTION HELPERS
// ═══════════════════════════════════════════════════════════

/** Validate a PAT by calling /users/me. Returns resolved identity. */
export async function testConnection(pat: string) {
    const res = await calendlyFetch<{ resource: CalendlyUser }>(pat, "/users/me");
    if (!res.ok) {
        return {
            success: false as const,
            error:
                res.status === 401
                    ? "Invalid Calendly API key. Double-check you copied it correctly."
                    : res.error,
        };
    }
    return { success: true as const, user: res.data.resource };
}

/**
 * Store the connection and register a webhook subscription.
 * Idempotent: re-connecting replaces the prior PAT and webhook.
 */
export async function saveConnection(
    clientId: string,
    pat: string
): Promise<
    | { success: true; user: CalendlyUser; webhookOk: boolean; webhookError?: string }
    | { success: false; error: string }
> {
    const test = await testConnection(pat);
    if (!test.success) return { success: false, error: test.error };

    // If a prior webhook exists, delete it before registering a new one.
    const { data: prior } = await supabase
        .from("tenant_calendly")
        .select("webhook_subscription_uri, calendly_pat_encrypted")
        .eq("client_id", clientId)
        .single();

    if (prior?.webhook_subscription_uri) {
        const priorPat = safeDecrypt(prior.calendly_pat_encrypted);
        if (priorPat) {
            const uuid = extractUuid(prior.webhook_subscription_uri);
            if (uuid) {
                await calendlyFetch(priorPat, `/webhook_subscriptions/${uuid}`, {
                    method: "DELETE",
                });
            }
        }
    }

    // Register new webhook subscription.
    const webhookBaseUrl = process.env.CALENDLY_WEBHOOK_BASE_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || "";
    const webhookUrl = `${webhookBaseUrl.replace(/\/$/, "")}/api/integrations/calendly/webhook?clientId=${clientId}`;

    const webhookRes = await calendlyFetch<{
        resource: { uri: string };
    }>(pat, "/webhook_subscriptions", {
        method: "POST",
        body: JSON.stringify({
            url: webhookUrl,
            events: ["invitee.created", "invitee.canceled"],
            user: test.user.uri,
            scope: "user",
        }),
    });

    // Calendly returns the signing key only in the create response, not in list/get.
    // If create failed, proceed anyway — webhooks are optional; bookings still work.
    const webhookSigningKey =
        webhookRes.ok
            ? ((webhookRes.data as { resource: { signing_key?: string } }).resource
                .signing_key || null)
            : null;

    const webhookUri = webhookRes.ok ? webhookRes.data.resource.uri : null;

    const { error } = await supabase.from("tenant_calendly").upsert(
        {
            client_id: clientId,
            calendly_pat_encrypted: encrypt(pat),
            calendly_user_uri: test.user.uri,
            calendly_organization_uri: test.user.current_organization,
            calendly_user_email: test.user.email,
            calendly_user_name: test.user.name,
            webhook_subscription_uri: webhookUri,
            webhook_signing_key_encrypted: webhookSigningKey
                ? encrypt(webhookSigningKey)
                : null,
            is_active: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" }
    );

    if (error) {
        console.error("[CALENDLY] Failed to save connection:", error);
        return { success: false, error: "Failed to save connection" };
    }

    return {
        success: true,
        user: test.user,
        webhookOk: webhookRes.ok,
        webhookError: webhookRes.ok ? undefined : webhookRes.error,
    };
}

/** List active event types for the connected user. */
export async function listEventTypes(clientId: string): Promise<CalendlyEventType[]> {
    const config = await getCalendlyConfig(clientId);
    if (!config) return [];

    const res = await calendlyFetch<{ collection: CalendlyEventType[] }>(
        config.pat,
        `/event_types?user=${encodeURIComponent(config.userUri)}&active=true`
    );
    if (!res.ok) return [];
    return res.data.collection;
}

/** Persist the user's choice of which Event Type the AI agent will book into. */
export async function setEventType(
    clientId: string,
    eventTypeUri: string
): Promise<{ success: boolean; error?: string }> {
    const config = await getCalendlyConfig(clientId);
    if (!config) return { success: false, error: "Calendly not connected" };

    const res = await calendlyFetch<{ resource: CalendlyEventType }>(
        config.pat,
        `/event_types/${extractUuid(eventTypeUri)}`
    );
    if (!res.ok) return { success: false, error: res.error };

    const et = res.data.resource;
    const { error } = await supabase
        .from("tenant_calendly")
        .update({
            selected_event_type_uri: et.uri,
            selected_event_type_name: et.name,
            selected_event_type_duration: et.duration,
            selected_event_type_scheduling_url: et.scheduling_url,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return { success: !error, error: error?.message };
}

export async function getCalendlyConnectionStatus(clientId: string) {
    const { data } = await supabase
        .from("tenant_calendly")
        .select(
            "is_active, connected_at, calendly_user_email, calendly_user_name, selected_event_type_uri, selected_event_type_name, selected_event_type_duration, booking_window_days"
        )
        .eq("client_id", clientId)
        .single();
    return data;
}

export async function disconnectCalendly(clientId: string): Promise<boolean> {
    const { data: prior } = await supabase
        .from("tenant_calendly")
        .select("webhook_subscription_uri, calendly_pat_encrypted")
        .eq("client_id", clientId)
        .single();

    if (prior?.webhook_subscription_uri) {
        const priorPat = safeDecrypt(prior.calendly_pat_encrypted);
        const uuid = extractUuid(prior.webhook_subscription_uri);
        if (priorPat && uuid) {
            await calendlyFetch(priorPat, `/webhook_subscriptions/${uuid}`, {
                method: "DELETE",
            });
        }
    }

    const { error } = await supabase
        .from("tenant_calendly")
        .update({
            is_active: false,
            calendly_pat_encrypted: "",
            webhook_subscription_uri: null,
            webhook_signing_key_encrypted: null,
            selected_event_type_uri: null,
            selected_event_type_name: null,
            selected_event_type_duration: null,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return !error;
}

// ═══════════════════════════════════════════════════════════
// TOKEN / CONFIG LOOKUP
// ═══════════════════════════════════════════════════════════

interface CalendlyConfig {
    pat: string;
    userUri: string;
    organizationUri: string;
    eventTypeUri: string | null;
    eventTypeDurationMinutes: number;
    bookingWindowDays: number;
}

async function getCalendlyConfig(clientId: string): Promise<CalendlyConfig | null> {
    const { data } = await supabase
        .from("tenant_calendly")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .single();

    if (!data) return null;
    const pat = safeDecrypt(data.calendly_pat_encrypted);
    if (!pat) return null;

    return {
        pat,
        userUri: data.calendly_user_uri,
        organizationUri: data.calendly_organization_uri,
        eventTypeUri: data.selected_event_type_uri,
        eventTypeDurationMinutes: data.selected_event_type_duration || 30,
        bookingWindowDays: data.booking_window_days || 14,
    };
}

/** Fast check used by the VAPI dispatch layer. */
export async function isCalendlyActive(clientId: string): Promise<boolean> {
    const { data } = await supabase
        .from("tenant_calendly")
        .select("is_active, selected_event_type_uri")
        .eq("client_id", clientId)
        .single();
    return !!(data?.is_active && data?.selected_event_type_uri);
}

// ═══════════════════════════════════════════════════════════
// INTERNAL HELPERS
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
        console.warn("[CALENDLY] Failed to read tenant timezone:", err);
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

function extractUuid(uri: string): string | null {
    // Calendly URIs end with the resource UUID: .../webhook_subscriptions/{uuid}
    const match = uri.match(/\/([0-9a-fA-F-]{36})$/);
    return match ? match[1] : null;
}

/**
 * Calendly requires an email on every invitee, but voice callers often won't
 * volunteer one. Synthesize a deliverable-looking placeholder from the E.164
 * phone so the booking still goes through. The real contact data stays in our
 * own appointments table; the phone is also appended to the invitee name so
 * the Calendly user sees it in their dashboard.
 *
 * The domain uses RFC 2606's reserved `.invalid` TLD — guaranteed never to
 * resolve, so Calendly confirmation emails hard-fail at DNS instead of
 * bouncing through a real mail server. If Calendly rejects `.invalid`, set
 * CALENDLY_PHONE_FALLBACK_DOMAIN to a domain you control.
 */
function synthEmailFromPhone(phoneE164: string): string {
    const domain = process.env.CALENDLY_PHONE_FALLBACK_DOMAIN || "voice-booking.invalid";
    const local = phoneE164.replace(/\D+/g, "") || "unknown";
    return `voice-${local}@${domain}`;
}

function formatPhoneForDisplay(phoneE164: string): string {
    // +15551234567 → (555) 123-4567  for US numbers; passthrough otherwise.
    const digits = phoneE164.replace(/\D+/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phoneE164;
}

// ═══════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════

export async function getAvailableSlots(
    clientId: string,
    opts: {
        preferredDate?: string;
        daysAhead?: number;
        timeOfDay?: "morning" | "afternoon" | "evening" | "any";
        earliestTime?: string; // HH:MM
        latestTime?: string;   // HH:MM
    } = {}
): Promise<{ slots: string[]; formatted: string } | null> {
    const config = await getCalendlyConfig(clientId);
    if (!config || !config.eventTypeUri) return null;

    const tz = await getTenantTimezone(clientId);

    const daysAhead = opts.preferredDate
        ? 1
        : Math.min(opts.daysAhead ?? config.bookingWindowDays, 60);

    // Scan in 7-day chunks (Calendly's per-request cap).
    const now = new Date();
    const startOfScanLocal = opts.preferredDate
        ? new Date(`${opts.preferredDate}T00:00:00Z`)
        : now;

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

    const collected: Date[] = [];

    for (let offset = 0; offset < daysAhead && collected.length < 6; offset += AVAILABILITY_WINDOW_DAYS) {
        const windowStart = new Date(startOfScanLocal.getTime() + offset * 24 * 60 * 60 * 1000);
        // Calendly requires start_time to be in the future.
        const queryStart = windowStart.getTime() > now.getTime() ? windowStart : now;
        const windowEnd = new Date(queryStart.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        const res = await calendlyFetch<{ collection: CalendlyAvailableTime[] }>(
            config.pat,
            `/event_type_available_times?event_type=${encodeURIComponent(config.eventTypeUri)}&start_time=${queryStart.toISOString()}&end_time=${windowEnd.toISOString()}`
        );

        if (!res.ok) {
            console.warn("[CALENDLY] Availability query failed:", res.error);
            break;
        }

        for (const slot of res.data.collection) {
            const slotInstant = new Date(slot.start_time);
            const localHHMM = formatInTimeZone(slotInstant, tz, "HH:mm");
            const slotMin = timeStringToMinutes(localHHMM);

            if (todWindow && (slotMin < todWindow.startMin || slotMin >= todWindow.endMin)) continue;
            if (earliestMin !== null && slotMin < earliestMin) continue;
            if (latestMin !== null && slotMin + config.eventTypeDurationMinutes > latestMin) continue;

            collected.push(slotInstant);
            if (collected.length >= 6) break;
        }
    }

    const slots = collected.map((d) => d.toISOString());
    const formatted = collected.map((d) => formatDateForVoice(d, tz)).join(", or ");

    return {
        slots,
        formatted: formatted || "No available slots found in the requested time range",
    };
}

function timeStringToMinutes(t: string): number {
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    return h * 60 + (m || 0);
}

// ═══════════════════════════════════════════════════════════
// CREATE EVENT (Scheduling API)
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
    eventUri?: string;
    inviteeUri?: string;
    appointmentId?: string;
    formatted?: string;
    error?: string;
    code?: "duplicate" | "calendar_not_connected" | "no_event_type" | "conflict" | "paid_plan_required" | "unknown";
}> {
    const config = await getCalendlyConfig(clientId);
    if (!config) {
        return { success: false, error: "Calendly not connected", code: "calendar_not_connected" };
    }
    if (!config.eventTypeUri) {
        return {
            success: false,
            error: "No Calendly Event Type selected. Pick one in settings.",
            code: "no_event_type",
        };
    }

    const tz = params.timezone || (await getTenantTimezone(clientId));
    const phoneE164 = normalizeE164(params.customerPhone);
    const duration = config.eventTypeDurationMinutes;

    // If the caller didn't give an email, synthesize one from their phone so
    // the Calendly booking still completes. The real phone is appended to the
    // invitee name so the business owner sees it in the Calendly dashboard.
    const inviteeEmail = params.customerEmail || synthEmailFromPhone(phoneE164);
    const inviteeName = params.customerEmail
        ? params.customerName
        : `${params.customerName} — ${formatPhoneForDisplay(phoneE164)}`;

    // Build the start instant in the tenant/caller TZ.
    const startInstant = fromZonedDateTimeToUtc(params.date, params.time, tz);
    if (Number.isNaN(startInstant.getTime())) {
        return { success: false, error: "Invalid date/time", code: "unknown" };
    }

    // Duplicate guard — ±2h window against booked rows for the same caller.
    const dupWindowMs = 2 * 60 * 60 * 1000;
    const dupStart = new Date(startInstant.getTime() - dupWindowMs).toISOString();
    const dupEnd = new Date(startInstant.getTime() + dupWindowMs).toISOString();
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

    // POST /invitees (Scheduling API).
    const createRes = await calendlyFetch<{
        resource: CalendlyInvitee & { event_uri?: string };
    }>(config.pat, "/invitees", {
        method: "POST",
        body: JSON.stringify({
            event_type: config.eventTypeUri,
            start_time: startInstant.toISOString(),
            invitee: {
                name: inviteeName,
                email: inviteeEmail,
                timezone: tz,
            },
        }),
    });

    if (!createRes.ok) {
        // Calendly returns 403 "paid plan required" for free-tier accounts.
        const paidPlan = /paid|upgrade|plan/i.test(createRes.error);
        const conflict = /conflict|unavailable|taken/i.test(createRes.error);
        const code = paidPlan
            ? "paid_plan_required"
            : conflict
                ? "conflict"
                : "unknown";
        await persistFailedAppointment(clientId, params, phoneE164, startInstant, duration, tz, createRes.error);
        return { success: false, error: createRes.error, code };
    }

    const invitee = createRes.data.resource;
    const eventUri = invitee.event;
    const inviteeUri = invitee.uri;

    // Persist booked appointment.
    const { data: inserted, error: insertErr } = await supabase
        .from("appointments")
        .insert({
            client_id: clientId,
            vapi_call_id: params.vapiCallId || null,
            calendar_provider: "calendly",
            calendly_event_uri: eventUri,
            calendly_invitee_uri: inviteeUri,
            customer_name: params.customerName,
            customer_phone_e164: phoneE164,
            customer_email: params.customerEmail || null,
            service_type: params.serviceType || null,
            notes: params.notes || null,
            scheduled_at: startInstant.toISOString(),
            duration_minutes: duration,
            timezone: tz,
            status: "booked",
        })
        .select("id")
        .single();

    if (insertErr) {
        console.error("[CALENDLY] Failed to persist appointment:", insertErr);
    }

    return {
        success: true,
        eventUri,
        inviteeUri,
        appointmentId: inserted?.id as string | undefined,
        formatted: `${formatDateForVoice(startInstant, tz)} for ${duration} minutes`,
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
            calendar_provider: "calendly",
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
        console.error("[CALENDLY] Failed to persist failed appointment:", err);
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

    const { data } = await supabase
        .from("appointments")
        .select("id, calendly_event_uri, calendly_invitee_uri, scheduled_at, duration_minutes, status, service_type")
        .eq("client_id", clientId)
        .eq("customer_phone_e164", phoneE164)
        .in("status", ["booked", "rescheduled"])
        .order("scheduled_at", { ascending: true });

    if (!data) return { found: false, appointments: [] };

    const appointments: AppointmentSummary[] = data.map((row) => {
        const scheduledAt = new Date(row.scheduled_at as string);
        return {
            id: row.id as string,
            calendlyEventUri: (row.calendly_event_uri as string | null) ?? null,
            calendlyInviteeUri: (row.calendly_invitee_uri as string | null) ?? null,
            scheduledAt: scheduledAt.toISOString(),
            scheduledAtLocal: formatDateForVoice(scheduledAt, tz),
            durationMinutes: (row.duration_minutes as number) ?? 30,
            status: row.status as AppointmentStatus,
            serviceType: (row.service_type as string | null) ?? null,
        };
    });

    return { found: appointments.length > 0, appointments };
}

/**
 * Calendly's Scheduling API does not offer a direct reschedule endpoint —
 * Calendly's own UI deletes + re-books under the hood. We mirror that:
 * cancel the existing event, then POST a new invitee at the new time.
 */
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
    code?: "not_found" | "duplicate" | "calendar_not_connected" | "no_event_type" | "conflict" | "paid_plan_required" | "unknown";
}> {
    const lookup = await lookupAppointmentByPhone(clientId, phone);
    if (!lookup.found) {
        return { success: false, error: "No upcoming appointment found", code: "not_found" };
    }

    const target = lookup.appointments.find((a) => new Date(a.scheduledAt).getTime() > Date.now())
        || lookup.appointments[0];

    // Pull original booking data so we can recreate with the same identity.
    // Email is optional — createEvent() will synthesize one from phone if missing.
    const { data: existing } = await supabase
        .from("appointments")
        .select("customer_name, customer_email, service_type, notes, vapi_call_id")
        .eq("id", target.id)
        .single();

    if (!existing) {
        return { success: false, error: "Appointment record not found", code: "not_found" };
    }

    // Best-effort cancel of the old Calendly event.
    const cancelledOk = await cancelCalendlyEvent(
        clientId,
        target.calendlyEventUri,
        "Rescheduled by the caller"
    );
    if (!cancelledOk && target.calendlyEventUri) {
        console.warn("[CALENDLY] Reschedule: failed to cancel old event, continuing");
    }

    await supabase
        .from("appointments")
        .update({
            status: "rescheduled",
            updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);

    // Book the new slot.
    const booked = await createEvent(clientId, {
        date: newDate,
        time: newTime,
        customerName: existing.customer_name as string,
        customerPhone: phone,
        customerEmail: (existing.customer_email as string | null) || undefined,
        timezone,
        serviceType: (existing.service_type as string | null) || undefined,
        notes: (existing.notes as string | null) || undefined,
        vapiCallId: (existing.vapi_call_id as string | null) || undefined,
    });

    if (!booked.success) {
        return {
            success: false,
            error: booked.error || "Failed to book new time",
            code: (booked.code as "duplicate" | "conflict" | "paid_plan_required" | "unknown") || "unknown",
        };
    }

    return { success: true, formatted: booked.formatted };
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
    const config = await getCalendlyConfig(clientId);
    if (!config) {
        return { success: false, error: "Calendly not connected", code: "calendar_not_connected" };
    }

    const lookup = await lookupAppointmentByPhone(clientId, phone);
    if (!lookup.found) {
        return { success: false, error: "No upcoming appointment found", code: "not_found" };
    }

    let cancelledCount = 0;
    for (const appt of lookup.appointments) {
        const cancelOk = await cancelCalendlyEvent(clientId, appt.calendlyEventUri, "Cancelled by the caller");
        if (!cancelOk && appt.calendlyEventUri) {
            console.warn("[CALENDLY] Failed to cancel event, marking DB row anyway:", appt.id);
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

async function cancelCalendlyEvent(
    clientId: string,
    eventUri: string | null,
    reason: string
): Promise<boolean> {
    if (!eventUri) return false;
    const config = await getCalendlyConfig(clientId);
    if (!config) return false;
    const uuid = extractUuid(eventUri);
    if (!uuid) return false;

    const res = await calendlyFetch(
        config.pat,
        `/scheduled_events/${uuid}/cancellation`,
        {
            method: "POST",
            body: JSON.stringify({ reason }),
        }
    );
    return res.ok;
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════

/**
 * Verify a Calendly webhook signature per their docs:
 * Header `Calendly-Webhook-Signature` is `t=TIMESTAMP,v1=HEX_HMAC`.
 * HMAC-SHA256 of `TIMESTAMP + "." + raw_body` using the subscription's signing_key.
 */
export function verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
    signingKey: string
): boolean {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(
        signatureHeader.split(",").map((kv) => kv.split("=").map((s) => s.trim()))
    ) as { t?: string; v1?: string };

    if (!parts.t || !parts.v1) return false;

    const payload = `${parts.t}.${rawBody}`;
    const expected = crypto
        .createHmac("sha256", signingKey)
        .update(payload)
        .digest("hex");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected, "hex"),
            Buffer.from(parts.v1, "hex")
        );
    } catch {
        return false;
    }
}

export async function getWebhookSigningKey(clientId: string): Promise<string | null> {
    const { data } = await supabase
        .from("tenant_calendly")
        .select("webhook_signing_key_encrypted")
        .eq("client_id", clientId)
        .single();
    return safeDecrypt(data?.webhook_signing_key_encrypted);
}

// ═══════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════

function fromZonedDateTimeToUtc(dateYmd: string, timeHm: string, tz: string): Date {
    return fromZonedTime(`${dateYmd}T${timeHm}:00`, tz);
}

function formatDateForVoice(date: Date, tz: string = DEFAULT_TIMEZONE): string {
    const days = [
        "Sunday", "Monday", "Tuesday", "Wednesday",
        "Thursday", "Friday", "Saturday",
    ];
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

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
