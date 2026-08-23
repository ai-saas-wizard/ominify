import { getAnalytics, type AnalyticsRange } from "@/lib/analytics";
import { AnalyticsClient } from "@/components/analytics/analytics-client";

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d", "cycle"];

/**
 * Analytics is aggregated on the server and re-aggregated when the range
 * changes, rather than shipping raw call and interaction rows to the browser.
 * An account with a few months of dialling has tens of thousands of them.
 */
export default async function AnalyticsPage({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ range?: string }>;
}) {
    const [{ clientId }, { range }] = await Promise.all([params, searchParams]);
    const selected = RANGES.includes(range as AnalyticsRange)
        ? (range as AnalyticsRange)
        : "30d";

    const data = await getAnalytics(clientId, selected);

    return <AnalyticsClient data={data} />;
}
