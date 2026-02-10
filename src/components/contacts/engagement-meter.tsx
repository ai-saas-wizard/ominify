"use client";

/**
 * Engagement Meter — Visual engagement score display (0-100)
 * Shows a color-coded gauge with label and trend indicator.
 *
 * Used in contact detail modal and enrollment table.
 */

interface EngagementMeterProps {
    score: number;
    sentimentTrend?: string;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
}

export function EngagementMeter({
    score,
    sentimentTrend,
    size = 'md',
    showLabel = true,
}: EngagementMeterProps) {
    const clampedScore = Math.max(0, Math.min(100, score));

    // Color based on score
    const getColor = (s: number) => {
        if (s >= 75) return { bg: 'bg-green-500', text: 'text-green-700', light: 'bg-green-100' };
        if (s >= 50) return { bg: 'bg-blue-500', text: 'text-blue-700', light: 'bg-blue-100' };
        if (s >= 30) return { bg: 'bg-yellow-500', text: 'text-yellow-700', light: 'bg-yellow-100' };
        return { bg: 'bg-red-500', text: 'text-red-700', light: 'bg-red-100' };
    };

    const getLabel = (s: number) => {
        if (s >= 75) return 'Hot';
        if (s >= 50) return 'Warm';
        if (s >= 30) return 'Cool';
        return 'Cold';
    };

    const getTrendIcon = (trend: string | undefined) => {
        switch (trend) {
            case 'hot': return { icon: '\u2191\u2191', color: 'text-green-600', label: 'Hot' };
            case 'warming': return { icon: '\u2191', color: 'text-green-500', label: 'Warming' };
            case 'cooling': return { icon: '\u2193', color: 'text-orange-500', label: 'Cooling' };
            case 'cold': return { icon: '\u2193\u2193', color: 'text-red-600', label: 'Cold' };
            default: return { icon: '\u2192', color: 'text-gray-400', label: 'Stable' };
        }
    };

    const colors = getColor(clampedScore);
    const label = getLabel(clampedScore);
    const trend = getTrendIcon(sentimentTrend);

    const sizeConfig = {
        sm: { bar: 'h-1.5', text: 'text-xs', wrapper: 'w-24' },
        md: { bar: 'h-2', text: 'text-sm', wrapper: 'w-32' },
        lg: { bar: 'h-3', text: 'text-base', wrapper: 'w-48' },
    }[size];

    return (
        <div className={`${sizeConfig.wrapper}`}>
            {showLabel && (
                <div className="flex items-center justify-between mb-1">
                    <span className={`${sizeConfig.text} font-medium ${colors.text}`}>
                        {label}
                    </span>
                    <div className="flex items-center gap-1">
                        <span className={`${sizeConfig.text} font-mono font-bold ${colors.text}`}>
                            {clampedScore}
                        </span>
                        <span className={`${sizeConfig.text} ${trend.color}`} title={trend.label}>
                            {trend.icon}
                        </span>
                    </div>
                </div>
            )}
            <div className={`w-full bg-gray-200 rounded-full ${sizeConfig.bar} overflow-hidden`}>
                <div
                    className={`${colors.bg} ${sizeConfig.bar} rounded-full transition-all duration-500 ease-out`}
                    style={{ width: `${clampedScore}%` }}
                />
            </div>
        </div>
    );
}
