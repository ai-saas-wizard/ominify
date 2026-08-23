/**
 * Typed shape of everything the Analytics page renders.
 *
 * The client component receives only these plain values, so it never has to
 * know which table a number came from, and the range control can re-aggregate
 * on the server without changing a single rendering rule.
 *
 * Numbers stay numbers here rather than pre-formatted strings: the same value
 * is shown two ways in places (a rate in the KPI strip, the same rate on the
 * chart axis), and a `null` rate means "not enough data to state one" rather
 * than zero.
 */

export type AnalyticsRange = "7d" | "30d" | "90d" | "cycle";

/** Palette roles. One hue per meaning, matching the sequences section. */
export type Tone = "gray" | "muted" | "emerald" | "blue" | "violet" | "amber" | "red";

export interface RangeWindow {
    key: AnalyticsRange;
    /** Control label, e.g. "30 days". */
    label: string;
    /** Sentence-form label, e.g. "Last 30 days". */
    caption: string;
    startIso: string;
    endIso: string;
    prevStartIso: string;
    prevEndIso: string;
    days: number;
}

export interface KpiDelta {
    /** Percent change against the previous window. */
    pct: number;
    /** True when the direction of the move is good for the operator. */
    good: boolean;
}

export interface Kpi {
    key: string;
    label: string;
    /** Already formatted, because the six cells mix counts, rates and money. */
    value: string;
    qualifier: string;
    tone: Tone;
    /** Null when the previous window has nothing to compare against. */
    delta: KpiDelta | null;
}

export interface FunnelStage {
    key: string;
    label: string;
    value: number;
    /** Conversion note for this step, empty on the first stage. */
    rate: string;
    tone: Tone;
    /** Bar width as a percentage of the widest stage. */
    width: number;
}

export interface TrendPoint {
    /** yyyy-mm-dd, the key Recharts sorts on. */
    date: string;
    label: string;
    touches: number;
    /** All three are a share of the touches dispatched that day, 0 to 100. */
    contactRate: number;
    replyRate: number;
    bookingRate: number;
}

export type SequenceStatus = "live" | "paused" | "draft";

export interface SequenceRow {
    id: string;
    name: string;
    /** Generation mode plus the channels that actually dispatched in range. */
    meta: string;
    status: SequenceStatus;
    enrolled: number;
    touches: number;
    /** Null while the sequence has too little traffic to state a rate. */
    contactRate: number | null;
    replyRate: number | null;
    booked: number;
    minutes: number;
    spend: number;
    costPerBooking: number | null;
    /** Burned voice minutes over the window and booked nobody. */
    burning: boolean;
}

export interface AgentRow {
    id: string;
    name: string;
    type: "inbound" | "outbound";
    calls: number;
    answered: number;
    answerRate: number | null;
    /** Mean length of the calls that connected, in seconds. */
    avgSeconds: number;
    booked: number;
    minutes: number;
    spend: number;
    costPerBooking: number | null;
}

export interface TableTotals {
    enrolled: number;
    touches: number;
    contactRate: number | null;
    replyRate: number | null;
    booked: number;
    minutes: number;
    spend: number;
    costPerBooking: number | null;
}

export interface AgentTotals {
    calls: number;
    answerRate: number | null;
    avgSeconds: number;
    booked: number;
    costPerBooking: number | null;
}

export interface HeatCell {
    attempts: number;
    answered: number;
    /** Null below the attempt floor, so a single lucky call cannot read as 100 percent. */
    rate: number | null;
}

export interface BestWindow {
    label: string;
    rate: number;
    attempts: number;
    /** Multiple of the overall answer rate for the range. */
    lift: number;
}

export interface Tally {
    key: string;
    label: string;
    count: number;
    tone: Tone;
}

export interface ObjectionRow {
    label: string;
    count: number;
    /** Percent move against the previous window, null when it is new. */
    delta: number | null;
}

export interface TopicRow {
    label: string;
    count: number;
}

export interface BlockedReason {
    key: string;
    label: string;
    count: number;
    /** Share of all non-dispatched attempts, 0 to 100. */
    share: number;
    tone: Tone;
}

export interface AnalyticsData {
    window: RangeWindow;
    /** True while there is too little traffic for the rates to mean anything. */
    lowData: boolean;
    lowNote: string;
    kpis: Kpi[];
    funnel: FunnelStage[];
    trend: TrendPoint[];
    trendSummary: string;
    sequences: SequenceRow[];
    sequenceTotals: TableTotals;
    agents: AgentRow[];
    agentTotals: AgentTotals;
    /** 7 rows (Mon to Sun) by HEATMAP_HOURS columns. */
    heat: HeatCell[][];
    heatHours: number[];
    bestWindows: BestWindow[];
    sentiment: Tally[];
    intents: Tally[];
    objections: ObjectionRow[];
    topics: TopicRow[];
    blocked: BlockedReason[];
    blockedTotal: number;
    appointments: {
        noShow: number;
        cancelled: number;
        rescheduled: number;
    };
    healing: {
        mutations: number;
        repairs: number;
    };
}
