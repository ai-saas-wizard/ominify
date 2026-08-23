"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Download, TrendingDown, TrendingUp } from "lucide-react";
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";
import type {
    AnalyticsData,
    AnalyticsRange,
    HeatCell,
    Tone,
} from "@/lib/analytics/types";

// ── Shared tokens ────────────────────────────────────────────────────────────

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500";
const CARD = "rounded-lg border border-gray-200 bg-white";
const SECTION_TITLE = "text-[13px] font-semibold text-gray-900";

/** One hue per meaning, the same mapping the sequences section uses. */
const DOT: Record<Tone, string> = {
    gray: "bg-gray-300",
    muted: "bg-gray-500",
    emerald: "bg-emerald-500",
    blue: "bg-blue-600",
    violet: "bg-violet-600",
    amber: "bg-amber-500",
    red: "bg-red-500",
};

const BAR: Record<Tone, string> = {
    gray: "bg-gray-300",
    muted: "bg-gray-400",
    emerald: "bg-emerald-500",
    blue: "bg-blue-600",
    violet: "bg-violet-600",
    amber: "bg-amber-500",
    red: "bg-red-500",
};

const TEXT: Record<Tone, string> = {
    gray: "text-gray-500",
    muted: "text-gray-600",
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    violet: "text-violet-700",
    amber: "text-amber-700",
    red: "text-red-700",
};

const RANGES: Array<{ key: AnalyticsRange; label: string }> = [
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
    { key: "cycle", label: "This cycle" },
];

const SERIES = [
    { key: "contactRate" as const, label: "Contact rate", color: "#059669" },
    { key: "replyRate" as const, label: "Reply rate", color: "#2563eb" },
    { key: "bookingRate" as const, label: "Booking rate", color: "#7c3aed" },
];

// ── Formatting ───────────────────────────────────────────────────────────────

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "n/a" : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`);

function duration(seconds: number): string {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Heat ramp for the answer-rate grid, capped so 45 percent is full strength. */
function heatStyle(cell: HeatCell): { className: string; text: string } {
    if (cell.rate == null) return { className: "bg-gray-100", text: "text-transparent" };
    const t = Math.min(1, cell.rate / 45);
    if (t > 0.72) return { className: "bg-emerald-600", text: "text-white" };
    if (t > 0.48) return { className: "bg-emerald-400", text: "text-emerald-950" };
    if (t > 0.24) return { className: "bg-emerald-200", text: "text-emerald-900" };
    return { className: "bg-emerald-50", text: "text-gray-600" };
}

// ── Small building blocks ────────────────────────────────────────────────────

function SectionHeader({
    title,
    note,
    right,
}: {
    title: string;
    note?: string;
    right?: React.ReactNode;
}) {
    return (
        <div className="flex items-baseline gap-2 border-b border-gray-100 px-3.5 pb-2.5 pt-3">
            <span className={SECTION_TITLE}>{title}</span>
            {note && <span className="text-[11.5px] text-gray-500">{note}</span>}
            {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </div>
    );
}

function ColLabel({ children, right }: { children?: React.ReactNode; right?: boolean }) {
    return <span className={cn(LABEL, right && "text-right")}>{children}</span>;
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
}: {
    options: Array<{ key: T; label: string }>;
    value: T;
    onChange: (v: T) => void;
    ariaLabel: string;
}) {
    return (
        <div className="flex gap-0.5 rounded-md bg-gray-100 p-0.5" role="group" aria-label={ariaLabel}>
            {options.map((o) => {
                const on = o.key === value;
                return (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(o.key)}
                        className={cn(
                            "h-6 rounded px-2.5 text-[11px] font-medium transition-colors",
                            seqFocusRing,
                            on
                                ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                                : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** A count with a proportional bar, used by intents, objections and blocks. */
function BarRow({
    label,
    value,
    share,
    tone,
    trailing,
}: {
    label: string;
    value: string;
    share: number;
    tone: Tone;
    trailing?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{label}</span>
                {trailing}
                <span className="text-xs font-medium tabular-nums text-gray-900">{value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-sm bg-gray-100">
                <div
                    className={cn("h-full rounded-sm", BAR[tone])}
                    style={{ width: `${Math.max(2, Math.min(100, share))}%` }}
                />
            </div>
        </div>
    );
}

// ── Component ────────────────────────────────────────────────────────────────

type SeqSort = "cpb" | "booked" | "spend";

export function AnalyticsClient({ data }: { data: AnalyticsData }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [compare, setCompare] = useState(true);
    const [hidden, setHidden] = useState<Record<string, boolean>>({});
    const [sort, setSort] = useState<SeqSort>("cpb");
    const [pending, setPending] = useState<AnalyticsRange | null>(null);

    /** The range lives in the URL so the server re-aggregates rather than the browser. */
    function setRange(next: AnalyticsRange) {
        setPending(next);
        const params = new URLSearchParams(searchParams.toString());
        params.set("range", next);
        router.push(`?${params.toString()}`, { scroll: false });
    }

    const sequences = useMemo(() => {
        const rows = [...data.sequences];
        rows.sort((a, b) => {
            if (sort === "booked") return b.booked - a.booked;
            if (sort === "spend") return b.spend - a.spend;
            // Sequences that booked nobody sort last, not first as a null would.
            const av = a.costPerBooking ?? Number.POSITIVE_INFINITY;
            const bv = b.costPerBooking ?? Number.POSITIVE_INFINITY;
            return av - bv;
        });
        return rows;
    }, [data.sequences, sort]);

    const sentimentTotal = data.sentiment.reduce((a, s) => a + s.count, 0);
    const intentMax = Math.max(1, ...data.intents.map((i) => i.count));
    const topicMax = Math.max(1, ...data.topics.map((t) => t.count));

    /** Exports the sequence table as read, so the file matches the screen. */
    function exportCsv() {
        const rows = [
            ["Sequence", "Enrolled", "Touches", "Contact", "Reply", "Booked", "Minutes", "Spend", "Cost per booking"],
            ...sequences.map((s) => [
                s.name,
                String(s.enrolled),
                String(s.touches),
                pct(s.contactRate),
                pct(s.replyRate),
                String(s.booked),
                String(s.minutes),
                s.spend.toFixed(2),
                s.costPerBooking != null ? s.costPerBooking.toFixed(2) : "",
            ]),
        ];
        const csv = rows
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `omnify-analytics-${data.window.key}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const activeRange = pending ?? data.window.key;

    return (
        <div className="flex h-full min-h-0 min-w-[1040px] flex-col bg-gray-50">
            {/* ---- Header ---- */}
            <header className="flex flex-none items-center gap-2.5 border-b border-gray-200 bg-white px-5 pb-3 pt-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <BarChart3 className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                        Analytics
                    </h1>
                    <p className="text-[11.5px] text-gray-500">
                        {data.lowData
                            ? "Early data. Numbers firm up as calls land."
                            : "Outcome and cost reporting across sequences, agents and calls."}
                    </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                    <Segmented
                        options={RANGES}
                        value={activeRange}
                        onChange={setRange}
                        ariaLabel="Reporting range"
                    />
                    <button
                        type="button"
                        aria-pressed={compare}
                        onClick={() => setCompare((v) => !v)}
                        className={cn(
                            "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                            seqFocusRing,
                            compare
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        )}
                    >
                        Compare to previous
                    </button>
                    <button
                        type="button"
                        onClick={exportCsv}
                        className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50",
                            seqFocusRing
                        )}
                    >
                        <Download className="h-3.5 w-3.5 text-gray-500" />
                        Export
                    </button>
                </div>
            </header>

            {/* ---- KPI strip ---- */}
            <div className="grid flex-none grid-cols-6 border-b border-gray-200 bg-white">
                {data.kpis.map((k) => (
                    <div
                        key={k.key}
                        className="flex flex-col gap-1.5 border-r border-gray-100 px-4 py-3 last:border-r-0"
                    >
                        <div className="flex items-center gap-1.5">
                            <span className={cn("h-[5px] w-[5px] rounded-full", DOT[k.tone])} />
                            <span className={LABEL}>{k.label}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span
                                className={cn(
                                    "text-[21px] font-medium tabular-nums tracking-[-0.02em]",
                                    k.value === "n/a" ? "text-gray-400" : "text-gray-900"
                                )}
                            >
                                {k.value}
                            </span>
                            <span className="text-[10.5px] tabular-nums text-gray-500">
                                {k.qualifier}
                            </span>
                            {compare && !data.lowData && k.delta && (
                                <span
                                    className={cn(
                                        "ml-auto inline-flex items-center gap-0.5 text-[10.5px] font-medium tabular-nums",
                                        k.delta.good ? "text-emerald-700" : "text-red-600"
                                    )}
                                    title="Against the previous period of the same length"
                                >
                                    {k.delta.pct >= 0 ? (
                                        <TrendingUp className="h-3 w-3" />
                                    ) : (
                                        <TrendingDown className="h-3 w-3" />
                                    )}
                                    {Math.abs(k.delta.pct).toFixed(1)}%
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {data.lowData && (
                <div className="flex flex-none items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-xs font-medium text-gray-900">Collecting data.</span>
                    <span className="text-xs text-gray-600">{data.lowNote}</span>
                </div>
            )}

            {/* ---- Body ---- */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-3.5">
                <div className="grid grid-cols-12 items-start gap-3.5">
                    {/* Funnel */}
                    <section className={cn(CARD, "col-span-5 flex flex-col self-stretch")}>
                        <SectionHeader title="Outreach funnel" note={data.window.caption} />
                        <div className="flex flex-col gap-3 px-3.5 py-3.5">
                            {data.funnel.map((f) => (
                                <div key={f.key} className="flex flex-col gap-1.5">
                                    <div className="flex items-baseline gap-2">
                                        <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
                                            {f.label}
                                        </span>
                                        {f.rate && (
                                            <span className="text-[11px] tabular-nums text-gray-500">
                                                {f.rate}
                                            </span>
                                        )}
                                        <span className="text-[13px] font-medium tabular-nums text-gray-900">
                                            {int(f.value)}
                                        </span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-sm bg-gray-100">
                                        <div
                                            className={cn("h-full rounded-sm", BAR[f.tone])}
                                            style={{ width: `${Math.max(1.5, f.width)}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Rates over time */}
                    <section className={cn(CARD, "col-span-7 flex flex-col self-stretch")}>
                        <SectionHeader
                            title="Rates over time"
                            right={
                                <div className="flex items-center gap-1.5">
                                    {SERIES.map((s) => {
                                        const off = hidden[s.key];
                                        return (
                                            <button
                                                key={s.key}
                                                type="button"
                                                aria-pressed={!off}
                                                onClick={() =>
                                                    setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))
                                                }
                                                className={cn(
                                                    "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors",
                                                    seqFocusRing,
                                                    off
                                                        ? "text-gray-400"
                                                        : "bg-gray-100 text-gray-900"
                                                )}
                                            >
                                                <span
                                                    className="h-1.5 w-1.5 rounded-full"
                                                    style={{
                                                        background: off ? "#d1d5db" : s.color,
                                                    }}
                                                />
                                                {s.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            }
                        />
                        <div className="flex flex-1 flex-col gap-2 px-3.5 py-3.5">
                            {data.lowData ? (
                                <p className="py-14 text-center text-[12.5px] text-gray-500">
                                    Not enough calls to plot a trend. {data.trendSummary}
                                </p>
                            ) : (
                                <>
                                    <div className="h-[188px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart
                                                data={data.trend}
                                                margin={{ top: 6, right: 4, bottom: 0, left: -18 }}
                                            >
                                                <CartesianGrid
                                                    vertical={false}
                                                    stroke="#f1f2f4"
                                                />
                                                <XAxis
                                                    dataKey="label"
                                                    tick={{ fontSize: 10, fill: "#6b7280" }}
                                                    tickLine={false}
                                                    axisLine={false}
                                                    minTickGap={24}
                                                />
                                                <YAxis
                                                    domain={[0, 100]}
                                                    ticks={[0, 25, 50, 75, 100]}
                                                    tick={{ fontSize: 10, fill: "#6b7280" }}
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tickFormatter={(v) => `${v}%`}
                                                />
                                                <RechartsTooltip
                                                    contentStyle={{
                                                        borderRadius: 8,
                                                        border: "1px solid #e5e7eb",
                                                        fontSize: 12,
                                                    }}
                                                    formatter={(value, name) => {
                                                        const n = Number(value ?? 0);
                                                        return name === "Touches"
                                                            ? [int(n), String(name)]
                                                            : [`${n.toFixed(1)}%`, String(name)];
                                                    }}
                                                />
                                                <Bar
                                                    dataKey="touches"
                                                    name="Touches"
                                                    yAxisId={0}
                                                    fill="#e5e7eb"
                                                    radius={[2, 2, 0, 0]}
                                                    maxBarSize={18}
                                                />
                                                {SERIES.filter((s) => !hidden[s.key]).map((s) => (
                                                    <Line
                                                        key={s.key}
                                                        type="monotone"
                                                        dataKey={s.key}
                                                        name={s.label}
                                                        stroke={s.color}
                                                        strokeWidth={1.8}
                                                        dot={false}
                                                    />
                                                ))}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        Gray bars: touches dispatched per day. {data.trendSummary}
                                    </p>
                                </>
                            )}
                        </div>
                    </section>

                    {/* Sequence performance */}
                    <section className={cn(CARD, "col-span-12")}>
                        <SectionHeader
                            title="Sequence performance"
                            note="Rows flagged amber are spending minutes without booking."
                            right={
                                <Segmented
                                    options={[
                                        { key: "cpb" as SeqSort, label: "Cost per booking" },
                                        { key: "booked" as SeqSort, label: "Booked" },
                                        { key: "spend" as SeqSort, label: "Spend" },
                                    ]}
                                    value={sort}
                                    onChange={setSort}
                                    ariaLabel="Sort sequences"
                                />
                            }
                        />
                        {sequences.length === 0 ? (
                            <p className="px-3.5 py-10 text-center text-[12.5px] text-gray-500">
                                No sequence activity in this range.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <div className="min-w-[900px]">
                                    <div className="grid grid-cols-[minmax(200px,2.2fr)_84px_84px_78px_72px_72px_84px_88px_112px] items-center gap-3 border-b border-gray-200 bg-gray-50 px-3.5 py-2">
                                        <ColLabel>Sequence</ColLabel>
                                        <ColLabel right>Enrolled</ColLabel>
                                        <ColLabel right>Touches</ColLabel>
                                        <ColLabel right>Contact</ColLabel>
                                        <ColLabel right>Reply</ColLabel>
                                        <ColLabel right>Booked</ColLabel>
                                        <ColLabel right>Minutes</ColLabel>
                                        <ColLabel right>Spend</ColLabel>
                                        <ColLabel right>Cost per booking</ColLabel>
                                    </div>
                                    {sequences.map((s) => (
                                        <div
                                            key={s.id}
                                            className={cn(
                                                "grid grid-cols-[minmax(200px,2.2fr)_84px_84px_78px_72px_72px_84px_88px_112px] items-center gap-3 border-b border-gray-50 px-3.5 py-2.5",
                                                s.burning ? "bg-amber-50" : "hover:bg-gray-50"
                                            )}
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        className={cn(
                                                            "h-[5px] w-[5px] shrink-0 rounded-full",
                                                            s.status === "live"
                                                                ? "bg-emerald-500"
                                                                : s.status === "paused"
                                                                  ? "bg-amber-500"
                                                                  : "bg-gray-400"
                                                        )}
                                                    />
                                                    <span className="truncate text-[13px] font-medium text-gray-900">
                                                        {s.name}
                                                    </span>
                                                </span>
                                                <span className="truncate text-[11px] text-gray-500">
                                                    {s.meta}
                                                </span>
                                            </div>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {int(s.enrolled)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {int(s.touches)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-600">
                                                {pct(s.contactRate)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-600">
                                                {pct(s.replyRate)}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-right text-xs tabular-nums",
                                                    s.booked ? "text-violet-700" : "text-gray-300"
                                                )}
                                            >
                                                {s.booked}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {int(s.minutes)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {money(s.spend)}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-right text-xs tabular-nums",
                                                    s.costPerBooking == null
                                                        ? s.burning
                                                            ? "text-red-600"
                                                            : "text-gray-500"
                                                        : s.costPerBooking > 12
                                                          ? "text-amber-700"
                                                          : "text-gray-900"
                                                )}
                                            >
                                                {s.costPerBooking != null
                                                    ? money(s.costPerBooking)
                                                    : s.minutes
                                                      ? "no bookings"
                                                      : "n/a"}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="grid grid-cols-[minmax(200px,2.2fr)_84px_84px_78px_72px_72px_84px_88px_112px] items-center gap-3 bg-gray-50 px-3.5 py-2.5">
                                        <span className="text-xs font-medium text-gray-900">
                                            All sequences
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {int(data.sequenceTotals.enrolled)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {int(data.sequenceTotals.touches)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-600">
                                            {pct(data.sequenceTotals.contactRate)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-600">
                                            {pct(data.sequenceTotals.replyRate)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {data.sequenceTotals.booked}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {int(data.sequenceTotals.minutes)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {money(data.sequenceTotals.spend)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {data.sequenceTotals.costPerBooking != null
                                                ? money(data.sequenceTotals.costPerBooking)
                                                : "n/a"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Agents */}
                    <section className={cn(CARD, "col-span-6 flex flex-col self-stretch")}>
                        <SectionHeader
                            title="Agents"
                            note="Answer rate is calls answered over calls placed."
                        />
                        {data.agents.length === 0 ? (
                            <p className="px-3.5 py-10 text-center text-[12.5px] text-gray-500">
                                No calls placed in this range.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <div className="min-w-[460px]">
                                    <div className="grid grid-cols-[minmax(160px,1fr)_64px_72px_72px_64px_88px] items-center gap-2.5 border-b border-gray-200 bg-gray-50 px-3.5 py-2">
                                        <ColLabel>Agent</ColLabel>
                                        <ColLabel right>Calls</ColLabel>
                                        <ColLabel right>Answer</ColLabel>
                                        <ColLabel right>Avg len</ColLabel>
                                        <ColLabel right>Booked</ColLabel>
                                        <ColLabel right>Cost per bk</ColLabel>
                                    </div>
                                    {data.agents.map((a) => (
                                        <div
                                            key={a.id}
                                            className="grid grid-cols-[minmax(160px,1fr)_64px_72px_72px_64px_88px] items-center gap-2.5 border-b border-gray-50 px-3.5 py-2.5 hover:bg-gray-50"
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="truncate text-[13px] font-medium text-gray-900">
                                                    {a.name}
                                                </span>
                                                <span className="text-[11px] capitalize text-gray-500">
                                                    {a.type}
                                                </span>
                                            </div>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {int(a.calls)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-600">
                                                {pct(a.answerRate)}
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-600">
                                                {duration(a.avgSeconds)}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-right text-xs tabular-nums",
                                                    a.booked ? "text-violet-700" : "text-gray-300"
                                                )}
                                            >
                                                {a.booked}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-right text-xs tabular-nums",
                                                    a.costPerBooking != null && a.costPerBooking > 12
                                                        ? "text-amber-700"
                                                        : "text-gray-900"
                                                )}
                                            >
                                                {a.costPerBooking != null
                                                    ? money(a.costPerBooking)
                                                    : "n/a"}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="grid grid-cols-[minmax(160px,1fr)_64px_72px_72px_64px_88px] items-center gap-2.5 bg-gray-50 px-3.5 py-2.5">
                                        <span className="text-xs font-medium text-gray-900">
                                            All agents
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {int(data.agentTotals.calls)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-600">
                                            {pct(data.agentTotals.answerRate)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-600">
                                            {duration(data.agentTotals.avgSeconds)}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {data.agentTotals.booked}
                                        </span>
                                        <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                            {data.agentTotals.costPerBooking != null
                                                ? money(data.agentTotals.costPerBooking)
                                                : "n/a"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* When calls connect */}
                    <section className={cn(CARD, "col-span-6 flex flex-col self-stretch")}>
                        <SectionHeader
                            title="When calls connect"
                            note="Answer rate by hour, not call volume."
                        />
                        <div className="flex flex-col gap-3 px-3.5 py-3.5">
                            <div className="overflow-x-auto">
                                <div className="min-w-[420px]">
                                    <div
                                        className="grid gap-[3px]"
                                        style={{
                                            gridTemplateColumns: `28px repeat(${data.heatHours.length}, minmax(0, 1fr))`,
                                        }}
                                    >
                                        <span />
                                        {data.heatHours.map((h) => (
                                            <span
                                                key={h}
                                                className="text-center text-[9.5px] tabular-nums text-gray-500"
                                            >
                                                {h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`}
                                            </span>
                                        ))}
                                        {data.heat.map((row, ri) => (
                                            <Fragment key={`row-${ri}`}>
                                                <span className="flex items-center text-[10px] text-gray-500">
                                                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][ri]}
                                                </span>
                                                {row.map((cell, ci) => {
                                                    const st = heatStyle(cell);
                                                    return (
                                                        <span
                                                            key={`${ri}-${ci}`}
                                                            title={
                                                                cell.rate == null
                                                                    ? `${cell.attempts} attempts, too few to rate`
                                                                    : `${Math.round(cell.rate)} percent answered, ${cell.attempts} attempts`
                                                            }
                                                            className={cn(
                                                                "grid h-6 place-items-center rounded-sm text-[9.5px] font-medium tabular-nums",
                                                                st.className,
                                                                st.text
                                                            )}
                                                        >
                                                            {cell.rate == null
                                                                ? ""
                                                                : Math.round(cell.rate)}
                                                        </span>
                                                    );
                                                })}
                                            </Fragment>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-500">
                                Cells with fewer than 5 attempts stay blank.
                            </p>

                            <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
                                <span className={LABEL}>Best windows</span>
                                {data.bestWindows.length === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        Not enough attempts in any hour yet.
                                    </p>
                                ) : (
                                    data.bestWindows.map((b) => (
                                        <div key={b.label} className="flex items-baseline gap-2">
                                            <span className="text-xs font-medium tabular-nums text-gray-900">
                                                {b.label}
                                            </span>
                                            <span className="text-xs tabular-nums text-emerald-700">
                                                {pct(b.rate)}
                                            </span>
                                            <span className="text-[11px] tabular-nums text-gray-500">
                                                {int(b.attempts)} attempts
                                            </span>
                                            <span className="ml-auto text-[11px] tabular-nums text-gray-500">
                                                {b.lift.toFixed(1)}x the average
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </section>

                    {/* What leads say */}
                    <section className={cn(CARD, "col-span-8 flex flex-col self-stretch")}>
                        <SectionHeader
                            title="What leads say"
                            note="From call transcripts and SMS replies in this range."
                        />
                        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-3.5 py-3.5">
                            <div className="col-span-2 flex flex-col gap-2">
                                <span className={LABEL}>Sentiment</span>
                                {sentimentTotal === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        No sentiment recorded yet.
                                    </p>
                                ) : (
                                    <>
                                        <div className="flex h-2.5 overflow-hidden rounded-sm">
                                            {data.sentiment.map((s) => (
                                                <span
                                                    key={s.key}
                                                    className={BAR[s.tone]}
                                                    style={{ flexGrow: Math.max(s.count, 0) }}
                                                    title={`${s.label}, ${s.count}`}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                                            {data.sentiment.map((s) => (
                                                <span
                                                    key={s.key}
                                                    className="inline-flex items-center gap-1.5 text-[11px] text-gray-600"
                                                >
                                                    <span
                                                        className={cn(
                                                            "h-2 w-2 rounded-sm",
                                                            BAR[s.tone]
                                                        )}
                                                    />
                                                    {s.label}
                                                    <span className="tabular-nums text-gray-900">
                                                        {pct((s.count / sentimentTotal) * 100)}
                                                    </span>
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <span className={LABEL}>Intent detected</span>
                                {data.intents.length === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        No replies classified yet.
                                    </p>
                                ) : (
                                    data.intents.map((i) => (
                                        <BarRow
                                            key={i.key}
                                            label={i.label}
                                            value={int(i.count)}
                                            share={(i.count / intentMax) * 100}
                                            tone={i.tone}
                                        />
                                    ))
                                )}
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <span className={LABEL}>Top objections</span>
                                {data.objections.length === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        No objections recorded yet.
                                    </p>
                                ) : (
                                    data.objections.map((o) => (
                                        <div key={o.label} className="flex items-baseline gap-2">
                                            <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
                                                {o.label}
                                            </span>
                                            {o.delta != null && (
                                                <span
                                                    className={cn(
                                                        "text-[11px] tabular-nums",
                                                        o.delta > 0
                                                            ? "text-red-600"
                                                            : "text-emerald-700"
                                                    )}
                                                >
                                                    {o.delta > 0 ? "+" : ""}
                                                    {Math.round(o.delta)}%
                                                </span>
                                            )}
                                            <span className="text-xs font-medium tabular-nums text-gray-900">
                                                {int(o.count)}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="col-span-2 flex flex-col gap-2 border-t border-gray-100 pt-3">
                                <span className={LABEL}>Recurring topics</span>
                                {data.topics.length === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        No topics extracted yet.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {data.topics.map((t) => (
                                            <span
                                                key={t.label}
                                                className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-gray-200 px-2 text-[11px] text-gray-700"
                                            >
                                                {t.label}
                                                <span
                                                    className="tabular-nums text-gray-500"
                                                    style={{
                                                        opacity: 0.5 + (t.count / topicMax) * 0.5,
                                                    }}
                                                >
                                                    {t.count}
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Right column: not delivered, appointments, healing */}
                    <div className="col-span-4 flex flex-col gap-3.5 self-stretch">
                        <section className={CARD}>
                            <SectionHeader
                                title="Not delivered"
                                note={`${int(data.blockedTotal)} blocked or failed`}
                            />
                            <div className="flex flex-col gap-2.5 px-3.5 py-3.5">
                                {data.blocked.length === 0 ? (
                                    <p className="text-[11.5px] text-gray-500">
                                        Every dispatch went out in this range.
                                    </p>
                                ) : (
                                    data.blocked.map((b) => (
                                        <BarRow
                                            key={b.key}
                                            label={b.label}
                                            value={int(b.count)}
                                            share={b.share}
                                            tone={b.tone}
                                            trailing={
                                                <span className="text-[11px] tabular-nums text-gray-500">
                                                    {Math.round(b.share)}%
                                                </span>
                                            }
                                        />
                                    ))
                                )}
                            </div>
                        </section>

                        <section className={CARD}>
                            <SectionHeader title="Appointments" />
                            <div className="grid grid-cols-3 gap-px bg-gray-100">
                                {[
                                    { label: "No shows", value: data.appointments.noShow, tone: "amber" as Tone },
                                    { label: "Cancelled", value: data.appointments.cancelled, tone: "red" as Tone },
                                    { label: "Rescheduled", value: data.appointments.rescheduled, tone: "blue" as Tone },
                                ].map((c) => (
                                    <div
                                        key={c.label}
                                        className="flex flex-col gap-1 bg-white px-3 py-2.5"
                                    >
                                        <span className={LABEL}>{c.label}</span>
                                        <span
                                            className={cn(
                                                "text-[17px] font-medium tabular-nums",
                                                c.value ? TEXT[c.tone] : "text-gray-400"
                                            )}
                                        >
                                            {int(c.value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className={CARD}>
                            <SectionHeader title="Self healing" />
                            <div className="grid grid-cols-2 gap-px bg-gray-100">
                                {[
                                    { label: "Steps rewritten", value: data.healing.mutations },
                                    { label: "Repairs applied", value: data.healing.repairs },
                                ].map((c) => (
                                    <div
                                        key={c.label}
                                        className="flex flex-col gap-1 bg-white px-3 py-2.5"
                                    >
                                        <span className={LABEL}>{c.label}</span>
                                        <span
                                            className={cn(
                                                "text-[17px] font-medium tabular-nums",
                                                c.value ? "text-gray-900" : "text-gray-400"
                                            )}
                                        >
                                            {int(c.value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
