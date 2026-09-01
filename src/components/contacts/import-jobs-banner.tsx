"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
    listActiveImportJobs,
    type ImportJobStatus,
} from "@/app/actions/import-job-actions";

const POLL_MS = 4000;

// Surfaces imports/enrollments still running on the sequencer (or finished in
// the last few minutes) at the top of the Contacts pages. This is how a user
// who closed the tab mid-import finds out where their upload got to — the job
// keeps running server-side either way.
export function ImportJobsBanner() {
    const params = useParams();
    const router = useRouter();
    const clientId = params.clientId as string;
    const [jobs, setJobs] = useState<ImportJobStatus[]>([]);
    // Job ids seen in a non-terminal state — used to refresh the page data
    // exactly once when one of them completes (so the new list shows up).
    const runningIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!clientId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            try {
                const r = await listActiveImportJobs(clientId);
                if (cancelled) return;
                if (r.success) {
                    const next = r.data;
                    let finishedOne = false;
                    for (const j of next) {
                        const terminal = j.status === "completed" || j.status === "failed";
                        if (!terminal) runningIds.current.add(j.id);
                        else if (runningIds.current.delete(j.id)) finishedOne = true;
                    }
                    setJobs(next);
                    if (finishedOne) router.refresh();
                }
            } catch {
                // transient — keep polling
            }
            if (!cancelled) timer = setTimeout(poll, POLL_MS);
        };
        void poll();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [clientId, router]);

    if (jobs.length === 0) return null;

    return (
        <div className="space-y-2">
            {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
            ))}
        </div>
    );
}

function JobRow({ job }: { job: ImportJobStatus }) {
    const running = job.status === "pending" || job.status === "processing";
    const label =
        job.label ||
        (job.kind === "list_enroll" ? "List enrollment" : "Contact import");
    const verb = job.kind === "list_enroll" ? "Enrolling" : "Importing";

    if (running) {
        const pct =
            job.totalRows && job.totalRows > 0
                ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100))
                : null;
        return (
            <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />
                <span className="font-medium">
                    {verb} {label}
                </span>
                <span className="text-indigo-600">
                    {job.totalRows
                        ? `${job.processedRows.toLocaleString()} / ${job.totalRows.toLocaleString()} rows`
                        : "starting..."}
                </span>
                {pct !== null && (
                    <div className="ml-auto hidden h-1.5 w-40 overflow-hidden rounded-full bg-indigo-100 sm:block">
                        <div
                            className="h-full rounded-full bg-indigo-500 transition-all"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}
            </div>
        );
    }

    if (job.status === "failed") {
        return (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                <span className="font-medium">
                    {verb} {label} failed
                </span>
                <span className="truncate text-red-600">{job.error}</span>
            </div>
        );
    }

    const c = job.counts;
    const parts: string[] = [];
    if (c.contactsCreated) parts.push(`${c.contactsCreated.toLocaleString()} created`);
    if (c.contactsUpdated) parts.push(`${c.contactsUpdated.toLocaleString()} updated`);
    if (c.enrolled) parts.push(`${c.enrolled.toLocaleString()} enrolled`);
    if (c.skipped) parts.push(`${c.skipped.toLocaleString()} skipped`);
    return (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-medium">
                {label} {job.kind === "list_enroll" ? "enrolled" : "imported"}
            </span>
            <span className="text-emerald-700">{parts.join(" · ") || "done"}</span>
        </div>
    );
}
