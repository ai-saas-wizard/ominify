"use client";

import { useMemo, useState } from "react";
import { FlaskConical, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";
import { ENROLLMENT_STATUS, STATUS_LABELS, isInFlight } from "./enrollment-status";

/** "just now" / "14m ago" / "3h ago" / "2d ago" — null when there is no timestamp. */
function relativeTime(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

export function leadName(enrollment: any): string {
    const c = enrollment?.contacts;
    return c?.name || c?.phone || `Lead ${String(enrollment?.id ?? "").substring(0, 8)}`;
}

/**
 * Status buckets the filter offers. "Active" spans every in-flight status
 * (active / awaiting_outcome / generating_next_step) because a dynamic
 * enrollment spends most of its life in the latter two — filtering on the
 * literal "active" string alone would hide most of a live campaign.
 */
const FILTERS = ["All", "Active", "Replied", "Failed"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(status: string, filter: Filter): boolean {
    if (filter === "All") return true;
    if (filter === "Active") return isInFlight(status);
    return status === filter.toLowerCase();
}

/**
 * Left column of the sequence detail view: every enrolled lead, searchable and
 * filterable, with a per-lead touch-progress meter. Selecting a row drives the
 * journey column beside it.
 */
export function EnrolledLeadsPanel({
    enrollments,
    maxTouches,
    selectedId,
    onSelect,
}: {
    enrollments: any[];
    maxTouches: number;
    selectedId: string | null;
    onSelect: (id: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("All");

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return enrollments.filter((e) => {
            if (!matchesFilter(e.status, filter)) return false;
            if (!q) return true;
            const c = e.contacts;
            return (
                leadName(e).toLowerCase().includes(q) ||
                (c?.phone || "").toLowerCase().includes(q) ||
                (c?.email || "").toLowerCase().includes(q)
            );
        });
    }, [enrollments, query, filter]);

    return (
        <section className="flex min-w-0 flex-col border-r border-gray-200 bg-white">
            <div className="flex flex-none flex-col gap-2.5 border-b border-gray-100 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500">
                        Enrolled leads
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-gray-500">
                        {shown.length}
                        <span className="text-gray-300"> / {enrollments.length}</span>
                    </span>
                </div>

                <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search leads"
                        aria-label="Search leads"
                        className="h-[30px] w-full rounded-md border border-gray-200 bg-white pl-[29px] pr-2.5 text-[12.5px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-emerald-600 focus:ring-[3px] focus:ring-emerald-600/10"
                    />
                </div>

                <div
                    className="flex gap-0.5 rounded-md bg-gray-100 p-0.5"
                    role="group"
                    aria-label="Filter leads by status"
                >
                    {FILTERS.map((f) => {
                        const on = filter === f;
                        return (
                            <button
                                key={f}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setFilter(f)}
                                className={cn(
                                    "h-6 flex-1 rounded text-[11px] font-medium transition-colors",
                                    seqFocusRing,
                                    on
                                        ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                                        : "text-gray-500 hover:text-gray-700"
                                )}
                            >
                                {f}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {enrollments.length === 0 ? (
                    <div className="px-4 py-12 text-center text-gray-400">
                        <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                        <p className="text-sm">No leads enrolled yet.</p>
                        <p className="mt-1 text-xs">
                            Each lead&apos;s AI journey will appear here once enrolled.
                        </p>
                    </div>
                ) : shown.length === 0 ? (
                    <p className="px-4 py-10 text-center text-[11.5px] text-gray-400">
                        No leads match that search.
                    </p>
                ) : (
                    shown.map((e) => {
                        const on = e.id === selectedId;
                        const status = ENROLLMENT_STATUS[e.status] || ENROLLMENT_STATUS.active;
                        const touch = Math.min(
                            Math.max(e.current_step_order || 1, 1),
                            maxTouches
                        );
                        const last = relativeTime(e.updated_at || e.created_at);
                        return (
                            <button
                                key={e.id}
                                type="button"
                                onClick={() => onSelect(e.id)}
                                aria-current={on}
                                className={cn(
                                    "flex w-full flex-col gap-[7px] border-b border-l-2 border-b-gray-50 py-2.5 pl-2.5 pr-3.5 text-left transition-colors",
                                    on
                                        ? "border-l-emerald-600 bg-emerald-50/40"
                                        : "border-l-transparent hover:bg-gray-50"
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-gray-900">
                                        {leadName(e)}
                                    </span>
                                    {e.is_test && (
                                        <span className="inline-flex flex-none items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1 py-px text-[10px] font-medium text-amber-700">
                                            <FlaskConical className="h-2.5 w-2.5" />
                                            Test
                                        </span>
                                    )}
                                    <span
                                        className={cn(
                                            "inline-flex flex-none items-center gap-1 text-[10.5px] font-medium",
                                            status.text
                                        )}
                                    >
                                        <span
                                            className={cn("h-[5px] w-[5px] rounded-full", status.dot)}
                                        />
                                        {STATUS_LABELS[e.status] || e.status}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span
                                        className="flex flex-none gap-0.5"
                                        aria-hidden
                                        title={`Touch ${touch} of ${maxTouches}`}
                                    >
                                        {Array.from({ length: maxTouches }, (_, i) => (
                                            <span
                                                key={i}
                                                className={cn(
                                                    "h-[3px] w-3 rounded-[1px]",
                                                    i < touch ? status.bar : "bg-gray-200"
                                                )}
                                            />
                                        ))}
                                    </span>
                                    <span className="font-mono text-[10.5px] tabular-nums text-gray-500">
                                        Touch {touch}/{maxTouches}
                                    </span>
                                    {last && (
                                        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-gray-400">
                                            {last}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </section>
    );
}
