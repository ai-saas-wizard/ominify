import { format, isThisYear, isToday, isYesterday } from "date-fns";

export function dayKey(iso: string): string {
    return format(new Date(iso), "yyyy-MM-dd");
}

export function dayLabel(iso: string): string {
    const d = new Date(iso);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, isThisYear(d) ? "EEE · MMM d" : "EEE · MMM d, yyyy");
}

export function timeLabel(iso: string): string {
    return format(new Date(iso), "h:mm a");
}

export function dateLabel(iso: string): string {
    const d = new Date(iso);
    return format(d, isThisYear(d) ? "MMM d" : "MMM d, yyyy");
}

/** "now" · "4m" · "3h" · "2d" · "Aug 12" — for the thread list. */
export function shortAgo(iso: string | null, now: number): string {
    if (!iso) return "—";
    const s = Math.max(0, now - new Date(iso).getTime()) / 1000;
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return dateLabel(iso);
}

/** "4m ago" · "2d ago" · "Aug 12" — for the detail stats. */
export function longAgo(iso: string | null, now: number): string {
    if (!iso) return "—";
    const short = shortAgo(iso, now);
    if (short === "now") return "Just now";
    return /^\d+[mhd]$/.test(short) ? `${short} ago` : short;
}
