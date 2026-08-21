/**
 * Pure helpers shared by the server-side thread builder and the client view.
 * Nothing in here may import server-only modules.
 */

import { CHANNEL_LABEL, type UniboxChannel, type UniboxThread, type UniboxTranscriptLine } from "./types";

export type Disposition = "answered" | "voicemail" | "no_answer" | "busy" | "failed" | "live";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
    answered: "Answered",
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

export function normalizeDisposition(raw: string | null | undefined): Disposition | null {
    if (!raw) return null;
    const d = raw.toLowerCase();
    if (d === "answered" || d === "voicemail" || d === "busy" || d === "failed") return d;
    if (d === "no_answer" || d === "no-answer") return "no_answer";
    return null;
}

/** Derive a disposition from the raw VAPI call row when the sequencer didn't record one. */
export function dispositionFromCall(status: string | null | undefined, endedReason: string | null | undefined): Disposition {
    const reason = (endedReason || "").toLowerCase();
    if (reason.includes("voicemail")) return "voicemail";
    if (reason.includes("did-not-answer") || reason.includes("no-answer")) return "no_answer";
    if (reason.includes("busy")) return "busy";
    if (reason.includes("error") || reason.includes("fail")) return "failed";
    if (status === "ended" || status === "completed") return "answered";
    if (status === "in-progress" || status === "ringing" || status === "queued") return "live";
    return "failed";
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
