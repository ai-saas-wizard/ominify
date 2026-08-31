/**
 * UNIBOX — unified cross-channel inbox types.
 *
 * A thread is one lead. Every touch we made or received on any channel
 * (voice, SMS, email) collapses into a single chronological timeline so an
 * operator can read the whole relationship top to bottom.
 */

export type UniboxChannel = "voice" | "sms" | "email";

export type UniboxDirection = "inbound" | "outbound";

/** Who is speaking, from the workspace owner's point of view. */
export type UniboxSpeaker = "agent" | "lead";

export type UniboxEventKind = UniboxChannel;

export interface UniboxTranscriptLine {
    speaker: UniboxSpeaker;
    text: string;
}

export interface UniboxEvent {
    id: string;
    kind: UniboxEventKind;
    direction: UniboxDirection;
    /** ISO timestamp. Every event has one — undated rows are dropped upstream. */
    at: string;

    /** SMS/email body, or the raw voice transcript. */
    body?: string;
    subject?: string;
    summary?: string;

    // Voice-only
    transcript?: UniboxTranscriptLine[];
    recordingUrl?: string;
    durationSeconds?: number;
    disposition?: string;

    // Delivery / analysis
    outcome?: string;
    sentiment?: string;
    intent?: string;

    agentName?: string;
    agentVapiId?: string;
    providerId?: string;
    /** Fired by the sequencer as a sequence step (vs. a chatbot/manual reply). */
    isSequenceStep?: boolean;
    appointmentBooked?: boolean;
    isLive?: boolean;
}

export type UniboxStatus =
    | "interested"
    | "responded"
    | "booked"
    | "awaiting_reply"
    | "no_answer"
    | "not_interested"
    | "opted_out"
    | "new";

export interface UniboxThread {
    /** Contact UUID, or `phone:+1…` for calls with no contact record. */
    id: string;
    contactId: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    /** "Sacramento, CA" assembled from custom fields, when present. */
    location: string | null;
    company: string | null;

    agentName: string | null;
    agentVapiId: string | null;
    sequenceName: string | null;
    /** "Step 3 of 5 · sending" */
    sequenceProgress: string | null;

    events: UniboxEvent[];
    /** Touch count per channel, e.g. { voice: 2, sms: 4 }. */
    channelCounts: Partial<Record<UniboxChannel, number>>;
    touches: number;

    firstTouchAt: string | null;
    lastActivityAt: string | null;
    lastResponseAt: string | null;

    status: UniboxStatus;
    /** One-line summary of the most recent meaningful event. */
    preview: string;
    /** The lead spoke last and nobody has answered them yet. */
    needsReply: boolean;
    appointmentBooked: boolean;
    optedOut: boolean;
    hasLiveCall: boolean;

    engagementScore: number | null;
    sentimentTrend: string | null;
    pipelineStage: string | null;
}

export interface UniboxAgentOption {
    id: string;
    vapiId: string;
    name: string;
    agentType: string;
}

export const STATUS_META: Record<
    UniboxStatus,
    { label: string; dot: string; text: string; chip: string }
> = {
    responded: {
        label: "Responded",
        dot: "bg-emerald-500",
        text: "text-emerald-700",
        chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    booked: {
        label: "Booked",
        dot: "bg-blue-500",
        text: "text-blue-700",
        chip: "bg-blue-50 text-blue-700 border-blue-200",
    },
    interested: {
        label: "Interested",
        dot: "bg-violet-500",
        text: "text-violet-700",
        chip: "bg-violet-50 text-violet-700 border-violet-200",
    },
    awaiting_reply: {
        label: "Awaiting reply",
        dot: "bg-amber-400",
        text: "text-amber-700",
        chip: "bg-amber-50 text-amber-700 border-amber-200",
    },
    no_answer: {
        label: "No answer",
        dot: "bg-gray-300",
        text: "text-gray-500",
        chip: "bg-gray-50 text-gray-600 border-gray-200",
    },
    not_interested: {
        label: "Not interested",
        dot: "bg-rose-300",
        text: "text-rose-600",
        chip: "bg-rose-50 text-rose-600 border-rose-200",
    },
    opted_out: {
        label: "Opted out",
        dot: "bg-red-400",
        text: "text-red-600",
        chip: "bg-red-50 text-red-600 border-red-200",
    },
    new: {
        label: "New",
        dot: "bg-gray-300",
        text: "text-gray-500",
        chip: "bg-gray-50 text-gray-600 border-gray-200",
    },
};

export const CHANNEL_LABEL: Record<UniboxChannel, string> = {
    voice: "Voice",
    sms: "SMS",
    email: "Email",
};
