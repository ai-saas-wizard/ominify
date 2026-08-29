import { supabase } from "@/lib/supabase";
import type {
    AgentRow,
    AgentTotals,
    AnalyticsData,
    AnalyticsRange,
    BestWindow,
    BlockedReason,
    FunnelStage,
    HeatCell,
    Kpi,
    ObjectionRow,
    RangeWindow,
    SequenceRow,
    SequenceStatus,
    TableTotals,
    Tally,
    TopicRow,
    TrendPoint,
} from "./types";

export * from "./types";

/**
 * Server-side aggregation for the Analytics page.
 *
 * Everything is computed here so the client component receives plain numbers
 * and never re-derives a rate two different ways. The range is a server
 * concern: re-aggregating on the server keeps the page honest for accounts
 * with tens of thousands of rows, where shipping the raw records to the
 * browser would not be viable.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Hours the heatmap covers. Outside these, dialling is not allowed anyway. */
export const HEATMAP_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A cell needs this many attempts before its rate is shown. Without a floor a
 * single lucky call reads as a 100 percent hour and the operator calls at the
 * wrong time.
 */
const MIN_ATTEMPTS_PER_CELL = 5;

/** Below this the page hides rates entirely and says so. */
const LOW_DATA_CALLS = 30;

/**
 * VAPI end reasons that mean nobody picked up. Everything else counts as a
 * connected call, so a new reason string is treated as answered rather than
 * silently deflating the answer rate.
 */
const NO_ANSWER_REASONS = new Set([
    "customer-did-not-answer",
    "customer-busy",
    "no-answer",
    "voicemail",
    "customer-did-not-give-microphone-permission",
    "twilio-failed-to-connect-call",
    "vonage-failed-to-connect-call",
]);

/** Dispatch outcomes that are not a send, with why they read the way they do. */
const BLOCKED_LABELS: Record<string, { label: string; tone: BlockedReason["tone"] }> = {
    skipped_capacity: { label: "Skipped, daily cap reached", tone: "amber" },
    skipped_opt_out: { label: "Skipped, opted out", tone: "muted" },
    skipped_conditions: { label: "Skipped, conditions not met", tone: "muted" },
    skipped_meeting_booked: { label: "Stopped, meeting booked", tone: "emerald" },
    held_contact_fatigue: { label: "Held, contact fatigue", tone: "amber" },
    blocked_placeholder: { label: "Blocked, placeholder in body", tone: "red" },
    blocked_empty_body: { label: "Blocked, empty body", tone: "red" },
    failed: { label: "Failed, provider error", tone: "red" },
    skipped: { label: "Skipped", tone: "muted" },
};

const SENTIMENT_ORDER: Array<{ key: string; label: string; tone: Tally["tone"] }> = [
    { key: "interested", label: "Interested", tone: "emerald" },
    { key: "positive", label: "Positive", tone: "emerald" },
    { key: "neutral", label: "Neutral", tone: "gray" },
    { key: "objection", label: "Objection", tone: "amber" },
    { key: "confused", label: "Confused", tone: "amber" },
    { key: "negative", label: "Negative", tone: "red" },
];

const INTENT_ORDER: Array<{ key: string; label: string; tone: Tally["tone"] }> = [
    { key: "interested", label: "Interested", tone: "emerald" },
    { key: "question", label: "Question", tone: "blue" },
    { key: "reschedule", label: "Reschedule", tone: "violet" },
    { key: "not_interested", label: "Not interested", tone: "amber" },
    { key: "stop", label: "Stop", tone: "red" },
    { key: "unknown", label: "Unknown", tone: "gray" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Local calendar day key, so day bucketing never disagrees with itself. */
function dayKey(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

function rate(part: number, whole: number): number | null {
    if (!whole) return null;
    return (part / whole) * 100;
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pctText = (n: number | null) => (n == null ? "n/a" : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`);

/**
 * Supabase puts `.in()` filters in the URL, so a client with thousands of
 * enrollments would blow the length limit. Query in chunks and concatenate.
 */
async function inChunks<T>(
    ids: string[],
    run: (chunk: string[]) => Promise<T[]>,
    size = 200
): Promise<T[]> {
    if (ids.length === 0) return [];
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += size) {
        out.push(...(await run(ids.slice(i, i + size))));
    }
    return out;
}

/** Resolve a range key into this window and the one immediately before it. */
export function resolveWindow(range: AnalyticsRange): RangeWindow {
    const end = new Date();
    const start = new Date(end);
    let days: number;
    let label: string;

    if (range === "cycle") {
        // Calendar month to date, which is what the billing cycle follows.
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
        label = "This cycle";
    } else {
        days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
        start.setDate(end.getDate() - (days - 1));
        start.setHours(0, 0, 0, 0);
        label = `${days} days`;
    }

    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(start);
    prevStart.setDate(start.getDate() - days);

    return {
        key: range,
        label,
        caption: range === "cycle" ? "This cycle" : `Last ${days} days`,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        prevStartIso: prevStart.toISOString(),
        prevEndIso: prevEnd.toISOString(),
        days,
    };
}

function delta(current: number, previous: number, higherIsBetter: boolean): Kpi["delta"] {
    if (!previous) return null;
    const pct = ((current - previous) / previous) * 100;
    return { pct, good: higherIsBetter ? pct >= 0 : pct <= 0 };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export async function getAnalytics(
    clientId: string,
    range: AnalyticsRange
): Promise<AnalyticsData> {
    const w = resolveWindow(range);

    // One pass over everything the page needs. Each query is scoped to the
    // client and to the window (or the two windows, where a delta is shown).
    const [
        billingRes,
        enrollRes,
        prevEnrollRes,
        seqRes,
        agentRes,
        callsRes,
        prevUsageRes,
        usageRes,
        apptRes,
    ] = await Promise.all([
        supabase.from("client_billing").select("price_per_minute").eq("client_id", clientId).maybeSingle(),
        supabase
            .from("sequence_enrollments")
            .select(
                "id, sequence_id, status, enrolled_at, contact_replied, contact_answered_call, appointment_booked, is_test"
            )
            .eq("tenant_id", clientId)
            .gte("enrolled_at", w.startIso),
        supabase
            .from("sequence_enrollments")
            .select("id, appointment_booked, contact_replied, contact_answered_call, is_test")
            .eq("tenant_id", clientId)
            .gte("enrolled_at", w.prevStartIso)
            .lte("enrolled_at", w.prevEndIso),
        supabase
            .from("sequences")
            .select("id, name, is_active, generation_mode, sequence_strategy")
            .eq("client_id", clientId),
        supabase.from("agents").select("id, name, agent_type").eq("client_id", clientId),
        supabase
            .from("calls")
            .select("vapi_call_id, agent_id, duration_seconds, ended_reason, started_at")
            .eq("client_id", clientId)
            .eq("is_hidden", false)
            .gte("started_at", w.startIso),
        supabase
            .from("usage_records")
            .select("minutes_charged, price_charged")
            .eq("client_id", clientId)
            .gte("recorded_at", w.prevStartIso)
            .lte("recorded_at", w.prevEndIso),
        supabase
            .from("usage_records")
            .select("vapi_call_id, minutes_charged, price_charged, recorded_at")
            .eq("client_id", clientId)
            .gte("recorded_at", w.startIso),
        supabase
            .from("appointments")
            .select("status, vapi_call_id, created_at")
            .eq("client_id", clientId)
            .gte("created_at", w.startIso),
    ]);

    const pricePerMinute = Number(billingRes.data?.price_per_minute ?? 0.15);

    // Test enrollments exist to prove the pipeline works, not to be measured.
    const enrollments = (enrollRes.data || []).filter((e) => !e.is_test);
    const prevEnrollments = (prevEnrollRes.data || []).filter((e) => !e.is_test);
    const sequences = seqRes.data || [];
    const agents = agentRes.data || [];
    const calls = callsRes.data || [];
    const prevUsage = prevUsageRes.data || [];
    const usage = usageRes.data || [];
    const appointments = apptRes.data || [];

    // Interactions and dispatch logs hang off enrollments, so scope them by the
    // client's own enrollment ids rather than trusting a denormalized column.
    const allEnrollRes = await supabase
        .from("sequence_enrollments")
        .select("id, sequence_id, is_test")
        .eq("tenant_id", clientId);
    const liveEnrollments = (allEnrollRes.data || []).filter((e) => !e.is_test);
    const enrollmentIds = liveEnrollments.map((e) => e.id);
    const sequenceOfEnrollment = new Map(liveEnrollments.map((e) => [e.id, e.sequence_id]));

    const [interactions, prevInteractions, execLogs] = await Promise.all([
        supabase
            .from("contact_interactions")
            .select(
                "enrollment_id, channel, direction, outcome, sentiment, intent, call_duration_seconds, appointment_booked, objections_raised, key_topics, created_at"
            )
            .eq("client_id", clientId)
            .gte("created_at", w.startIso)
            .then((r) => r.data || []),
        supabase
            .from("contact_interactions")
            .select("objections_raised, direction, created_at")
            .eq("client_id", clientId)
            .gte("created_at", w.prevStartIso)
            .lte("created_at", w.prevEndIso)
            .then((r) => r.data || []),
        inChunks(enrollmentIds, async (chunk) => {
            const { data } = await supabase
                .from("sequence_execution_log")
                .select("enrollment_id, status, executed_at")
                .in("enrollment_id", chunk)
                .gte("executed_at", w.startIso);
            return data || [];
        }),
    ]);

    // ── Headline counts ──────────────────────────────────────────────────────

    const outbound = interactions.filter((i) => i.direction === "outbound");
    const inbound = interactions.filter((i) => i.direction === "inbound");
    const touches = outbound.length;
    const contacted =
        outbound.filter((i) => i.outcome === "answered" || i.outcome === "replied").length +
        inbound.length;
    const replied = inbound.length;
    const bookedCount =
        appointments.filter((a) => a.status === "booked").length ||
        enrollments.filter((e) => e.appointment_booked).length;

    const minutesUsed = usage.reduce((a, u) => a + Number(u.minutes_charged || 0), 0);
    const spend = usage.reduce((a, u) => a + Number(u.price_charged || 0), 0);

    const contactRate = rate(contacted, touches);
    const replyRate = rate(replied, contacted);
    const lowData = calls.length < LOW_DATA_CALLS;

    const prevBooked = prevEnrollments.filter((e) => e.appointment_booked).length;
    const prevContacted = prevEnrollments.filter(
        (e) => e.contact_answered_call || e.contact_replied
    ).length;
    const prevTouches = prevInteractions.filter((i) => i.direction === "outbound").length;
    const prevMinutes = prevUsage.reduce((a, u) => a + Number(u.minutes_charged || 0), 0);

    const kpis: Kpi[] = [
        {
            key: "touches",
            label: "Touches sent",
            value: int(touches),
            qualifier: "voice and SMS",
            tone: "muted",
            delta: delta(touches, prevTouches, true),
        },
        {
            key: "contact",
            label: "Contact rate",
            value: lowData ? "n/a" : pctText(contactRate),
            qualifier: "answered or replied",
            tone: "emerald",
            delta: delta(contacted, prevContacted, true),
        },
        {
            key: "reply",
            label: "Reply rate",
            value: lowData ? "n/a" : pctText(replyRate),
            qualifier: "of contacts",
            tone: "blue",
            delta: null,
        },
        {
            key: "booked",
            label: "Booked",
            value: int(bookedCount),
            qualifier: enrollments.length
                ? `${pctText(rate(bookedCount, enrollments.length))} of enrolled`
                : "",
            tone: "violet",
            delta: delta(bookedCount, prevBooked, true),
        },
        {
            key: "cpb",
            label: "Cost per booking",
            value: bookedCount ? money(spend / bookedCount) : "n/a",
            qualifier: "approximate",
            tone: "amber",
            delta: null,
        },
        {
            key: "minutes",
            label: "Minutes used",
            value: int(minutesUsed),
            qualifier: money(spend),
            tone: "gray",
            // More minutes is not itself good news, so the arrow reads inverted.
            delta: delta(minutesUsed, prevMinutes, false),
        },
    ];

    // ── Funnel ───────────────────────────────────────────────────────────────
    // A cohort funnel: leads enrolled inside the window, and what became of
    // them. Mixing a windowed touch count with a lifetime outcome flag would
    // let a stage exceed the one above it.

    const cohortContacted = enrollments.filter(
        (e) => e.contact_answered_call || e.contact_replied
    ).length;
    const cohortReplied = enrollments.filter((e) => e.contact_replied).length;
    const cohortBooked = enrollments.filter(
        (e) => e.appointment_booked || e.status === "booked"
    ).length;
    const widest = Math.max(enrollments.length, touches, 1);

    const funnel: FunnelStage[] = [
        {
            key: "enrolled",
            label: "Leads enrolled",
            value: enrollments.length,
            rate: "",
            tone: "gray",
            width: (enrollments.length / widest) * 100,
        },
        {
            key: "touches",
            label: "Touches dispatched",
            value: touches,
            rate: enrollments.length
                ? `${(touches / enrollments.length).toFixed(1)} per lead`
                : "",
            tone: "muted",
            width: (touches / widest) * 100,
        },
        {
            key: "contacted",
            label: "Contacted",
            value: cohortContacted,
            rate: lowData ? "n/a" : `${pctText(rate(cohortContacted, enrollments.length))} of enrolled`,
            tone: "emerald",
            width: (cohortContacted / widest) * 100,
        },
        {
            key: "replied",
            label: "Replied",
            value: cohortReplied,
            rate: lowData ? "n/a" : `${pctText(rate(cohortReplied, cohortContacted))} of contacts`,
            tone: "blue",
            width: (cohortReplied / widest) * 100,
        },
        {
            key: "booked",
            label: "Booked",
            value: cohortBooked,
            rate: lowData ? "n/a" : `${pctText(rate(cohortBooked, cohortReplied))} of replies`,
            tone: "violet",
            width: (cohortBooked / widest) * 100,
        },
    ];

    // ── Trend ────────────────────────────────────────────────────────────────

    const trendDays: TrendPoint[] = [];
    const dayBuckets = new Map<string, { touches: number; contacted: number; replied: number; booked: number }>();
    const cursor = new Date(w.startIso);
    for (let i = 0; i < w.days; i++) {
        const d = new Date(cursor);
        d.setDate(cursor.getDate() + i);
        dayBuckets.set(dayKey(d), { touches: 0, contacted: 0, replied: 0, booked: 0 });
    }
    for (const i of interactions) {
        const k = dayKey(new Date(i.created_at));
        const b = dayBuckets.get(k);
        if (!b) continue;
        if (i.direction === "outbound") {
            b.touches += 1;
            if (i.outcome === "answered" || i.outcome === "replied") b.contacted += 1;
        } else {
            b.contacted += 1;
            b.replied += 1;
        }
        if (i.appointment_booked) b.booked += 1;
    }
    for (const [date, b] of dayBuckets) {
        trendDays.push({
            date,
            label: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            touches: b.touches,
            contactRate: rate(b.contacted, b.touches) ?? 0,
            replyRate: rate(b.replied, b.touches) ?? 0,
            bookingRate: rate(b.booked, b.touches) ?? 0,
        });
    }

    const trendSummary = lowData
        ? `${calls.length} calls in this range. A trend appears at ${LOW_DATA_CALLS}.`
        : `Contact rate ${pctText(contactRate)}, reply rate ${pctText(replyRate)}, booking rate ${pctText(rate(bookedCount, touches))}.`;

    // ── Per sequence ─────────────────────────────────────────────────────────
    // Voice minutes are attributed through the enrollment that generated the
    // call, which is exact, rather than through calls -> agent -> sequence,
    // which would misattribute any agent bound to more than one sequence.

    const perSequence = new Map<
        string,
        { touches: number; contacted: number; replied: number; seconds: number }
    >();
    for (const i of interactions) {
        const seqId = i.enrollment_id ? sequenceOfEnrollment.get(i.enrollment_id) : null;
        if (!seqId) continue;
        const acc = perSequence.get(seqId) || { touches: 0, contacted: 0, replied: 0, seconds: 0 };
        if (i.direction === "outbound") {
            acc.touches += 1;
            if (i.outcome === "answered" || i.outcome === "replied") acc.contacted += 1;
        } else {
            acc.contacted += 1;
            acc.replied += 1;
        }
        acc.seconds += Number(i.call_duration_seconds || 0);
        perSequence.set(seqId, acc);
    }

    const enrollBySequence = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
        const list = enrollBySequence.get(e.sequence_id) || [];
        list.push(e);
        enrollBySequence.set(e.sequence_id, list);
    }

    const sequenceRows: SequenceRow[] = sequences
        .map((s) => {
            const acc = perSequence.get(s.id) || { touches: 0, contacted: 0, replied: 0, seconds: 0 };
            const cohort = enrollBySequence.get(s.id) || [];
            const booked = cohort.filter((e) => e.appointment_booked || e.status === "booked").length;
            const minutes = Math.round(acc.seconds / 60);
            const seqSpend = minutes * pricePerMinute;
            const strategy = (s.sequence_strategy || {}) as Record<string, unknown>;
            const channels = Array.isArray(strategy.available_channels)
                ? (strategy.available_channels as string[])
                : [];
            const status: SequenceStatus = s.is_active
                ? "live"
                : cohort.length > 0
                  ? "paused"
                  : "draft";
            return {
                id: s.id,
                name: s.name,
                meta: [
                    s.generation_mode === "dynamic" ? "AI driven" : "Fixed steps",
                    channels.length ? channels.join(" and ") : null,
                ]
                    .filter(Boolean)
                    .join(", "),
                status,
                enrolled: cohort.length,
                touches: acc.touches,
                contactRate: lowData ? null : rate(acc.contacted, acc.touches),
                replyRate: lowData ? null : rate(acc.replied, acc.contacted),
                booked,
                minutes,
                spend: seqSpend,
                costPerBooking: booked ? seqSpend / booked : null,
                // Spent real dialling minutes over the window and booked nobody.
                burning: minutes > 40 && booked === 0,
            };
        })
        .filter((r) => r.enrolled > 0 || r.touches > 0 || r.minutes > 0);

    const seqTotalMinutes = sequenceRows.reduce((a, r) => a + r.minutes, 0);
    const seqTotalBooked = sequenceRows.reduce((a, r) => a + r.booked, 0);
    const seqTotalSpend = seqTotalMinutes * pricePerMinute;
    const sequenceTotals: TableTotals = {
        enrolled: enrollments.length,
        touches,
        contactRate: lowData ? null : contactRate,
        replyRate: lowData ? null : replyRate,
        booked: seqTotalBooked,
        minutes: seqTotalMinutes,
        spend: seqTotalSpend,
        costPerBooking: seqTotalBooked ? seqTotalSpend / seqTotalBooked : null,
    };

    // ── Per agent ────────────────────────────────────────────────────────────

    const usageByCall = new Map(usage.map((u) => [u.vapi_call_id, u]));
    const apptCallIds = new Set(
        appointments.filter((a) => a.status === "booked" && a.vapi_call_id).map((a) => a.vapi_call_id)
    );

    const agentRows: AgentRow[] = agents
        .map((a) => {
            const own = calls.filter((c) => c.agent_id === a.id);
            const answered = own.filter((c) => !NO_ANSWER_REASONS.has(c.ended_reason || ""));
            const agentMinutes = own.reduce(
                (acc, c) => acc + Number(usageByCall.get(c.vapi_call_id)?.minutes_charged || 0),
                0
            );
            const agentSpend = own.reduce(
                (acc, c) => acc + Number(usageByCall.get(c.vapi_call_id)?.price_charged || 0),
                0
            );
            const booked = own.filter((c) => apptCallIds.has(c.vapi_call_id)).length;
            return {
                id: a.id,
                name: a.name,
                type: (a.agent_type === "inbound" ? "inbound" : "outbound") as AgentRow["type"],
                calls: own.length,
                answered: answered.length,
                answerRate: lowData ? null : rate(answered.length, own.length),
                avgSeconds: Math.round(mean(answered.map((c) => Number(c.duration_seconds || 0)))),
                booked,
                minutes: agentMinutes,
                spend: agentSpend,
                costPerBooking: booked ? agentSpend / booked : null,
            };
        })
        .filter((r) => r.calls > 0);

    const agentTotalCalls = agentRows.reduce((a, r) => a + r.calls, 0);
    const agentTotalAnswered = agentRows.reduce((a, r) => a + r.answered, 0);
    const agentTotalBooked = agentRows.reduce((a, r) => a + r.booked, 0);
    const agentTotalSpend = agentRows.reduce((a, r) => a + r.spend, 0);
    const agentTotals: AgentTotals = {
        calls: agentTotalCalls,
        answerRate: lowData ? null : rate(agentTotalAnswered, agentTotalCalls),
        avgSeconds: Math.round(
            mean(
                calls
                    .filter((c) => !NO_ANSWER_REASONS.has(c.ended_reason || ""))
                    .map((c) => Number(c.duration_seconds || 0))
            )
        ),
        booked: agentTotalBooked,
        costPerBooking: agentTotalBooked ? agentTotalSpend / agentTotalBooked : null,
    };

    // ── When calls connect ───────────────────────────────────────────────────

    const heat: HeatCell[][] = DAY_LABELS.map(() =>
        HEATMAP_HOURS.map(() => ({ attempts: 0, answered: 0, rate: null }))
    );
    for (const c of calls) {
        if (!c.started_at) continue;
        const d = new Date(c.started_at);
        // getDay is Sunday-first; the grid reads Monday-first.
        const row = (d.getDay() + 6) % 7;
        const col = HEATMAP_HOURS.indexOf(d.getHours());
        if (col === -1) continue;
        const cell = heat[row][col];
        cell.attempts += 1;
        if (!NO_ANSWER_REASONS.has(c.ended_reason || "")) cell.answered += 1;
    }
    for (const row of heat) {
        for (const cell of row) {
            cell.rate =
                cell.attempts >= MIN_ATTEMPTS_PER_CELL ? (cell.answered / cell.attempts) * 100 : null;
        }
    }

    const overallAnswerRate = rate(
        calls.filter((c) => !NO_ANSWER_REASONS.has(c.ended_reason || "")).length,
        calls.length
    );
    const bestWindows: BestWindow[] = [];
    heat.forEach((row, ri) => {
        row.forEach((cell, ci) => {
            if (cell.rate == null) return;
            bestWindows.push({
                label: `${DAY_LABELS[ri]} ${String(HEATMAP_HOURS[ci]).padStart(2, "0")}:00`,
                rate: cell.rate,
                attempts: cell.attempts,
                lift: overallAnswerRate ? cell.rate / overallAnswerRate : 1,
            });
        });
    });
    bestWindows.sort((a, b) => b.rate - a.rate);

    // ── What leads say ───────────────────────────────────────────────────────

    const countBy = (rows: Array<Record<string, unknown>>, field: string) => {
        const m = new Map<string, number>();
        for (const r of rows) {
            const v = r[field];
            if (typeof v === "string" && v) m.set(v, (m.get(v) || 0) + 1);
        }
        return m;
    };
    const sentimentCounts = countBy(interactions, "sentiment");
    const intentCounts = countBy(intentSource(interactions), "intent");

    const sentimentTotal = [...sentimentCounts.values()].reduce((a, b) => a + b, 0);
    const sentiment: Tally[] = SENTIMENT_ORDER.map((s) => ({
        key: s.key,
        label: s.label,
        count: sentimentCounts.get(s.key) || 0,
        tone: s.tone,
    })).filter((s) => sentimentTotal === 0 || s.count > 0);

    const intents: Tally[] = INTENT_ORDER.map((s) => ({
        key: s.key,
        label: s.label,
        count: intentCounts.get(s.key) || 0,
        tone: s.tone,
    })).filter((s) => s.count > 0);

    const tallyArray = (rows: Array<Record<string, unknown>>, field: string) => {
        const m = new Map<string, number>();
        for (const r of rows) {
            const v = r[field];
            if (!Array.isArray(v)) continue;
            for (const item of v) {
                if (typeof item === "string" && item.trim()) {
                    const k = item.trim();
                    m.set(k, (m.get(k) || 0) + 1);
                }
            }
        }
        return m;
    };
    const objectionCounts = tallyArray(interactions, "objections_raised");
    const prevObjectionCounts = tallyArray(prevInteractions, "objections_raised");
    const objections: ObjectionRow[] = [...objectionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => {
            const prev = prevObjectionCounts.get(label);
            return {
                label,
                count,
                delta: prev ? ((count - prev) / prev) * 100 : null,
            };
        });

    const topics: TopicRow[] = [...tallyArray(interactions, "key_topics").entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count }));

    // ── Not delivered ────────────────────────────────────────────────────────

    const blockedCounts = new Map<string, number>();
    for (const l of execLogs) {
        const status = String(l.status || "");
        if (!status || status === "sent" || status === "sending" || status === "executing") continue;
        if (status === "completed" || status === "delivered") continue;
        blockedCounts.set(status, (blockedCounts.get(status) || 0) + 1);
    }
    const blockedTotal = [...blockedCounts.values()].reduce((a, b) => a + b, 0);
    const blocked: BlockedReason[] = [...blockedCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({
            key,
            label: BLOCKED_LABELS[key]?.label || key.replace(/_/g, " "),
            count,
            share: blockedTotal ? (count / blockedTotal) * 100 : 0,
            tone: BLOCKED_LABELS[key]?.tone || "muted",
        }));

    // ── Appointments and self healing ────────────────────────────────────────

    const [mutationRows, healingRows] = await Promise.all([
        inChunks(enrollmentIds, async (chunk) => {
            const { data } = await supabase
                .from("step_mutations")
                .select("id, created_at")
                .in("enrollment_id", chunk)
                .gte("created_at", w.startIso);
            return data || [];
        }),
        inChunks(enrollmentIds, async (chunk) => {
            const { data } = await supabase
                .from("healing_log")
                .select("id, created_at")
                .in("enrollment_id", chunk)
                .gte("created_at", w.startIso);
            return data || [];
        }),
    ]);

    return {
        window: w,
        lowData,
        lowNote: `${calls.length} calls and ${touches} touches so far. Rates stay hidden until ${LOW_DATA_CALLS} calls land.`,
        kpis,
        funnel,
        trend: trendDays,
        trendSummary,
        sequences: sequenceRows,
        sequenceTotals,
        agents: agentRows,
        agentTotals,
        heat,
        heatHours: HEATMAP_HOURS,
        bestWindows: bestWindows.slice(0, 3),
        sentiment,
        intents,
        objections,
        topics,
        blocked,
        blockedTotal,
        appointments: {
            noShow: appointments.filter((a) => a.status === "no_show").length,
            cancelled: appointments.filter((a) => a.status === "cancelled").length,
            rescheduled: appointments.filter((a) => a.status === "rescheduled").length,
        },
        healing: {
            mutations: mutationRows.length,
            repairs: healingRows.length,
        },
    };
}

/** Intent is only recorded on the lead's own messages. */
function intentSource(rows: Array<Record<string, unknown>>) {
    return rows.filter((r) => r.direction === "inbound");
}
