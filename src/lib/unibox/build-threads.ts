/**
 * Collapse every touch with a lead — VAPI calls, sequencer SMS/email/voice
 * interactions, enrollments — into one UniboxThread per contact.
 *
 * Pure: takes rows in, returns threads out. The page fetches; this shapes.
 */

import type {
    UniboxAgentOption,
    UniboxChannel,
    UniboxEvent,
    UniboxStatus,
    UniboxThread,
} from "./types";
import {
    dispositionFromCall,
    formatDuration,
    DISPOSITION_LABEL,
    normalizeDisposition,
    normalizePhone,
    parseTranscript,
} from "./parse";

export interface ContactRow {
    id: string;
    phone: string | null;
    name: string | null;
    email: string | null;
    custom_fields: Record<string, unknown> | null;
    engagement_score: number | null;
    sentiment_trend: string | null;
    pipeline_stage_id: string | null;
    opted_out_at: string | null;
}

export interface InteractionRow {
    id: string;
    contact_id: string;
    step_id: string | null;
    channel: UniboxChannel;
    direction: "inbound" | "outbound";
    content_body: string | null;
    content_subject: string | null;
    content_summary: string | null;
    outcome: string | null;
    sentiment: string | null;
    intent: string | null;
    call_duration_seconds: number | null;
    call_disposition: string | null;
    appointment_booked: boolean | null;
    provider_id: string | null;
    created_at: string;
}

export interface CallRow {
    vapi_call_id: string;
    customer_number: string | null;
    status: string;
    ended_reason: string | null;
    transcript: string | null;
    recording_url: string | null;
    summary: string | null;
    started_at: string | null;
    created_at: string | null;
    type: string | null;
    duration_seconds: number | null;
    agents: { vapi_id: string; name: string } | null;
}

export interface EnrollmentRow {
    id: string;
    contact_id: string;
    sequence_id: string;
    status: string;
    current_step_order: number | null;
    enrolled_at: string | null;
    appointment_booked: boolean | null;
    completed_reason: string | null;
    sequences: { name: string | null; agent_id: string | null } | null;
}

export interface BuildThreadsInput {
    contacts: ContactRow[];
    interactions: InteractionRow[];
    calls: CallRow[];
    enrollments: EnrollmentRow[];
    agents: UniboxAgentOption[];
    /** pipeline_stages.id → name */
    stageNames: Record<string, string>;
    /** sequences.id → number of static (template) steps */
    stepCounts: Record<string, number>;
}

const ENROLLMENT_WORD: Record<string, string> = {
    active: "sending",
    awaiting_outcome: "sending",
    generating_next_step: "sending",
    paused: "paused",
    replied: "paused",
    completed: "completed",
    booked: "booked",
    converted: "booked",
    manual_stop: "stopped",
    unenrolled: "stopped",
    failed: "failed",
};

const ms = (iso: string) => new Date(iso).getTime();

/** The lead engaged: they wrote to us, called us, or picked up when we called. */
export function isEngagement(e: UniboxEvent): boolean {
    if (e.isLive) return false;
    if (e.direction === "inbound") return true;
    return e.kind === "voice" && e.disposition === "answered";
}

function previewFor(e: UniboxEvent): string {
    if (e.isLive) return "Live call in progress";
    if (e.kind === "voice") {
        if (e.summary) return e.summary;
        const label = e.disposition ? DISPOSITION_LABEL[e.disposition as keyof typeof DISPOSITION_LABEL] ?? e.disposition : "Call";
        const dur = e.durationSeconds ? ` · ${formatDuration(e.durationSeconds)}` : "";
        return `${label}${dur}`;
    }
    const text = (e.body || e.subject || "").replace(/\s+/g, " ").trim();
    if (!text) return e.kind === "email" ? "Email sent" : "Message sent";
    return e.direction === "inbound" ? `“${text}”` : text;
}

function locationFor(fields: Record<string, unknown> | null): string | null {
    if (!fields) return null;
    const city = typeof fields.city === "string" ? fields.city.trim() : "";
    const state = typeof fields.state === "string" ? fields.state.trim() : "";
    if (city && state) return `${city}, ${state}`;
    return city || state || null;
}

export function buildThreads(input: BuildThreadsInput): UniboxThread[] {
    const { contacts, interactions, calls, enrollments, agents, stageNames, stepCounts } = input;

    const agentById = new Map(agents.map((a) => [a.id, a]));
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const contactByPhone = new Map<string, ContactRow>();
    for (const c of contacts) {
        const p = normalizePhone(c.phone);
        if (p && !contactByPhone.has(p)) contactByPhone.set(p, c);
    }

    // Sequencer voice interactions carry the VAPI call id, so the richer
    // `calls` row (recording, full transcript) absorbs them instead of
    // rendering the same call twice.
    const voiceByProvider = new Map<string, InteractionRow>();
    for (const i of interactions) {
        if (i.channel === "voice" && i.provider_id) voiceByProvider.set(i.provider_id, i);
    }

    type Bucket = { contact: ContactRow | null; phone: string | null; events: UniboxEvent[] };
    const buckets = new Map<string, Bucket>();
    const push = (key: string, contact: ContactRow | null, phone: string | null, ev: UniboxEvent) => {
        let b = buckets.get(key);
        if (!b) {
            b = { contact, phone, events: [] };
            buckets.set(key, b);
        }
        b.events.push(ev);
    };

    const consumed = new Set<string>();

    for (const call of calls) {
        const at = call.started_at ?? call.created_at;
        if (!at) continue;
        const linked = voiceByProvider.get(call.vapi_call_id);
        const phone = normalizePhone(call.customer_number);
        const contact =
            (linked && contactById.get(linked.contact_id)) ||
            (phone ? contactByPhone.get(phone) : undefined) ||
            null;
        const key = contact ? contact.id : phone ? `phone:${phone}` : "unknown";
        if (linked) consumed.add(linked.id);

        const rawTranscript = call.transcript || linked?.content_body || null;
        const disposition =
            normalizeDisposition(linked?.call_disposition) ?? dispositionFromCall(call.status, call.ended_reason);

        push(key, contact, phone ?? normalizePhone(contact?.phone), {
            id: `call:${call.vapi_call_id}`,
            kind: "voice",
            direction: call.type === "inboundPhoneCall" ? "inbound" : "outbound",
            at,
            body: rawTranscript ?? undefined,
            summary: call.summary || linked?.content_summary || undefined,
            transcript: parseTranscript(rawTranscript),
            recordingUrl: call.recording_url || undefined,
            durationSeconds: call.duration_seconds ?? linked?.call_duration_seconds ?? undefined,
            disposition,
            outcome: linked?.outcome ?? undefined,
            sentiment: linked?.sentiment ?? undefined,
            intent: linked?.intent ?? undefined,
            agentName: call.agents?.name ?? undefined,
            agentVapiId: call.agents?.vapi_id ?? undefined,
            providerId: call.vapi_call_id,
            isSequenceStep: !!linked?.step_id,
            appointmentBooked: linked?.appointment_booked ?? false,
        });
    }

    for (const i of interactions) {
        if (consumed.has(i.id)) continue;
        const contact = contactById.get(i.contact_id);
        if (!contact) continue;
        const isVoice = i.channel === "voice";
        push(contact.id, contact, normalizePhone(contact.phone), {
            id: `ix:${i.id}`,
            kind: i.channel,
            direction: i.direction,
            at: i.created_at,
            body: i.content_body ?? undefined,
            subject: i.content_subject ?? undefined,
            summary: i.content_summary ?? undefined,
            transcript: isVoice ? parseTranscript(i.content_body) : undefined,
            durationSeconds: i.call_duration_seconds ?? undefined,
            disposition: isVoice
                ? normalizeDisposition(i.call_disposition) ?? normalizeDisposition(i.outcome) ?? "answered"
                : undefined,
            outcome: i.outcome ?? undefined,
            sentiment: i.sentiment ?? undefined,
            intent: i.intent ?? undefined,
            providerId: i.provider_id ?? undefined,
            isSequenceStep: !!i.step_id,
            appointmentBooked: i.appointment_booked ?? false,
        });
    }

    const latestEnrollment = new Map<string, EnrollmentRow>();
    const enrollmentBooked = new Set<string>();
    const enrollmentOptedOut = new Set<string>();
    for (const e of enrollments) {
        const cur = latestEnrollment.get(e.contact_id);
        if (!cur || ms(e.enrolled_at ?? "0") > ms(cur.enrolled_at ?? "0")) latestEnrollment.set(e.contact_id, e);
        if (e.appointment_booked || e.status === "booked" || e.status === "converted") enrollmentBooked.add(e.contact_id);
        if ((e.completed_reason || "").includes("opted_out")) enrollmentOptedOut.add(e.contact_id);
    }

    const threads: UniboxThread[] = [];

    for (const [key, bucket] of buckets) {
        const events = bucket.events.sort((a, b) => ms(a.at) - ms(b.at));
        if (events.length === 0) continue;
        const { contact, phone } = bucket;

        const channelCounts: Partial<Record<UniboxChannel, number>> = {};
        for (const e of events) channelCounts[e.kind] = (channelCounts[e.kind] ?? 0) + 1;

        const engagement = events.filter(isEngagement);
        const lastResponse = engagement[engagement.length - 1] ?? null;
        const last = events[events.length - 1];

        const stepAfterResponse = lastResponse
            ? events.some(
                  (e) =>
                      e.direction === "outbound" &&
                      e.isSequenceStep &&
                      !isEngagement(e) &&
                      ms(e.at) > ms(lastResponse.at)
              )
            : false;

        const optedOut =
            !!contact?.opted_out_at ||
            (contact ? enrollmentOptedOut.has(contact.id) : false) ||
            events.some((e) => e.direction === "inbound" && e.intent === "stop");
        const booked =
            events.some((e) => e.appointmentBooked) || (contact ? enrollmentBooked.has(contact.id) : false);

        let status: UniboxStatus;
        if (optedOut) status = "opted_out";
        else if (booked) status = "booked";
        else if (lastResponse) status = stepAfterResponse ? "awaiting_reply" : "responded";
        else if (channelCounts.voice) status = "no_answer";
        else status = "awaiting_reply";

        const enrollment = contact ? latestEnrollment.get(contact.id) : undefined;
        const enrolledAgent = enrollment?.sequences?.agent_id ? agentById.get(enrollment.sequences.agent_id) : undefined;
        const lastVoiceWithAgent = [...events].reverse().find((e) => e.agentVapiId);
        const agentName = enrolledAgent?.name ?? lastVoiceWithAgent?.agentName ?? null;
        const agentVapiId = enrolledAgent?.vapiId ?? lastVoiceWithAgent?.agentVapiId ?? null;

        let sequenceProgress: string | null = null;
        if (enrollment) {
            const word = ENROLLMENT_WORD[enrollment.status] ?? enrollment.status;
            const order = enrollment.current_step_order ?? 0;
            const total = stepCounts[enrollment.sequence_id] ?? 0;
            sequenceProgress =
                order > 0
                    ? `Step ${order}${total > 0 ? ` of ${total}` : ""} · ${word}`
                    : word.charAt(0).toUpperCase() + word.slice(1);
        }

        const fields = contact?.custom_fields ?? null;
        const company = fields && typeof fields.company === "string" ? fields.company.trim() || null : null;

        threads.push({
            id: key,
            contactId: contact?.id ?? null,
            name: contact?.name?.trim() || null,
            phone: phone ?? normalizePhone(contact?.phone),
            email: contact?.email?.trim() || null,
            location: locationFor(fields),
            company,
            agentName,
            agentVapiId,
            sequenceName: enrollment?.sequences?.name?.trim() || null,
            sequenceProgress,
            events,
            channelCounts,
            touches: events.length,
            firstTouchAt: events[0].at,
            lastActivityAt: last.at,
            lastResponseAt: lastResponse?.at ?? null,
            status,
            preview: previewFor(last),
            needsReply: last.direction === "inbound" && last.kind !== "voice",
            appointmentBooked: booked,
            optedOut,
            hasLiveCall: false,
            engagementScore: contact?.engagement_score ?? null,
            sentimentTrend: contact?.sentiment_trend ?? null,
            pipelineStage: contact?.pipeline_stage_id ? stageNames[contact.pipeline_stage_id] ?? null : null,
        });
    }

    return threads.sort((a, b) => ms(b.lastActivityAt ?? "0") - ms(a.lastActivityAt ?? "0"));
}
