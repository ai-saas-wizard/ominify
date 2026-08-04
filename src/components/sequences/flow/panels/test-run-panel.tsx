"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    MessageSquare,
    Phone,
    Mail,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    AlertCircle,
    Clock,
} from "lucide-react";
import { getTestRunStatus } from "@/app/actions/sequence-actions";
import type {
    TestRunStatus,
    TestRunEvent,
    TestEventSeverity,
} from "@/lib/sequences/test-run-types";

/** The scheduler's compressed inter-step delay for test enrollments. */
const TEST_STEP_DELAY_SECONDS = 30;
const POLL_INTERVAL_MS = 3000;
const POLL_WINDOW_MS = 90_000;

const CHANNEL_ICON = {
    sms: MessageSquare,
    voice: Phone,
    email: Mail,
} as const;

const SEVERITY_STYLE: Record<TestEventSeverity, { dot: string; text: string; Icon: typeof CheckCircle2 }> = {
    ok: { dot: "bg-emerald-500", text: "text-gray-700", Icon: CheckCircle2 },
    pending: { dot: "bg-gray-300", text: "text-gray-500", Icon: Clock },
    warn: { dot: "bg-amber-500", text: "text-amber-800", Icon: AlertTriangle },
    error: { dot: "bg-red-500", text: "text-red-800", Icon: AlertCircle },
};

function EventRow({ event }: { event: TestRunEvent }) {
    const style = SEVERITY_STYLE[event.severity];
    const ChannelIcon = event.channel ? CHANNEL_ICON[event.channel] : null;
    return (
        <div className="flex items-start gap-2 text-xs">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
            <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                    {ChannelIcon && <ChannelIcon className="h-3 w-3 text-gray-400" />}
                    <span className={`font-medium ${style.text}`}>
                        {event.stepOrder ? `Step ${event.stepOrder}` : "Step"}
                    </span>
                </div>
                <p className={style.text}>{event.explanation}</p>
                {event.fixHref && (
                    <Link
                        href={event.fixHref}
                        className="inline-block font-medium underline underline-offset-2"
                    >
                        {event.fixLabel || "Fix this"}
                    </Link>
                )}
            </div>
        </div>
    );
}

/**
 * Live view of what the test actually did. Polls sequence_execution_log for up
 * to 90s, then stops.
 *
 * The "nothing happened" state is explicit rather than an empty list, because
 * two real paths write NO log row at all: the SMS worker throws before logging
 * when the tenant has no usable Twilio config, and an email step on a contact
 * with no email address just advances silently.
 */
export function TestRunPanel({
    enrollmentIds,
    clientId,
}: {
    enrollmentIds: string[];
    clientId: string;
}) {
    const [status, setStatus] = useState<TestRunStatus | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [done, setDone] = useState(false);
    const startedAt = useRef(Date.now());

    useEffect(() => {
        if (enrollmentIds.length === 0) return;

        let cancelled = false;
        startedAt.current = Date.now();

        const tick = async () => {
            if (cancelled) return;
            const age = Date.now() - startedAt.current;
            setElapsed(Math.floor(age / 1000));

            try {
                const res = await getTestRunStatus(enrollmentIds, clientId);
                if (cancelled) return;
                if (res.success && res.data) {
                    setStatus(res.data);
                    if (res.data.settled) {
                        setDone(true);
                        return; // stop polling — nothing more will change
                    }
                }
            } catch {
                // Transient — keep polling until the window closes.
            }

            if (age >= POLL_WINDOW_MS) {
                setDone(true);
                return;
            }
            if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
        };

        let timer = setTimeout(tick, 1000);
        // Own the cleanup: the dialog resets on a 200ms timer after close, so
        // this must not keep polling behind a dismissed dialog.
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [enrollmentIds, clientId]);

    if (enrollmentIds.length === 0) return null;

    const events = status?.events ?? [];

    return (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">Live run</span>
                <span className="flex items-center gap-1.5 text-gray-400">
                    {!done && <Loader2 className="h-3 w-3 animate-spin" />}
                    {elapsed}s
                </span>
            </div>

            {events.length > 0 ? (
                <div className="space-y-2">
                    {events.map((e) => (
                        <EventRow key={e.id} event={e} />
                    ))}
                </div>
            ) : done ? (
                <div className="flex items-start gap-2 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500" />
                    <div className="space-y-1">
                        <p className="font-medium">Nothing fired in 90 seconds.</p>
                        <p>
                            The usual causes are: the tenant has no usable Twilio
                            config (the SMS worker fails before it can log), the
                            step is an email and the contact has no email address,
                            or the sequencer isn&apos;t running.
                        </p>
                    </div>
                </div>
            ) : (
                <p className="text-xs text-gray-500">
                    Waiting for the scheduler — the first step fires within a few
                    seconds, then roughly every {TEST_STEP_DELAY_SECONDS}s.
                </p>
            )}
        </div>
    );
}
