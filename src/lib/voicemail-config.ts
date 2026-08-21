import "server-only";

/**
 * Canonical voicemail settings for VAPI assistants.
 *
 * Lives in one place because the same two mistakes were duplicated across
 * every agent-creation path:
 *
 *  1. `machine_start` was missing from the detection types. The remaining
 *     types only fire once the greeting has ENDED, so the agent opened its
 *     pitch over the recorded greeting and, on a live pilot, held a 55-second
 *     "conversation" with an answering machine before anything detected it.
 *
 *  2. Outbound assistants were given detection but an explicitly `undefined`
 *     voicemailMessage — so detection fired with nothing to say and the call
 *     was simply burned. Only inbound agents got a message.
 *
 * Change these here, not at the call sites.
 */

export const VOICEMAIL_DETECTION_TYPES = [
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
];

/**
 * Fresh mutable object per call — VAPI payload types want `string[]`, and a
 * shared frozen literal would both fail those types and risk one call site
 * mutating the config for every other.
 */
export function voicemailDetection(): {
    provider: string;
    enabled: boolean;
    voicemailDetectionTypes: string[];
} {
    return {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: [...VOICEMAIL_DETECTION_TYPES],
    };
}

/** Inbound: the caller reached the business and should leave a message. */
export function inboundVoicemailMessage(businessName: string): string {
    return `You've reached ${businessName}. Please leave a message and we will get back to you as soon as possible.`;
}

/**
 * Outbound: WE called THEM, so "leave a message" is nonsense. Identify the
 * business, give one line of reason, invite a callback, and stop — a long
 * pitch to a machine gets deleted.
 */
export function outboundVoicemailMessage(
    businessName: string,
    reason?: string
): string {
    const why = reason?.trim()
        ? ` ${reason.trim().replace(/\.?$/, ".")}`
        : "";
    return `Hi, this is ${businessName} calling.${why} Give us a call back on this number whenever suits you. Thanks.`;
}
