"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Phone, Mail, MessageSquare, TrendingUp, TrendingDown, Minus, Flame, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineContact } from "@/types/pipeline";

// ─── Source badge colors ────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    csv_upload: { bg: "bg-blue-50", text: "text-blue-600", label: "CSV" },
    manual: { bg: "bg-gray-50", text: "text-gray-600", label: "Manual" },
    api: { bg: "bg-amber-50", text: "text-amber-600", label: "API" },
    form: { bg: "bg-emerald-50", text: "text-emerald-600", label: "Form" },
    import: { bg: "bg-emerald-50", text: "text-emerald-600", label: "Import" },
};

// ─── Engagement color scale ─────────────────────────────────────────────────

function getEngagementColor(score: number): string {
    if (score >= 75) return "bg-emerald-500";
    if (score >= 50) return "bg-blue-500";
    if (score >= 25) return "bg-amber-500";
    return "bg-gray-300";
}

function getSentimentIcon(trend: string | null) {
    if (trend === "improving") return { Icon: TrendingUp, color: "text-emerald-500" };
    if (trend === "declining") return { Icon: TrendingDown, color: "text-red-500" };
    return { Icon: Minus, color: "text-gray-400" };
}

// ─── Relative time helper ───────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
    if (!dateStr) return "";
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Initials avatar ────────────────────────────────────────────────────────

function getInitials(name: string | null): string {
    if (!name) return "?";
    return name
        .split(" ")
        .map((n) => n[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

const AVATAR_COLORS = [
    "from-emerald-500 to-emerald-600",
    "from-blue-500 to-emerald-600",
    "from-emerald-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-pink-500 to-rose-600",
    "from-cyan-500 to-blue-600",
];

function getAvatarColor(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Card Component ─────────────────────────────────────────────────────────

export function PipelineContactCard({
    contact,
    isGhost,
    onClick,
    bulkMode,
    isSelected,
}: {
    contact: PipelineContact;
    isGhost?: boolean;
    onClick?: () => void;
    bulkMode?: boolean;
    isSelected?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: contact.id,
        disabled: bulkMode,
    });

    const style = transform
        ? { transform: CSS.Translate.toString(transform) }
        : undefined;

    const source = contact.enrollment?.source || null;
    const sourceStyle = source ? SOURCE_STYLES[source] || SOURCE_STYLES.manual : null;
    const engagementScore = contact.engagement_score ?? 50;
    const sentimentInfo = getSentimentIcon(contact.sentiment_trend);
    const hasSequence = !!contact.enrollment?.sequence_name;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(bulkMode ? {} : listeners)}
            {...(bulkMode ? {} : attributes)}
            onClick={onClick}
            className={cn(
                "group relative bg-white rounded-lg border p-3",
                bulkMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                "hover:shadow-md transition-all duration-150",
                "select-none",
                isDragging && "opacity-30 shadow-none",
                isGhost && "shadow-xl border-emerald-300 bg-white/95 backdrop-blur-sm",
                isSelected
                    ? "border-emerald-400 ring-2 ring-emerald-200/60 bg-emerald-50/30"
                    : "border-gray-200/80 hover:border-gray-300"
            )}
        >
            {/* Bulk checkbox */}
            {bulkMode && (
                <div className={cn(
                    "absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 transition-colors",
                    isSelected
                        ? "bg-emerald-600 border-emerald-600"
                        : "bg-white border-gray-300"
                )}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
            )}

            {/* Top: Avatar + Name + Source badge */}
            <div className="flex items-start gap-2.5 mb-2">
                <div
                    className={cn(
                        "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-sm",
                        getAvatarColor(contact.id)
                    )}
                >
                    {getInitials(contact.name)}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                        {contact.name || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500 font-mono truncate">{contact.phone}</p>
                </div>
                {sourceStyle && (
                    <span
                        className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0",
                            sourceStyle.bg,
                            sourceStyle.text
                        )}
                    >
                        {sourceStyle.label}
                    </span>
                )}
            </div>

            {/* Sequence info */}
            {hasSequence && (
                <div className="flex items-center gap-1.5 mb-2 pl-0.5">
                    <MessageSquare className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    <span className="text-xs text-gray-600 truncate">{contact.enrollment!.sequence_name}</span>
                    <span
                        className={cn(
                            "text-[9px] font-medium px-1.5 py-px rounded-full ml-auto flex-shrink-0",
                            contact.enrollment!.status === "active"
                                ? "bg-emerald-50 text-emerald-600"
                                : contact.enrollment!.status === "booked"
                                    ? "bg-blue-50 text-blue-600"
                                    : "bg-gray-100 text-gray-500"
                        )}
                    >
                        {contact.enrollment!.status}
                    </span>
                </div>
            )}

            {/* Engagement bar */}
            <div className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className={cn("h-full rounded-full transition-all duration-500", getEngagementColor(engagementScore))}
                        style={{ width: `${engagementScore}%` }}
                    />
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-medium text-gray-500 tabular-nums">{engagementScore}</span>
                    <sentimentInfo.Icon className={cn("w-3 h-3", sentimentInfo.color)} />
                </div>
            </div>

            {/* Bottom: summary snippet + time */}
            <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-400 truncate max-w-[180px]">
                    {contact.conversation_summary
                        ? `"${contact.conversation_summary.substring(0, 50)}${contact.conversation_summary.length > 50 ? "..." : ""}"`
                        : contact.last_call_at
                            ? `Last call ${relativeTime(contact.last_call_at)}`
                            : `Added ${relativeTime(contact.created_at)}`
                    }
                </p>
                {engagementScore >= 75 && (
                    <Flame className="w-3 h-3 text-orange-400 flex-shrink-0" />
                )}
            </div>
        </div>
    );
}
