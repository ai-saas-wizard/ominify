import type { TierPhase } from "@/lib/pricing-tiers";

function formatPrice(usd: number): string {
    return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

function pluralMonths(n: number): string {
    return n === 1 ? "1 month" : `${n} months`;
}

/**
 * Renders the price journey for a tier. Single-phase tiers get the classic
 * "$479" + "/month" display; multi-phase tiers show every phase explicitly so
 * the customer sees the full price arc upfront.
 */
export function PhaseSummary({
    phases,
    variant = "default",
}: {
    phases: TierPhase[];
    variant?: "default" | "compact";
}) {
    const safe = phases.length > 0 ? phases : [];
    if (safe.length === 0) return null;

    if (safe.length === 1) {
        const p = safe[0];
        if (variant === "compact") {
            return (
                <span className="text-sm font-medium text-gray-900">
                    {formatPrice(p.price_usd)}/mo
                </span>
            );
        }
        return (
            <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">
                    {formatPrice(p.price_usd)}
                </span>
                <span className="text-gray-500">/month</span>
            </div>
        );
    }

    if (variant === "compact") {
        const intro = safe[0];
        const tail = safe[safe.length - 1];
        return (
            <span className="text-sm font-medium text-gray-900">
                {formatPrice(intro.price_usd)} → {formatPrice(tail.price_usd)}
                {intro.duration_months && (
                    <span className="ml-1 text-xs font-normal text-gray-500">
                        ({intro.duration_months}mo intro
                        {safe.length > 2 ? `, +${safe.length - 2}` : ""})
                    </span>
                )}
            </span>
        );
    }

    // Default stacked view
    const lead = safe[0];
    const rest = safe.slice(1);
    return (
        <div>
            <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">
                    {formatPrice(lead.price_usd)}
                </span>
                <span className="text-gray-500">/month</span>
                {lead.duration_months && (
                    <span className="ml-2 text-sm text-gray-500">
                        for {pluralMonths(lead.duration_months)}
                    </span>
                )}
            </div>
            <ul className="mt-1 space-y-0.5">
                {rest.map((p, i) => (
                    <li key={i} className="text-sm text-gray-600">
                        then{" "}
                        <span className="font-semibold text-gray-900">
                            {formatPrice(p.price_usd)}/month
                        </span>
                        {p.duration_months
                            ? ` for ${pluralMonths(p.duration_months)}`
                            : ""}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * One-line summary of the minute allowance across phases. Used as a default
 * feature bullet on the subscribe + offers pages when admins haven't
 * customized the features list.
 */
export function PhaseMinutesSummary({ phases }: { phases: TierPhase[] }) {
    if (phases.length === 0) return null;
    if (phases.length === 1) {
        return (
            <span>
                {phases[0].monthly_minutes.toLocaleString()} voice minutes included every month
            </span>
        );
    }
    const lead = phases[0];
    const tail = phases[phases.length - 1];
    const leadDur = lead.duration_months
        ? ` for ${pluralMonths(lead.duration_months)}`
        : "";
    return (
        <span>
            {lead.monthly_minutes.toLocaleString()} voice minutes/month{leadDur}, then{" "}
            {tail.monthly_minutes.toLocaleString()} voice minutes/month
        </span>
    );
}
