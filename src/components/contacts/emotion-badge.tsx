"use client";

/**
 * Emotion Badge — Compact emotion/sentiment indicator
 * Shows emoji + label for emotional state, intent, and EI flags.
 *
 * Used in interaction timeline, contact detail modal, and enrollment table.
 */

interface EmotionBadgeProps {
    emotion?: string;
    intent?: string;
    isHotLead?: boolean;
    isAtRisk?: boolean;
    needsHuman?: boolean;
    size?: 'xs' | 'sm' | 'md';
}

export function EmotionBadge({
    emotion,
    intent,
    isHotLead,
    isAtRisk,
    needsHuman,
    size = 'sm',
}: EmotionBadgeProps) {
    const sizeClasses = {
        xs: 'text-[10px] px-1 py-0.5',
        sm: 'text-xs px-1.5 py-0.5',
        md: 'text-sm px-2 py-1',
    }[size];

    return (
        <div className="flex flex-wrap gap-1">
            {/* Primary emotion badge */}
            {emotion && (
                <span className={`${sizeClasses} rounded-full inline-flex items-center gap-0.5 ${getEmotionStyle(emotion)}`}>
                    {getEmotionEmoji(emotion)} {formatLabel(emotion)}
                </span>
            )}

            {/* Intent badge */}
            {intent && intent !== 'unknown' && (
                <span className={`${sizeClasses} rounded-full inline-flex items-center gap-0.5 ${getIntentStyle(intent)}`}>
                    {getIntentIcon(intent)} {formatLabel(intent)}
                </span>
            )}

            {/* Flag badges */}
            {isHotLead && (
                <span className={`${sizeClasses} rounded-full bg-orange-100 text-orange-700 font-medium inline-flex items-center gap-0.5`}>
                    \uD83D\uDD25 Hot Lead
                </span>
            )}

            {isAtRisk && (
                <span className={`${sizeClasses} rounded-full bg-red-100 text-red-700 font-medium inline-flex items-center gap-0.5`}>
                    \u26A0\uFE0F At Risk
                </span>
            )}

            {needsHuman && (
                <span className={`${sizeClasses} rounded-full bg-purple-100 text-purple-700 font-medium inline-flex items-center gap-0.5`}>
                    \uD83D\uDC64 Needs Human
                </span>
            )}
        </div>
    );
}

/**
 * Compact single-emotion badge (for use in tables/lists)
 */
export function EmotionDot({ emotion, size = 'sm' }: { emotion: string; size?: 'xs' | 'sm' }) {
    const dotSize = size === 'xs' ? 'w-4 h-4 text-[8px]' : 'w-5 h-5 text-[10px]';

    return (
        <span
            className={`${dotSize} rounded-full inline-flex items-center justify-center`}
            title={formatLabel(emotion)}
        >
            {getEmotionEmoji(emotion)}
        </span>
    );
}

// ═══════════════════════════════════════════════════════════════════
// Style helpers
// ═══════════════════════════════════════════════════════════════════

function getEmotionEmoji(emotion: string): string {
    const emojiMap: Record<string, string> = {
        excited: '\uD83E\uDD29',
        interested: '\uD83D\uDE0A',
        neutral: '\uD83D\uDE10',
        hesitant: '\uD83E\uDD14',
        frustrated: '\uD83D\uDE24',
        confused: '\uD83D\uDE15',
        angry: '\uD83D\uDE21',
        dismissive: '\uD83D\uDE12',
    };
    return emojiMap[emotion] || '\uD83D\uDE10';
}

function getEmotionStyle(emotion: string): string {
    const styles: Record<string, string> = {
        excited: 'bg-green-100 text-green-700',
        interested: 'bg-blue-100 text-blue-700',
        neutral: 'bg-gray-100 text-gray-600',
        hesitant: 'bg-yellow-100 text-yellow-700',
        frustrated: 'bg-orange-100 text-orange-700',
        confused: 'bg-amber-100 text-amber-700',
        angry: 'bg-red-100 text-red-700',
        dismissive: 'bg-slate-100 text-slate-600',
    };
    return styles[emotion] || 'bg-gray-100 text-gray-600';
}

function getIntentStyle(intent: string): string {
    const styles: Record<string, string> = {
        interested: 'bg-green-50 text-green-600',
        ready_to_buy: 'bg-green-100 text-green-700 font-medium',
        needs_info: 'bg-blue-50 text-blue-600',
        question: 'bg-blue-50 text-blue-600',
        objection: 'bg-orange-50 text-orange-600',
        reschedule: 'bg-yellow-50 text-yellow-600',
        not_interested: 'bg-gray-50 text-gray-500',
        stop: 'bg-red-50 text-red-600',
    };
    return styles[intent] || 'bg-gray-50 text-gray-500';
}

function getIntentIcon(intent: string): string {
    const icons: Record<string, string> = {
        interested: '\u2705',
        ready_to_buy: '\uD83D\uDCB0',
        needs_info: '\u2139\uFE0F',
        question: '\u2753',
        objection: '\u270B',
        reschedule: '\uD83D\uDCC5',
        not_interested: '\u274C',
        stop: '\uD83D\uDED1',
    };
    return icons[intent] || '';
}

function formatLabel(text: string): string {
    return text
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}
