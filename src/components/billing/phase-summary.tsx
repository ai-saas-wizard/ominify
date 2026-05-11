import type { TierPhase } from "@/lib/pricing-tiers-shared";

function formatPrice(usd: number): string {
    return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

function pluralMonths(n: number): string {
    return n === 1 ? "1 month" : `${n} months`;
}

export type PhaseTheme = "light" | "dark";

interface ThemeTokens {
    priceLead: string;     // big number
    priceSuffix: string;   // /month
    durationHint: string;  // "for 2 months"
    laterLine: string;     // "then..." line
    compactPrimary: string;
    compactSecondary: string;
}

const THEMES: Record<PhaseTheme, ThemeTokens> = {
    light: {
        priceLead: "text-gray-900",
        priceSuffix: "text-gray-500",
        durationHint: "text-gray-500",
        laterLine: "text-gray-600",
        compactPrimary: "text-gray-900",
        compactSecondary: "text-gray-500",
    },
    dark: {
        priceLead: "text-white",
        priceSuffix: "text-white/50",
        durationHint: "text-white/60",
        laterLine: "text-white/60",
        compactPrimary: "text-white",
        compactSecondary: "text-white/50",
    },
};

/**
 * Renders the price journey for a tier. Single-phase tiers get the classic
 * "$479" + "/month" display; multi-phase tiers show every phase explicitly so
 * the customer sees the full price arc upfront. Theme controls light vs dark
 * surface coloring without forking the component.
 */
export function PhaseSummary({
    phases,
    variant = "default",
    theme = "light",
}: {
    phases: TierPhase[];
    variant?: "default" | "compact";
    theme?: PhaseTheme;
}) {
    const t = THEMES[theme];
    const safe = phases.length > 0 ? phases : [];
    if (safe.length === 0) return null;

    if (safe.length === 1) {
        const p = safe[0];
        if (variant === "compact") {
            return (
                <span className={`text-sm font-medium ${t.compactPrimary}`}>
                    {formatPrice(p.price_usd)}/mo
                </span>
            );
        }
        return (
            <div className="flex items-baseline gap-1">
                <span className={`text-5xl font-bold tracking-tight ${t.priceLead}`}>
                    {formatPrice(p.price_usd)}
                </span>
                <span className={t.priceSuffix}>/month</span>
            </div>
        );
    }

    if (variant === "compact") {
        const intro = safe[0];
        const tail = safe[safe.length - 1];
        return (
            <span className={`text-sm font-medium ${t.compactPrimary}`}>
                {formatPrice(intro.price_usd)} → {formatPrice(tail.price_usd)}
                {intro.duration_months && (
                    <span className={`ml-1 text-xs font-normal ${t.compactSecondary}`}>
                        ({intro.duration_months}mo intro
                        {safe.length > 2 ? `, +${safe.length - 2}` : ""})
                    </span>
                )}
            </span>
        );
    }

    const lead = safe[0];
    const rest = safe.slice(1);
    return (
        <div>
            <div className="flex items-baseline gap-1 flex-wrap">
                <span className={`text-5xl font-bold tracking-tight ${t.priceLead}`}>
                    {formatPrice(lead.price_usd)}
                </span>
                <span className={t.priceSuffix}>/month</span>
                {lead.duration_months && (
                    <span className={`ml-2 text-sm ${t.durationHint}`}>
                        for {pluralMonths(lead.duration_months)}
                    </span>
                )}
            </div>
            <ul className="mt-1.5 space-y-0.5">
                {rest.map((p, i) => (
                    <li key={i} className={`text-sm ${t.laterLine}`}>
                        then{" "}
                        <span className={`font-semibold ${t.priceLead}`}>
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
 * feature bullet when admins haven't customized the features list.
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
