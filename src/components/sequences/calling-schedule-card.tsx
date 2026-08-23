"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import { updateSequencePacing } from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";
import {
    seqBtnPrimary,
    seqCardStatic,
    type SeqRailPanelProps,
} from "@/components/sequences/theme";

/** The sequence fields this card reads, a structural subset of the row. */
export interface CallingScheduleFields {
    daily_call_cap?: number | null;
    calling_window_start?: string | null;
    calling_window_end?: string | null;
    calling_days?: string[] | null;
    pacing_per_minute?: number | null;
}

/** Postgres TIME ('HH:MM:SS') → 'HH:MM' for <input type="time"> and display. */
function toInputTime(value: unknown): string {
    return typeof value === "string" ? value.slice(0, 5) : "";
}

// Storage keys in JS-day order (0=Sun..6=Sat); the picker renders Mon-first.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_PICKER: Array<{ key: (typeof DAY_KEYS)[number]; label: string }> = [
    { key: "mon", label: "Mon" },
    { key: "tue", label: "Tue" },
    { key: "wed", label: "Wed" },
    { key: "thu", label: "Thu" },
    { key: "fri", label: "Fri" },
    { key: "sat", label: "Sat" },
    { key: "sun", label: "Sun" },
];

/** "Mon, Wed, Fri", with the two common presets named. */
function daysSummary(days: string[] | null | undefined): string | null {
    if (!days || days.length === 0 || days.length === 7) return null;
    const set = new Set(days);
    const weekdays = ["mon", "tue", "wed", "thu", "fri"];
    if (set.size === 5 && weekdays.every((d) => set.has(d))) return "Weekdays";
    if (set.size === 2 && set.has("sat") && set.has("sun")) return "Weekends";
    return DAY_PICKER.filter((d) => set.has(d.key)).map((d) => d.label).join(", ");
}

/**
 * One-line read-only rendering of the configured cap + window + days, e.g.
 * "150/day · 10:00–16:00 · Weekdays". Returns null when nothing is configured
 * so callers can skip the chip entirely.
 */
export function callingScheduleSummary(
    sequence: CallingScheduleFields | null | undefined
): string | null {
    const parts: string[] = [];
    if (sequence?.daily_call_cap) parts.push(`${sequence.daily_call_cap}/day`);
    const start = toInputTime(sequence?.calling_window_start);
    const end = toInputTime(sequence?.calling_window_end);
    if (start && end) parts.push(`${start}–${end}`);
    const days = daysSummary(sequence?.calling_days);
    if (days) parts.push(days);
    return parts.length > 0 ? parts.join(" · ") : null;
}

const inputClass =
    "rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60";

/**
 * Sequence-level dial pacing: how many calls a day, inside which hours, and
 * how fast a bulk batch is released. The first two are enforced by the
 * sequencer's scheduler for voice steps (tenant timezone, on top of business
 * hours + TCPA); the last staggers next_step_at when a list is enrolled.
 */
export function CallingScheduleCard({
    sequenceId,
    sequence,
    className,
    bare,
    onDirtyChange,
    registerSave,
}: SeqRailPanelProps & {
    sequenceId: string;
    sequence: CallingScheduleFields | null | undefined;
    className?: string;
}) {
    const router = useRouter();
    const [dailyCap, setDailyCap] = useState<string>(
        sequence?.daily_call_cap != null ? String(sequence.daily_call_cap) : ""
    );
    const [windowStart, setWindowStart] = useState<string>(toInputTime(sequence?.calling_window_start));
    const [windowEnd, setWindowEnd] = useState<string>(toInputTime(sequence?.calling_window_end));
    const [pacing, setPacing] = useState<string>(
        sequence?.pacing_per_minute != null ? String(sequence.pacing_per_minute) : ""
    );
    const [selectedDays, setSelectedDays] = useState<Set<string>>(
        () => new Set(sequence?.calling_days?.length ? sequence.calling_days : DAY_KEYS)
    );
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-sync the inputs when the server row changes under us (router.refresh
    // after save, a concurrent edit in another tab), useState initializers
    // only run on mount, so without this the inputs and the summary chips
    // would show different values.
    const serverCap = sequence?.daily_call_cap != null ? String(sequence.daily_call_cap) : "";
    const serverStart = toInputTime(sequence?.calling_window_start);
    const serverEnd = toInputTime(sequence?.calling_window_end);
    const serverPacing = sequence?.pacing_per_minute != null ? String(sequence.pacing_per_minute) : "";
    const serverDays = sequence?.calling_days?.length
        ? DAY_KEYS.filter((d) => sequence.calling_days!.includes(d)).join(",")
        : DAY_KEYS.join(",");
    useEffect(() => {
        setDailyCap(serverCap);
        setWindowStart(serverStart);
        setWindowEnd(serverEnd);
        setPacing(serverPacing);
        setSelectedDays(new Set(serverDays.split(",")));
    }, [sequenceId, serverCap, serverStart, serverEnd, serverPacing, serverDays]);

    function toggleDay(day: string) {
        setSelectedDays((prev) => {
            const next = new Set(prev);
            if (next.has(day)) next.delete(day);
            else next.add(day);
            return next;
        });
        setSaved(false);
        setError(null);
    }

    async function handleSave() {
        if (selectedDays.size === 0) {
            setError("Select at least one calling day");
            return;
        }
        setSaving(true);
        setError(null);
        setSaved(false);

        const res = await updateSequencePacing(sequenceId, {
            daily_call_cap: dailyCap.trim() === "" ? null : Number(dailyCap),
            calling_window_start: windowStart || null,
            calling_window_end: windowEnd || null,
            calling_days:
                selectedDays.size === 7 ? null : DAY_KEYS.filter((d) => selectedDays.has(d)),
            pacing_per_minute: pacing.trim() === "" ? null : Number(pacing),
        });

        setSaving(false);
        if (res?.success) {
            setSaved(true);
            router.refresh();
        } else {
            setError(res?.error || "Could not save the calling schedule");
        }
    }

    // --- Rail integration -------------------------------------------------
    // The rail renders one save bar for the whole sidebar, so it needs to know
    // when this panel holds edits and how to commit them. Both are no-ops for
    // the standalone card.
    const draftDays = DAY_KEYS.filter((d) => selectedDays.has(d)).join(",");
    const dirty =
        dailyCap !== serverCap ||
        windowStart !== serverStart ||
        windowEnd !== serverEnd ||
        pacing !== serverPacing ||
        draftDays !== serverDays;

    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    /** Same write as handleSave, but reports failure to the caller instead of
     *  painting inline state, the rail's save bar owns the messaging. */
    const commit = useCallback(async (): Promise<string | null> => {
        if (selectedDays.size === 0) return "Select at least one calling day";
        const res = await updateSequencePacing(sequenceId, {
            daily_call_cap: dailyCap.trim() === "" ? null : Number(dailyCap),
            calling_window_start: windowStart || null,
            calling_window_end: windowEnd || null,
            calling_days:
                selectedDays.size === 7 ? null : DAY_KEYS.filter((d) => selectedDays.has(d)),
            pacing_per_minute: pacing.trim() === "" ? null : Number(pacing),
        });
        return res?.success ? null : res?.error || "Could not save the calling schedule";
    }, [sequenceId, dailyCap, windowStart, windowEnd, pacing, selectedDays]);

    useEffect(() => {
        if (!registerSave) return;
        registerSave(dirty ? commit : null);
        return () => registerSave(null);
    }, [registerSave, commit, dirty]);

    function onChange(setter: (v: string) => void) {
        return (e: React.ChangeEvent<HTMLInputElement>) => {
            setter(e.target.value);
            setSaved(false);
            setError(null);
        };
    }

    const footnote =
        "Voice calls only, in your business timezone. Layered on top of business hours and the 8am to 9pm rule.";

    const fields = (
        <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <label htmlFor="daily-call-cap" className="text-xs text-gray-600">
                        Calls per day
                    </label>
                    <input
                        id="daily-call-cap"
                        type="number"
                        min={1}
                        max={2000}
                        inputMode="numeric"
                        value={dailyCap}
                        onChange={onChange(setDailyCap)}
                        placeholder="No cap"
                        disabled={saving}
                        className={cn(inputClass, "w-24 text-right tabular-nums")}
                    />
                </div>

                <div className="flex items-center justify-between gap-2">
                    <label htmlFor="calling-window-start" className="text-xs text-gray-600">
                        Between
                    </label>
                    <div className="flex items-center gap-1.5">
                        <input
                            id="calling-window-start"
                            type="time"
                            value={windowStart}
                            onChange={onChange(setWindowStart)}
                            disabled={saving}
                            className={cn(inputClass, "w-[6.5rem] tabular-nums")}
                        />
                        <span className="text-xs text-gray-400">to</span>
                        <input
                            aria-label="Calling window end"
                            type="time"
                            value={windowEnd}
                            onChange={onChange(setWindowEnd)}
                            disabled={saving}
                            className={cn(inputClass, "w-[6.5rem] tabular-nums")}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600">On days</span>
                    <div className="flex gap-1" role="group" aria-label="Calling days">
                        {DAY_PICKER.map(({ key, label }) => {
                            const on = selectedDays.has(key);
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggleDay(key)}
                                    disabled={saving}
                                    className={cn(
                                        "rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors",
                                        on
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                            : "border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900",
                                        saving && "opacity-60"
                                    )}
                                >
                                    {label.slice(0, 2)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pacing-per-minute" className="text-xs text-gray-600">
                        Release per minute
                        <span className="ml-1 text-gray-400">(bulk enroll)</span>
                    </label>
                    <input
                        id="pacing-per-minute"
                        type="number"
                        min={1}
                        max={600}
                        inputMode="numeric"
                        value={pacing}
                        onChange={onChange(setPacing)}
                        placeholder="All at once"
                        disabled={saving}
                        className={cn(inputClass, "w-24 text-right tabular-nums")}
                    />
                </div>
        </div>
    );

    // Inside the sequence-detail rail the accordion header carries the title and
    // the rail's save bar carries the commit, so only the fields belong here.
    if (bare) {
        return (
            <div className={cn("space-y-3", className)}>
                {fields}
                <p className="text-[11px] leading-relaxed text-gray-400">{footnote}</p>
            </div>
        );
    }

    return (
        <div className={cn(seqCardStatic, "p-4", className)}>
            <div className="mb-1 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <CalendarClock className="h-3.5 w-3.5 text-gray-400" />
                    Calling Schedule
                </h4>
                {saving && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Saving
                    </span>
                )}
                {!saving && saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <Check className="h-3 w-3" />
                        Saved
                    </span>
                )}
            </div>
            <p className="mb-3 text-xs text-gray-500">{footnote}</p>

            {fields}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(seqBtnPrimary, "mt-3 w-full px-3 py-1.5 text-xs")}
            >
                {saving ? "Saving..." : "Save schedule"}
            </button>
        </div>
    );
}
