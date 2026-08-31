/**
 * Voicemail-aware call classification.
 *
 * `getDisposition()` in the VAPI webhook can only read `endedReason`, and VAPI
 * reports a voicemail pickup as `customer-ended-call` / `assistant-ended-call`
 * whenever its own detector misses one — which is often. Taking that at face
 * value told the rest of the sequencer that half our voicemails were live
 * conversations: leads got "we spoke earlier" texts nobody had spoken to,
 * enrollments carried `contact_answered_call`, and no-answer self-healing
 * never fired.
 *
 * The transcript is the tiebreaker, and it is already in hand at both webhook
 * call sites, so refining costs nothing but string work.
 *
 * NOTE: the dashboard has a twin of this logic in `src/lib/unibox/parse.ts`
 * (`classifyVoiceCall`). The two builds don't share a package — keep the
 * patterns and thresholds below in sync with it.
 */

/**
 * Phrases only a machine says. A person on a live call does not read out a
 * mailbox menu, so these count wherever they appear in the lead's speech.
 */
const VOICEMAIL_STRONG =
    /\b(?:at the tone|after the (?:tone|beep)|record (?:your|the) message|record or add to your message|re-?record|leave (?:me |a |an |your )?[^.!?]{0,40}message|leave your name|mailbox (?:is )?full|press (?:1|one|2|two|3|three|4|four|pound|star|#)\b|mark your message|add a message|(?:person|number) you(?:'re| are)?[^.!?]{0,15}(?:trying to reach|calling|dialed)|is (?:currently )?(?:not available|unavailable)|not available (?:right now|at the moment|to take)|unable to take (?:your|the|this) call|can(?:'|no)?t (?:come|get) to the phone|away from my phone|missed your call|please leave)\b/i;

/**
 * Phrases a real person might also say — "my calls just go to voicemail".
 * Only trusted when they open the call, or when the transcript is too
 * one-sided to be a conversation at all.
 */
const VOICEMAIL_WEAK =
    /\b(?:voice ?mail|get back to you as soon as|(?:send|shoot) (?:me )?a text|hold while i connect)\b/i;

/** Long enough for the assistant to have left a message on a machine. */
const VOICEMAIL_MIN_SECONDS = 20;
const GREETING_TURNS = 2;
const ONE_SIDED_MAX_TURNS = 3;

const LEAD_ROLES = new Set(['user', 'customer', 'lead', 'human', 'caller']);
const AGENT_ROLES = new Set(['ai', 'assistant', 'bot', 'agent']);

interface TranscriptLine {
    speaker: 'agent' | 'lead';
    text: string;
}

/**
 * VAPI writes `AI: …` / `User: …`; `extractTranscript` rebuilds artifacts as
 * `Assistant: …` / `User: …`. Unlabelled lines continue the previous speaker.
 */
export function parseTranscriptLines(raw: string | null | undefined): TranscriptLine[] {
    if (!raw) return [];
    const lines: TranscriptLine[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf(':');
        if (idx > 0 && idx <= 20) {
            const role = trimmed.slice(0, idx).trim().toLowerCase();
            const text = trimmed.slice(idx + 1).trim();
            if (role === 'system') continue;
            if (LEAD_ROLES.has(role)) {
                if (text) lines.push({ speaker: 'lead', text });
                continue;
            }
            if (AGENT_ROLES.has(role)) {
                if (text) lines.push({ speaker: 'agent', text });
                continue;
            }
        }
        const prev = lines[lines.length - 1];
        if (prev) prev.text = `${prev.text} ${trimmed}`;
        else lines.push({ speaker: 'agent', text: trimmed });
    }
    return lines;
}

export function looksLikeVoicemailGreeting(lines: TranscriptLine[]): boolean {
    const leadTurns = lines.filter((l) => l.speaker === 'lead').map((l) => l.text);
    if (leadTurns.length === 0) return false;
    const all = leadTurns.join(' ');
    if (VOICEMAIL_STRONG.test(all)) return true;
    const opening = leadTurns.length <= ONE_SIDED_MAX_TURNS ? all : leadTurns.slice(0, GREETING_TURNS).join(' ');
    return VOICEMAIL_WEAK.test(opening);
}

/**
 * Downgrade an "the line opened" disposition to what the transcript actually
 * shows. Only `answered` and `completed` are re-examined — every other
 * disposition is reported by the provider and is left alone.
 *
 * With no transcript at all this is a no-op: `status-update:ended` regularly
 * arrives before the transcript exists, and absence of a recording is not
 * evidence about the call.
 */
export function refineDisposition(
    disposition: string,
    transcript: string | null | undefined,
    durationSeconds: number | null | undefined
): string {
    if (disposition !== 'answered' && disposition !== 'completed') return disposition;

    const lines = parseTranscriptLines(transcript);
    if (lines.length === 0) return disposition;

    if (looksLikeVoicemailGreeting(lines)) return 'voicemail';
    if (lines.some((l) => l.speaker === 'lead')) return disposition;

    // The assistant talked and got nothing back: long enough and it was
    // leaving a message on a machine, short and the line just dropped.
    return (durationSeconds ?? 0) >= VOICEMAIL_MIN_SECONDS ? 'voicemail' : 'no_answer';
}
