"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, Check } from "lucide-react";
import { listContactLists } from "@/app/actions/contact-list-actions";
import { startListEnrollJob } from "@/app/actions/import-job-actions";
import { useImportJob } from "@/components/contacts/import/use-import-job";
import { cn } from "@/lib/utils";
import {
    seqBtnPrimary,
    seqCardStatic,
    type SeqRailPanelProps,
} from "@/components/sequences/theme";

interface ListRow {
    id: string;
    name: string;
    contact_count: number | null;
    source: string | null;
}

/**
 * Enroll an already-saved contact list into this sequence.
 *
 * enrollListInSequence has always existed, but the only ways to reach it were
 * at import time (createListFromImport's enrollIntoSequenceId) and the task
 * dialog, so a list created earlier could never be enrolled into a sequence
 * that already exists. This surfaces it on the sequence itself.
 *
 * Enrolling starts real outreach, so the button states what will happen and
 * requires a second click to confirm.
 *
 * The enrollment itself runs as a server-side job on the sequencer (via
 * startListEnrollJob), so it finishes even if the user leaves this page —
 * this card only enqueues and then polls for progress while mounted.
 */
export function EnrollListCard({
    sequenceId,
    clientId,
    className,
    bare,
}: Pick<SeqRailPanelProps, "bare"> & {
    sequenceId: string;
    clientId: string;
    className?: string;
}) {
    const router = useRouter();
    const [lists, setLists] = useState<ListRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string>("");
    const [confirming, setConfirming] = useState(false);
    const [enrolling, setEnrolling] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Job finished (or failed) — surface counts. If the user leaves before
    // this fires, the job still completes server-side.
    const job = useImportJob(jobId, (finished) => {
        setJobId(null);
        setEnrolling(false);
        if (finished.status === "failed") {
            setError(finished.error || "Could not enroll that list");
            return;
        }
        const n = finished.counts.enrolled ?? 0;
        const skipped = finished.counts.skipped ?? 0;
        setResult(
            `Enrolled ${n} contact${n === 1 ? "" : "s"}` +
                (skipped ? ` · ${skipped} already in this sequence — skipped` : "")
        );
        router.refresh();
    });

    useEffect(() => {
        let cancelled = false;
        listContactLists(clientId)
            .then((res) => {
                if (cancelled) return;
                setLists(((res.data as ListRow[]) || []).filter(Boolean));
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [clientId]);

    const chosen = lists.find((l) => l.id === selected);

    async function handleEnroll() {
        if (!selected) return;
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setEnrolling(true);
        setError(null);
        setResult(null);
        const res = await startListEnrollJob(sequenceId, selected);
        setConfirming(false);
        if (res?.success && res.data) {
            setJobId(res.data.jobId);
        } else {
            setEnrolling(false);
            setError(res?.error || "Could not enroll that list");
        }
    }

    // Enrolling starts real outreach rather than editing a setting, so this
    // panel keeps its own button even inside the rail's unified-save sidebar.
    const body = (
        <>
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading lists
                </div>
            ) : lists.length === 0 ? (
                <p className="text-xs text-gray-500">
                    No saved lists yet. Import contacts from the Contacts page first.
                </p>
            ) : (
                <>
                    <select
                        aria-label="Contact list to enroll"
                        value={selected}
                        onChange={(e) => {
                            setSelected(e.target.value);
                            setConfirming(false);
                            setResult(null);
                            setError(null);
                        }}
                        disabled={enrolling}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60"
                    >
                        <option value="">Choose a list...</option>
                        {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                                {l.contact_count != null ? ` (${l.contact_count})` : ""}
                            </option>
                        ))}
                    </select>

                    <button
                        type="button"
                        onClick={handleEnroll}
                        disabled={!selected || enrolling}
                        className={cn(
                            seqBtnPrimary,
                            "mt-3 w-full px-3 py-1.5 text-xs",
                            confirming && "bg-amber-600 hover:bg-amber-700"
                        )}
                    >
                        {enrolling
                            ? job?.totalRows
                                ? `Enrolling… ${job.counts.enrolled ?? 0}/${job.totalRows}`
                                : "Enrolling on the server…"
                            : confirming
                            ? `Start outreach to ${chosen?.contact_count ?? "these"} contacts?`
                            : "Enroll list"}
                    </button>

                    {confirming && !enrolling && (
                        <p className="mt-2 text-xs text-amber-700">
                            This begins real calls and texts on the sequence schedule.
                            Click again to confirm.
                        </p>
                    )}

                    {enrolling && (
                        <p className="mt-2 text-xs text-gray-500">
                            Runs on the server — safe to leave this page.
                        </p>
                    )}
                </>
            )}

            {result && (
                <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
                    <Check className="h-3 w-3" />
                    {result}
                </p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </>
    );

    if (bare) {
        return (
            <div className={className}>
                {body}
                {!loading && lists.length > 0 && (
                    <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                        Contacts already enrolled, or who replied, booked or opted out, are
                        skipped.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className={cn(seqCardStatic, "p-4", className)}>
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Users className="h-3.5 w-3.5 text-gray-400" />
                Enroll a list
            </h4>
            <p className="mb-3 text-xs text-gray-500">
                Adds every contact on a saved list to this sequence. Contacts already
                enrolled, or who replied, booked or opted out, are skipped.
            </p>
            {body}
        </div>
    );
}
