/**
 * Pure helpers shared by the server-side thread builder and the client view.
 * Nothing in here may import server-only modules.
 */

import { CHANNEL_LABEL, type UniboxChannel, type UniboxThread, type UniboxTranscriptLine } from "./types";

export type Disposition = "answered" | "transferred" | "voicemail" | "no_answer" | "busy" | "failed" | "live";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
    answered: "Answered",
    transferred: "Transferred",
    voicemail: "Voicemail",
    no_answer: "No answer",
    busy: "Busy",
    failed: "Failed",
    live: "Live",
};

/** E.164-ish normalisation so `calls.customer_number` matches `contacts.phone`. */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length === 10) return `+1${digits}`;
    return `+${digits}`;
}

export function formatPhone(raw: string | null | undefined): string {
    const e164 = normalizePhone(raw);
    if (!e164) return raw?.trim() || "Unknown number";
    const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
    return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

const AGENT_ROLES = new Set(["ai", "assistant", "bot", "agent"]);
const LEAD_ROLES = new Set(["user", "customer", "lead", "human", "caller"]);

/**
 * VAPI stores transcripts as `AI: …` / `User: …` lines; the sequencer writes
 * `Assistant: …` / `User: …`. Unlabelled lines continue the previous speaker.
 */
export function parseTranscript(raw: string | null | undefined): UniboxTranscriptLine[] {
    if (!raw) return [];
    const lines: UniboxTranscriptLine[] = [];
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf(":");
        if (idx > 0 && idx <= 20) {
            const role = trimmed.slice(0, idx).trim().toLowerCase();
            const text = trimmed.slice(idx + 1).trim();
            if (role === "system") continue;
            if (LEAD_ROLES.has(role)) {
                if (text) lines.push({ speaker: "lead", text });
                continue;
            }
            if (AGENT_ROLES.has(role)) {
                if (text) lines.push({ speaker: "agent", text });
                continue;
            }
        }
        const prev = lines[lines.length - 1];
        if (prev) prev.text = `${prev.text} ${trimmed}`;
        else lines.push({ speaker: "agent", text: trimmed });
    }
    return lines;
}

/**
 * Map a disposition the sequencer recorded onto our vocabulary.
 *
 * The sequencer's own map (`getDisposition` in vapi-webhooks.ts) emits
 * `answered | completed | transferred | voicemail | no_answer | busy | failed |
 * unknown`. Anything we don't recognise returns null so the caller can fall
 * back to the raw VAPI row rather than silently inventing "answered".
 */
export function normalizeDisposition(raw: string | null | undefined): Disposition | null {
    if (!raw) return null;
    switch (raw.toLowerCase().replace(/-/g, "_")) {
        // "completed" is the sequencer's word for `assistant-ended-call`: the
        // line opened, nothing more. It gets the same scrutiny as "answered".
        case "answered":
        case "completed":
            return "answered";
        case "transferred":
            return "transferred";
        case "voicemail":
            return "voicemail";
        case "no_answer":
            return "no_answer";
        case "busy":
            return "busy";
        case "failed":
            return "failed";
        default:
            return null;
    }
}

/** Derive a disposition from the raw VAPI call row when the sequencer didn't record one. */
export function dispositionFromCall(status: string | null | undefined, endedReason: string | null | undefined): Disposition {
    const reason = (endedReason || "").toLowerCase();
    if (reason.includes("voicemail")) return "voicemail";
    if (reason.includes("forwarded") || reason.includes("transferred")) return "transferred";
    if (reason.includes("did-not-answer") || reason.includes("no-answer")) return "no_answer";
    // The line stayed open but nobody ever spoke — VAPI's own timeout, not a pickup.
    if (reason.includes("silence-timed-out")) return "no_answer";
    if (reason.includes("busy")) return "busy";
    if (reason.includes("error") || reason.includes("fail") || reason.includes("rejected")) return "failed";
    if (status === "ended" || status === "completed") return "answered";
    if (status === "in-progress" || status === "ringing" || status === "queued") return "live";
    return "failed";
}

/**
 * Answering-machine greetings and mailbox menus, as transcribed onto the
 * *lead* side of the conversation. VAPI labels the machine "User", so without
 * this test a voicemail box reads as a human who picked up and talked.
 *
 * Strong phrases are ones a person on a live call would never say — a machine
 * is the only plausible source, so they count wherever they appear.
 */
const VOICEMAIL_STRONG =
    /\b(?:at the tone|after the (?:tone|beep)|record (?:your|the) message|record or add to your message|re-?record|leave (?:me |a |an |your )?[^.!?]{0,40}message|leave your name|mailbox (?:is )?full|press (?:1|one|2|two|3|three|4|four|pound|star|#)\b|mark your message|add a message|(?:person|number) you(?:'re| are)?[^.!?]{0,15}(?:trying to reach|calling|dialed)|is (?:currently )?(?:not available|unavailable)|not available (?:right now|at the moment|to take)|unable to take (?:your|the|this) call|can(?:'|no)?t (?:come|get) to the phone|away from my phone|missed your call|please leave)\b/i;

/**
 * Weak phrases a real person might also say ("my calls just go to voicemail").
 * They only count as a greeting when they open the call — or when the
 * transcript is too one-sided to be a conversation at all.
 */
const VOICEMAIL_WEAK =
    /\b(?:voice ?mail|get back to you as soon as|(?:send|shoot) (?:me )?a text|hold while i connect)\b/i;

/** The call is only a conversation if the other side actually said something. */
export function hasLeadTurn(lines: UniboxTranscriptLine[] | null | undefined): boolean {
    return !!lines?.some((l) => l.speaker === "lead");
}

/**
 * Weak evidence is only trusted at the top of the call, where a greeting
 * lives, or on a transcript too one-sided to be a conversation. Scanning
 * everything for it misread a real 162-second call as voicemail because the
 * lead mentioned seven turns in that their own calls "just go to voice mail".
 */
const GREETING_TURNS = 2;
const ONE_SIDED_MAX_TURNS = 3;

export function looksLikeVoicemailGreeting(lines: UniboxTranscriptLine[] | null | undefined): boolean {
    const leadTurns = (lines ?? []).filter((l) => l.speaker === "lead").map((l) => l.text);
    if (leadTurns.length === 0) return false;
    const all = leadTurns.join(" ");
    if (VOICEMAIL_STRONG.test(all)) return true;
    const opening = leadTurns.length <= ONE_SIDED_MAX_TURNS ? all : leadTurns.slice(0, GREETING_TURNS).join(" ");
    return VOICEMAIL_WEAK.test(opening);
}

/** Long enough for the assistant to have left a message on a machine. */
const VOICEMAIL_MIN_SECONDS = 20;

/**
 * Settle on one disposition for a voice touch.
 *
 * `answered` is the only claim we don't take at face value: VAPI reports a
 * voicemail pickup as `customer-ended-call` / `assistant-ended-call` whenever
 * its own detector missed it, so a transcript with no human in it — or one
 * whose "human" is reciting a greeting — is downgraded. Every other
 * disposition is reported by the provider and passes through untouched.
 */
export function classifyVoiceCall(input: {
    /** `contact_interactions.call_disposition`, or its `outcome` fallback. */
    recorded?: string | null;
    status?: string | null;
    endedReason?: string | null;
    transcript?: UniboxTranscriptLine[] | null;
    durationSeconds?: number | null;
}): Disposition {
    const { recorded, status, endedReason, transcript, durationSeconds } = input;
    if (status === "in-progress" || status === "ringing" || status === "queued") return "live";

    const declared =
        normalizeDisposition(recorded) ??
        (status || endedReason ? dispositionFromCall(status, endedReason) : "answered");
    if (declared !== "answered") return declared;

    if (looksLikeVoicemailGreeting(transcript)) return "voicemail";
    if (hasLeadTurn(transcript)) return "answered";

    // Nobody on the other side spoke.
    if (!transcript?.length) {
        // There is no transcript at all — not even our own assistant's half —
        // so this is a gap in what we recorded, not evidence about the call.
        // Only a call too short to have been anything counts as a miss; past
        // that, defer to what the provider declared rather than invent a
        // voicemail. Whole accounts store calls without transcripts.
        return (durationSeconds ?? 0) < VOICEMAIL_MIN_SECONDS ? "no_answer" : declared;
    }
    // Our assistant talked and got nothing back: long enough and it was
    // leaving a message on a machine, short and the line just dropped.
    return (durationSeconds ?? 0) >= VOICEMAIL_MIN_SECONDS ? "voicemail" : "no_answer";
}

export function formatDuration(seconds: number | null | undefined): string {
    if (!seconds || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function titleCase(raw: string | null | undefined): string {
    if (!raw) return "";
    return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initialsFor(name: string | null | undefined): string {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "#";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function threadDisplayName(thread: Pick<UniboxThread, "name" | "phone">): string {
    return thread.name?.trim() || formatPhone(thread.phone);
}

/** "Voice 2 · SMS 4" — per-channel touch counts for a thread. */
export function channelLine(thread: Pick<UniboxThread, "channelCounts">): string {
    return (Object.keys(CHANNEL_LABEL) as UniboxChannel[])
        .filter((c) => thread.channelCounts[c])
        .map((c) => `${CHANNEL_LABEL[c]} ${thread.channelCounts[c]}`)
        .join(" · ");
}
