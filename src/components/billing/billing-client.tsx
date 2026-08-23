"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Loader2, Phone, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";
import type {
    DailyUsagePoint,
    MinutePurchase,
    UsageRecord,
} from "@/lib/billing-types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BillingClientProps {
    clientId: string;
    email: string;
    /** Top-up bucket: purchased minutes, never expire. */
    topUpMinutes: number;
    /** Plan bucket: this cycle's allowance, rolls over up to the cap. */
    planMinutes: number;
    planRolloverCap: number;
    totalPurchased: number;
    totalUsed: number;
    /** Lifetime dollars charged for usage. */
    totalBilled: number;
    pricePerMinute: number;
    planName: string;
    planPriceUsd: number | null;
    planIncludedMinutes: number;
    renewsAt: string | null;
    grandfathered: boolean;
    /** CUSTOM accounts bring their own VAPI key and are billed outside Stripe. */
    isCustom: boolean;
    dailyUsage: DailyUsagePoint[];
    usageRecords: UsageRecord[];
    purchases: MinutePurchase[];
}

// ── Formatting ───────────────────────────────────────────────────────────────

const money = (n: number) => `$${n.toFixed(2)}`;
const num = (n: number) => Math.round(n).toLocaleString("en-US");

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function fullDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// ── Shared bits ──────────────────────────────────────────────────────────────

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500";
const CARD = "rounded-lg border border-gray-200 bg-white";
const BTN_SECONDARY =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
    "inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

const PURCHASE_STATUS: Record<string, string> = {
    completed: "bg-gray-100 text-gray-600",
    pending: "bg-amber-50 text-amber-700",
    failed: "bg-red-50 text-red-700",
    refunded: "bg-gray-100 text-gray-600",
};

/** The four fixed packs, plus a free-entry option. Priced at the account rate. */
const PACK_SIZES = [100, 500, 1000, 2500];
const MIN_PURCHASE = 50;

// ── Component ────────────────────────────────────────────────────────────────

export function BillingClient({
    clientId,
    email,
    topUpMinutes,
    planMinutes,
    planRolloverCap,
    totalPurchased,
    totalUsed,
    totalBilled,
    pricePerMinute,
    planName,
    planPriceUsd,
    planIncludedMinutes,
    renewsAt,
    grandfathered,
    isCustom,
    dailyUsage,
    usageRecords,
    purchases,
}: BillingClientProps) {
    const [packIndex, setPackIndex] = useState(1);
    const [custom, setCustom] = useState(false);
    const [customMins, setCustomMins] = useState("");
    const [buying, setBuying] = useState(false);
    const [buyError, setBuyError] = useState<string | null>(null);
    const [portalLoading, setPortalLoading] = useState(false);
    const [tab, setTab] = useState<"calls" | "purchases">("calls");

    const available = topUpMinutes + planMinutes;

    // Runway is only meaningful once there is a usage pattern to divide by.
    const recentDailyAvg = useMemo(() => {
        if (dailyUsage.length === 0) return 0;
        const total = dailyUsage.reduce((a, d) => a + d.minutes, 0);
        return total / dailyUsage.length;
    }, [dailyUsage]);

    const runwayLabel = useMemo(() => {
        if (recentDailyAvg <= 0) return "No calls in the last 14 days.";
        const days = available / recentDailyAvg;
        const rate = `At ${recentDailyAvg.toFixed(1)} minutes a day`;
        if (days >= 60) return `${rate}, about ${Math.round(days / 30)} months of runway.`;
        return `${rate}, about ${Math.round(days)} days of runway.`;
    }, [available, recentDailyAvg]);

    const selectedMinutes = custom
        ? Math.max(0, parseInt(customMins.replace(/[^0-9]/g, ""), 10) || 0)
        : PACK_SIZES[packIndex];
    const selectedPrice = selectedMinutes * pricePerMinute;
    const belowMinimum = selectedMinutes > 0 && selectedMinutes < MIN_PURCHASE;

    const peakDaily = Math.max(1, ...dailyUsage.map((d) => d.minutes));

    const callsSummary = useMemo(() => {
        const mins = usageRecords.reduce((a, r) => a + Number(r.minutes_charged), 0);
        const cost = usageRecords.reduce((a, r) => a + Number(r.price_charged), 0);
        return `${usageRecords.length} calls · ${num(mins)} min · ${money(cost)}`;
    }, [usageRecords]);

    const purchasesSummary = useMemo(() => {
        const spend = purchases
            .filter((p) => p.status === "completed")
            .reduce((a, p) => a + Number(p.amount_paid), 0);
        return `${purchases.length} purchases · ${money(spend)}`;
    }, [purchases]);

    async function handleBuy() {
        if (selectedMinutes < MIN_PURCHASE) return;
        setBuying(true);
        setBuyError(null);
        try {
            const res = await fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientId,
                    email,
                    minutes: selectedMinutes,
                    pricePerMinute,
                    successUrl: `${window.location.origin}/client/${clientId}/billing?success=true`,
                    cancelUrl: `${window.location.origin}/client/${clientId}/billing?canceled=true`,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not start checkout");
            window.location.href = data.url;
        } catch (err) {
            setBuyError(err instanceof Error ? err.message : "Could not start checkout");
            setBuying(false);
        }
    }

    /** Stripe's hosted portal covers invoices and the payment method both. */
    async function openPortal() {
        setPortalLoading(true);
        try {
            const res = await fetch("/api/stripe/portal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not open the billing portal");
            window.location.href = data.url;
        } catch (err) {
            alert(err instanceof Error ? err.message : "Could not open the billing portal");
            setPortalLoading(false);
        }
    }

    /** Exports exactly the rows on screen, so the file matches what was read. */
    function exportCsv() {
        const rows =
            tab === "calls"
                ? [
                      ["Date", "Call ID", "Duration", "Minutes charged", "Cost"],
                      ...usageRecords.map((r) => [
                          new Date(r.recorded_at).toISOString(),
                          r.vapi_call_id,
                          formatDuration(r.duration_seconds),
                          String(r.minutes_charged),
                          r.price_charged.toFixed(2),
                      ]),
                  ]
                : [
                      ["Date", "Pack", "Status", "Amount"],
                      ...purchases.map((p) => [
                          new Date(p.created_at).toISOString(),
                          `${p.minutes_purchased} minutes`,
                          p.status,
                          p.amount_paid.toFixed(2),
                      ]),
                  ];
        const csv = rows
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `omnify-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="flex h-full min-h-0 min-w-[900px] flex-col bg-gray-50">
            {/* ---- Header ---- */}
            <header className="flex flex-none items-center gap-4 border-b border-gray-200 bg-white px-6 pb-3 pt-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                        Billing &amp; usage
                    </h1>
                    <p className="text-[11.5px] text-gray-500">
                        Voice minutes, top-ups and plan.
                    </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                    <button
                        onClick={openPortal}
                        disabled={portalLoading}
                        className={cn(BTN_SECONDARY, seqFocusRing)}
                    >
                        {portalLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <FileText className="h-3.5 w-3.5 text-gray-500" />
                        )}
                        Invoices
                    </button>
                    <a href="#buy-minutes" className={cn(BTN_PRIMARY, seqFocusRing)}>
                        <Plus className="h-3.5 w-3.5" />
                        Buy minutes
                    </a>
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex max-w-[1180px] flex-col gap-4 px-6 pb-10 pt-5">
                    {/* ---- Balance ---- */}
                    <section className={CARD}>
                        <div className="grid grid-cols-[minmax(220px,300px)_minmax(0,1fr)] items-start gap-7 px-[18px] pb-[15px] pt-4">
                            <div className="flex flex-col gap-1.5">
                                <span className={LABEL}>Minutes available</span>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[38px] font-medium leading-none tracking-[-0.03em] tabular-nums text-gray-900">
                                        {num(available)}
                                    </span>
                                    <span className="text-[13px] text-gray-500">min</span>
                                </div>
                                <p className="text-[11.5px] text-gray-500">{runwayLabel}</p>
                            </div>

                            <div className="flex min-w-0 flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-gray-700">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-sm bg-emerald-600" />
                                            Top-up reserve{" "}
                                            <b className="font-medium tabular-nums text-gray-500">
                                                {num(topUpMinutes)}
                                            </b>
                                        </span>
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-sm bg-gray-300" />
                                            Plan allowance{" "}
                                            <b className="font-medium tabular-nums text-gray-500">
                                                {num(planMinutes)} of {num(planRolloverCap)}
                                            </b>
                                        </span>
                                        {renewsAt && (
                                            <span className="ml-auto text-[11px] tabular-nums text-gray-500">
                                                Resets {fullDate(renewsAt)}
                                            </span>
                                        )}
                                    </div>
                                    {/* Two buckets, drawn to scale against each other. */}
                                    <div className="flex h-2 gap-[3px]">
                                        <div
                                            className="rounded-sm bg-emerald-600"
                                            style={{ flexGrow: Math.max(topUpMinutes, 0) }}
                                        />
                                        <div
                                            className="rounded-sm bg-gray-100 shadow-[inset_0_0_0_1px_#e5e7eb]"
                                            style={{ flexGrow: Math.max(planRolloverCap, 1) }}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-gray-100 bg-gray-100">
                                    {[
                                        { label: "Minutes used", value: `${num(totalUsed)} min` },
                                        { label: "Usage billed", value: money(totalBilled) },
                                        {
                                            label: "Top-up rate",
                                            value: `${money(pricePerMinute)}/min`,
                                        },
                                        {
                                            label: "Purchased",
                                            value: `${num(totalPurchased)} min`,
                                        },
                                    ].map((c) => (
                                        <div
                                            key={c.label}
                                            className="flex flex-col gap-0.5 bg-white px-3 py-2.5"
                                        >
                                            <span className={LABEL}>{c.label}</span>
                                            <span className="text-sm tabular-nums text-gray-900">
                                                {c.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 border-t border-gray-100 px-[18px] pb-3.5 pt-3">
                            <div className="flex items-baseline gap-2.5">
                                <span className={LABEL}>Minutes per day, last 14 days</span>
                                <span className="text-[11px] tabular-nums text-gray-500">
                                    avg {recentDailyAvg.toFixed(1)} · peak {num(peakDaily)}
                                </span>
                            </div>
                            <div className="flex h-[46px] items-end gap-[5px]">
                                {dailyUsage.map((d) => (
                                    <div
                                        key={d.date}
                                        className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                                        title={`${d.date}: ${num(d.minutes)} min`}
                                    >
                                        <div
                                            className={cn(
                                                "w-full rounded-t-sm",
                                                d.minutes === 0
                                                    ? "bg-gray-200"
                                                    : d.minutes >= peakDaily * 0.7
                                                      ? "bg-emerald-600"
                                                      : "bg-emerald-300"
                                            )}
                                            style={{
                                                height: `${Math.max(2, Math.round((d.minutes / peakDaily) * 34))}px`,
                                            }}
                                        />
                                        <span className="text-[9.5px] tabular-nums text-gray-500">
                                            {d.date.slice(8)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* ---- Buy minutes + Plan ---- */}
                    <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)] items-start gap-4">
                        <section id="buy-minutes" className={cn(CARD, "flex flex-col")}>
                            <div className="flex items-baseline gap-2.5 border-b border-gray-100 px-4 pb-3 pt-3.5">
                                <span className="text-[13px] font-semibold text-gray-900">
                                    Buy minutes
                                </span>
                                <span className="text-[11.5px] text-gray-500">
                                    Never expire. Spent after the plan allowance.
                                </span>
                            </div>
                            <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
                                <div className="grid grid-cols-5 gap-2">
                                    {PACK_SIZES.map((mins, i) => {
                                        const on = !custom && i === packIndex;
                                        return (
                                            <button
                                                key={mins}
                                                type="button"
                                                aria-pressed={on}
                                                onClick={() => {
                                                    setPackIndex(i);
                                                    setCustom(false);
                                                    setBuyError(null);
                                                }}
                                                className={cn(
                                                    "flex flex-col gap-1.5 rounded-md border px-2.5 pb-2.5 pt-3 text-left transition-colors",
                                                    seqFocusRing,
                                                    on
                                                        ? "border-emerald-600 bg-emerald-50/60"
                                                        : "border-gray-200 bg-white hover:border-gray-300"
                                                )}
                                            >
                                                <span className="text-[15px] font-medium tabular-nums text-gray-900">
                                                    {num(mins)}
                                                </span>
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                                    minutes
                                                </span>
                                                <span
                                                    className={cn(
                                                        "text-xs tabular-nums",
                                                        on ? "text-emerald-700" : "text-gray-500"
                                                    )}
                                                >
                                                    {money(mins * pricePerMinute)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    <div
                                        className={cn(
                                            "flex flex-col gap-1.5 rounded-md border px-2.5 pb-2.5 pt-3 transition-colors",
                                            custom
                                                ? "border-emerald-600 bg-emerald-50/60"
                                                : "border-gray-200 bg-white hover:border-gray-300"
                                        )}
                                    >
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={customMins}
                                            aria-label="Custom minute amount"
                                            placeholder="0"
                                            onFocus={() => setCustom(true)}
                                            onChange={(e) => {
                                                setCustom(true);
                                                setCustomMins(e.target.value);
                                                setBuyError(null);
                                            }}
                                            className="w-full border-0 bg-transparent p-0 text-[15px] font-medium tabular-nums text-gray-900 outline-none placeholder:text-gray-300"
                                        />
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                            custom
                                        </span>
                                        <span
                                            className={cn(
                                                "text-xs tabular-nums",
                                                custom ? "text-emerald-700" : "text-gray-500"
                                            )}
                                        >
                                            {custom && selectedMinutes
                                                ? money(selectedPrice)
                                                : `${money(pricePerMinute)}/min`}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2.5 rounded-md border border-gray-100 bg-gray-50 px-3 py-2.5">
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-xs text-gray-600">
                                            {selectedMinutes
                                                ? `${num(selectedMinutes)} minutes at ${money(pricePerMinute)} per minute`
                                                : "Enter how many minutes to add"}
                                        </span>
                                        <span
                                            className={cn(
                                                "text-[11px] tabular-nums",
                                                belowMinimum ? "text-amber-700" : "text-gray-500"
                                            )}
                                        >
                                            {belowMinimum
                                                ? `Minimum ${MIN_PURCHASE} minutes`
                                                : `Balance after purchase: ${num(available + selectedMinutes)} min`}
                                        </span>
                                    </div>
                                    <span className="text-[19px] font-medium tracking-[-0.02em] tabular-nums text-gray-900">
                                        {money(selectedPrice)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleBuy}
                                        disabled={selectedMinutes < MIN_PURCHASE || buying}
                                        className={cn(BTN_PRIMARY, "h-[34px] px-4", seqFocusRing)}
                                    >
                                        {buying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        {buying ? "Redirecting" : "Charge card"}
                                    </button>
                                </div>

                                {buyError && (
                                    <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                                        {buyError}
                                    </p>
                                )}
                            </div>
                        </section>

                        <section className={cn(CARD, "flex flex-col")}>
                            <div className="flex items-center gap-2 border-b border-gray-100 px-4 pb-3 pt-3.5">
                                <span className="flex-1 text-[13px] font-semibold text-gray-900">
                                    Plan
                                </span>
                                {grandfathered && (
                                    <span className="inline-flex h-5 items-center rounded bg-blue-50 px-1.5 text-[10.5px] font-semibold tracking-[0.03em] text-blue-700">
                                        Grandfathered
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-col gap-3.5 px-4 pb-4 pt-3.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-xl font-semibold tracking-[-0.015em] text-gray-900">
                                        {planName}
                                    </span>
                                    {planPriceUsd != null && (
                                        <span className="text-[13px] tabular-nums text-gray-500">
                                            {money(planPriceUsd)} / month
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2">
                                    {[
                                        {
                                            label: "Included minutes",
                                            value: `${num(planIncludedMinutes)} / mo`,
                                        },
                                        {
                                            label: "Renews",
                                            value: renewsAt ? fullDate(renewsAt) : "Not scheduled",
                                        },
                                    ].map((r) => (
                                        <div
                                            key={r.label}
                                            className="flex items-baseline justify-between gap-2"
                                        >
                                            <span className="text-xs text-gray-500">{r.label}</span>
                                            <span className="text-[12.5px] tabular-nums text-gray-900">
                                                {r.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="h-px bg-gray-100" />

                                <div className="flex flex-col gap-2">
                                    {/* CUSTOM accounts are invoiced outside Stripe, so the
                                        portal would 404 for them. */}
                                    {!isCustom && (
                                        <button
                                            type="button"
                                            onClick={openPortal}
                                            disabled={portalLoading}
                                            className={cn(
                                                BTN_SECONDARY,
                                                "h-[30px] w-full justify-center",
                                                seqFocusRing
                                            )}
                                        >
                                            Update payment method
                                        </button>
                                    )}
                                    <p className="text-[11px] leading-relaxed text-gray-500">
                                        {isCustom
                                            ? "This account is billed outside Stripe. Contact support to change the plan."
                                            : "Plan changes are handled by support. Contact us to move up or down."}
                                    </p>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* ---- Usage ---- */}
                    <section className={cn(CARD, "flex flex-col")}>
                        <div className="flex items-center gap-3 border-b border-gray-100 px-4 pb-2.5 pt-3">
                            <div
                                className="flex gap-0.5 rounded-md bg-gray-100 p-0.5"
                                role="group"
                                aria-label="Usage view"
                            >
                                {(["calls", "purchases"] as const).map((t) => {
                                    const on = tab === t;
                                    return (
                                        <button
                                            key={t}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() => setTab(t)}
                                            className={cn(
                                                "h-6 rounded px-2.5 text-[11px] font-medium capitalize transition-colors",
                                                seqFocusRing,
                                                on
                                                    ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]"
                                                    : "text-gray-600 hover:text-gray-900"
                                            )}
                                        >
                                            {t}
                                        </button>
                                    );
                                })}
                            </div>
                            <span className="text-[11px] tabular-nums text-gray-500">
                                {tab === "calls" ? callsSummary : purchasesSummary}
                            </span>
                            <button
                                type="button"
                                onClick={exportCsv}
                                className={cn(BTN_SECONDARY, "ml-auto h-7", seqFocusRing)}
                            >
                                <Download className="h-3 w-3" />
                                Export CSV
                            </button>
                        </div>

                        {tab === "calls" ? (
                            usageRecords.length === 0 ? (
                                <p className="px-4 py-12 text-center text-[12.5px] text-gray-500">
                                    No calls recorded yet. Usage appears here once your agents
                                    start dialling.
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <div className="min-w-[640px]">
                                        <div className="grid grid-cols-[150px_minmax(0,1fr)_100px_92px_78px] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
                                            <span className={LABEL}>When</span>
                                            <span className={LABEL}>Call</span>
                                            <span className={cn(LABEL, "text-right")}>Duration</span>
                                            <span className={cn(LABEL, "text-right")}>Charged</span>
                                            <span className={cn(LABEL, "text-right")}>Cost</span>
                                        </div>
                                        {usageRecords.map((r) => (
                                            <div
                                                key={r.id}
                                                className="grid grid-cols-[150px_minmax(0,1fr)_100px_92px_78px] items-center gap-3 border-b border-gray-50 px-4 py-2.5 transition-colors hover:bg-gray-50"
                                            >
                                                <span className="text-xs tabular-nums text-gray-900">
                                                    {shortDate(r.recorded_at)}{" "}
                                                    <span className="text-gray-500">
                                                        {new Date(r.recorded_at).toLocaleTimeString(
                                                            [],
                                                            { hour: "2-digit", minute: "2-digit" }
                                                        )}
                                                    </span>
                                                </span>
                                                <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
                                                    <Phone className="h-3 w-3 flex-none text-gray-400" />
                                                    <span className="truncate tabular-nums">
                                                        {r.vapi_call_id.slice(0, 8)}
                                                    </span>
                                                </span>
                                                <span className="text-right text-xs tabular-nums text-gray-900">
                                                    {formatDuration(r.duration_seconds)}
                                                </span>
                                                <span className="text-right text-xs tabular-nums text-gray-600">
                                                    {r.minutes_charged} min
                                                </span>
                                                <span className="text-right text-xs tabular-nums text-gray-900">
                                                    {money(Number(r.price_charged))}
                                                </span>
                                            </div>
                                        ))}
                                        <div className="grid grid-cols-[150px_minmax(0,1fr)_100px_92px_78px] items-center gap-3 bg-gray-50 px-4 py-2.5">
                                            <span className="text-xs font-medium text-gray-900">
                                                Shown total
                                            </span>
                                            <span />
                                            <span />
                                            <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                                {num(
                                                    usageRecords.reduce(
                                                        (a, r) => a + Number(r.minutes_charged),
                                                        0
                                                    )
                                                )}{" "}
                                                min
                                            </span>
                                            <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                                                {money(
                                                    usageRecords.reduce(
                                                        (a, r) => a + Number(r.price_charged),
                                                        0
                                                    )
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        ) : purchases.length === 0 ? (
                            <p className="px-4 py-12 text-center text-[12.5px] text-gray-500">
                                No purchases yet.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <div className="min-w-[560px]">
                                    <div className="grid grid-cols-[130px_minmax(0,1fr)_110px_100px] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
                                        <span className={LABEL}>Date</span>
                                        <span className={LABEL}>Pack</span>
                                        <span className={LABEL}>Status</span>
                                        <span className={cn(LABEL, "text-right")}>Amount</span>
                                    </div>
                                    {purchases.map((p) => (
                                        <div
                                            key={p.id}
                                            className="grid grid-cols-[130px_minmax(0,1fr)_110px_100px] items-center gap-3 border-b border-gray-50 px-4 py-2.5 transition-colors hover:bg-gray-50"
                                        >
                                            <span className="text-xs tabular-nums text-gray-900">
                                                {shortDate(p.created_at)}
                                            </span>
                                            <span className="truncate text-xs text-gray-900">
                                                {num(p.minutes_purchased)} minutes
                                                {p.kind === "subscription_grant" && (
                                                    <span className="ml-1.5 text-gray-500">
                                                        (plan grant)
                                                    </span>
                                                )}
                                                {p.kind === "subscription_rollover_trim" && (
                                                    <span className="ml-1.5 text-gray-500">
                                                        (rollover trim)
                                                    </span>
                                                )}
                                            </span>
                                            <span>
                                                <span
                                                    className={cn(
                                                        "inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-medium",
                                                        PURCHASE_STATUS[p.status] ||
                                                            "bg-gray-100 text-gray-600"
                                                    )}
                                                >
                                                    {p.status}
                                                </span>
                                            </span>
                                            <span className="text-right text-xs tabular-nums text-gray-900">
                                                {money(Number(p.amount_paid))}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
