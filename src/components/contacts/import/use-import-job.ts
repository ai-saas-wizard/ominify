"use client";

import { useEffect, useRef, useState } from "react";
import {
    getImportJobStatus,
    type ImportJobStatus,
} from "@/app/actions/import-job-actions";

const POLL_MS = 1500;

export function isJobTerminal(job: ImportJobStatus | null): boolean {
    return job?.status === "completed" || job?.status === "failed";
}

// Await a job to its terminal state (for flows that keep their existing
// synchronous UX, like the task dialog). The job runs on the sequencer
// either way — abandoning this await (closing the tab) never stops it.
export async function awaitImportJob(
    jobId: string,
    onTick?: (job: ImportJobStatus) => void,
): Promise<ImportJobStatus> {
    for (;;) {
        const r = await getImportJobStatus(jobId);
        if (r.success && r.data) {
            onTick?.(r.data);
            if (r.data.status === "completed" || r.data.status === "failed") {
                return r.data;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

// Poll one import job until it reaches a terminal state, invoking onTerminal
// exactly once when it does. Used by the Imports wizard and the sequence
// enroll card while their progress UI is on screen. The job itself runs on
// the sequencer regardless — closing the page just stops the polling, never
// the import.
export function useImportJob(
    jobId: string | null,
    onTerminal?: (job: ImportJobStatus) => void,
): ImportJobStatus | null {
    const [tracked, setTracked] = useState<{
        jobId: string | null;
        job: ImportJobStatus | null;
    }>({ jobId: null, job: null });

    // Keep the latest callback without restarting the poll loop.
    const onTerminalRef = useRef(onTerminal);
    useEffect(() => {
        onTerminalRef.current = onTerminal;
    }, [onTerminal]);

    // Render-time adjust (not an effect): a new jobId invalidates the
    // previous job snapshot immediately.
    if (tracked.jobId !== jobId) {
        setTracked({ jobId, job: null });
    }

    useEffect(() => {
        if (!jobId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            try {
                const r = await getImportJobStatus(jobId);
                if (cancelled) return;
                if (r.success && r.data) {
                    setTracked({ jobId, job: r.data });
                    if (r.data.status === "completed" || r.data.status === "failed") {
                        onTerminalRef.current?.(r.data);
                        return; // terminal — stop polling
                    }
                }
            } catch {
                // transient poll failure — keep trying
            }
            if (!cancelled) timer = setTimeout(poll, POLL_MS);
        };
        void poll();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [jobId]);

    return tracked.jobId === jobId ? tracked.job : null;
}
