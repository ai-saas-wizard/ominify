import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyWebhookSignature } from "@/lib/calendly";

/**
 * Global onboarding Calendly webhook.
 *
 * Receives invitee.created/canceled/rescheduled events from Omnify's company
 * Calendly account (the team that runs white-glove onboarding calls).
 *
 * Distinct from the per-tenant Calendly webhook at
 * /api/integrations/calendly/webhook/route.ts which is for tenants connecting
 * their own Calendly accounts to drive their AI agents' calendars.
 *
 * The clientId is matched via a hidden "a1" custom answer the inline widget
 * passes through prefill.customAnswers, with email fallback against
 * tenant_profiles via the Clerk-linked clients table.
 */

type CalendlyQuestionAnswer = {
    question: string;
    answer: string;
    position?: number;
};

type CalendlyInviteePayload = {
    uri: string;
    email: string;
    name: string;
    status?: string;
    cancel_url?: string;
    reschedule_url?: string;
    questions_and_answers?: CalendlyQuestionAnswer[];
    scheduled_event?: {
        uri: string;
        start_time: string;
        end_time?: string;
    };
    rescheduled?: boolean;
};

type CalendlyWebhookEvent = {
    event: "invitee.created" | "invitee.canceled";
    payload: CalendlyInviteePayload;
};

function extractClientIdFromAnswers(
    answers: CalendlyQuestionAnswer[] | undefined
): string | null {
    if (!answers || !Array.isArray(answers)) return null;
    for (const qa of answers) {
        const q = (qa.question || "").toLowerCase();
        if (
            q.includes("clientid") ||
            q.includes("client_id") ||
            q.includes("client id") ||
            q === "a1"
        ) {
            const v = (qa.answer || "").trim();
            if (v) return v;
        }
    }
    if (answers.length > 0 && answers[0]?.answer) {
        const candidate = answers[0].answer.trim();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
            return candidate;
        }
    }
    return null;
}

async function resolveClientIdByEmail(email: string | undefined): Promise<string | null> {
    if (!email) return null;
    const lower = email.toLowerCase();

    const { data: byOwner } = await supabase
        .from("clients")
        .select("id")
        .eq("email", lower)
        .maybeSingle();
    if (byOwner?.id) return byOwner.id as string;

    const { data: byMember } = await supabase
        .from("client_members")
        .select("client_id")
        .eq("email", lower)
        .maybeSingle();
    if (byMember?.client_id) return byMember.client_id as string;

    return null;
}

async function getBusinessName(clientId: string): Promise<string> {
    const [profileRes, clientRes] = await Promise.all([
        supabase
            .from("tenant_profiles")
            .select("legal_business_name")
            .eq("client_id", clientId)
            .maybeSingle(),
        supabase
            .from("clients")
            .select("name")
            .eq("id", clientId)
            .maybeSingle(),
    ]);
    const legal = (profileRes.data as { legal_business_name?: string } | null)
        ?.legal_business_name;
    const fallback = (clientRes.data as { name?: string } | null)?.name;
    return legal || fallback || "Unknown";
}

async function pingSlack(message: string): Promise<void> {
    const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL;
    if (!url) return;
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: message }),
        });
    } catch (err) {
        console.error("[onboarding-webhook] Slack ping failed:", err);
    }
}

function formatDateForSlack(iso: string | undefined): string {
    if (!iso) return "(no time)";
    try {
        return new Date(iso).toLocaleString("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
        });
    } catch {
        return iso;
    }
}

export async function POST(request: Request) {
    const rawBody = await request.text();
    const signature = request.headers.get("calendly-webhook-signature");
    const signingKey = process.env.ONBOARDING_CALENDLY_WEBHOOK_SECRET;

    if (!signingKey) {
        console.warn(
            "[onboarding-webhook] ONBOARDING_CALENDLY_WEBHOOK_SECRET is not set; " +
                "accepting unverified payload to avoid Calendly retries"
        );
    } else if (!verifyWebhookSignature(rawBody, signature, signingKey)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let parsed: CalendlyWebhookEvent;
    try {
        parsed = JSON.parse(rawBody) as CalendlyWebhookEvent;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { event, payload } = parsed;
    if (!payload) {
        return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    let clientId = extractClientIdFromAnswers(payload.questions_and_answers);
    if (!clientId) {
        clientId = await resolveClientIdByEmail(payload.email);
    }

    if (!clientId) {
        // Avoid logging the full email (PII). Log only the domain so support
        // can spot misconfigurations (e.g. wrong company calendar) without
        // leaking inviteee identity into log aggregators.
        const emailDomain = payload.email?.split("@")[1] ?? "(none)";
        console.warn(
            "[onboarding-webhook] Could not match booking to a client. Email domain:",
            emailDomain
        );
        return NextResponse.json({ received: true, matched: false });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.omnify.ai";

    if (event === "invitee.created") {
        // Calendly fires invitee.created for both first-time bookings and the
        // "new" half of a reschedule. Either way, we treat the new event as
        // the current source of truth.
        const scheduledAt = payload.scheduled_event?.start_time ?? null;

        const { data: existing } = await supabase
            .from("tenant_profiles")
            .select("onboarding_call_scheduled_at")
            .eq("client_id", clientId)
            .maybeSingle();
        const previousStart = existing?.onboarding_call_scheduled_at as
            | string
            | null
            | undefined;

        const { error } = await supabase
            .from("tenant_profiles")
            .upsert(
                {
                    client_id: clientId,
                    onboarding_path: "manual_call_booked",
                    onboarding_call_scheduled_at: scheduledAt,
                    onboarding_call_invitee_uri: payload.uri,
                    onboarding_call_event_uri: payload.scheduled_event?.uri ?? null,
                    onboarding_call_invitee_email: payload.email,
                    onboarding_call_invitee_name: payload.name,
                    onboarding_call_reschedule_url: payload.reschedule_url ?? null,
                    onboarding_call_cancel_url: payload.cancel_url ?? null,
                    onboarding_call_answers: payload.questions_and_answers ?? null,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "client_id" }
            );
        if (error) {
            console.error("[onboarding-webhook] DB write failed:", error);
            return NextResponse.json({ error: "DB write failed" }, { status: 500 });
        }

        const businessName = await getBusinessName(clientId);
        const isReschedule =
            previousStart && scheduledAt && previousStart !== scheduledAt;

        if (isReschedule) {
            await pingSlack(
                `🔄 *Onboarding call rescheduled* — ${businessName} (${payload.name})\n` +
                    `Old: ${formatDateForSlack(previousStart ?? undefined)}\n` +
                    `New: ${formatDateForSlack(scheduledAt ?? undefined)}\n` +
                    `🔗 <${appUrl}/admin/onboarding|View in admin dashboard>`
            );
        } else {
            await pingSlack(
                `🎉 *Onboarding call booked* — ${businessName} (${payload.name}, ${payload.email})\n` +
                    `🗓️ ${formatDateForSlack(scheduledAt ?? undefined)}\n` +
                    `🔗 <${appUrl}/admin/onboarding|View in admin dashboard>`
            );
        }

        return NextResponse.json({ received: true });
    }

    if (event === "invitee.canceled") {
        // Calendly emits invitee.canceled with `rescheduled: true` as the first
        // half of a reschedule (the matching invitee.created arrives next).
        // Don't revert to "pending" in that case — the new booking will write
        // the new state in milliseconds.
        if (payload.rescheduled === true) {
            return NextResponse.json({ received: true, deferred: "reschedule" });
        }

        const { data: existing } = await supabase
            .from("tenant_profiles")
            .select("onboarding_call_scheduled_at, onboarding_call_invitee_name")
            .eq("client_id", clientId)
            .maybeSingle();

        const { error } = await supabase
            .from("tenant_profiles")
            .update({
                onboarding_path: "manual_call_pending",
                onboarding_call_scheduled_at: null,
                onboarding_call_invitee_uri: null,
                onboarding_call_event_uri: null,
                onboarding_call_reschedule_url: null,
                onboarding_call_cancel_url: null,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);
        if (error) {
            console.error("[onboarding-webhook] Cancel write failed:", error);
            return NextResponse.json({ error: "DB write failed" }, { status: 500 });
        }

        const businessName = await getBusinessName(clientId);
        await pingSlack(
            `❌ *Onboarding call canceled* — ${businessName} (${existing?.onboarding_call_invitee_name ?? payload.name})\n` +
                `Original time: ${formatDateForSlack(existing?.onboarding_call_scheduled_at ?? undefined)}`
        );

        return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true, ignored: event });
}
