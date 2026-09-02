"use client";

import { useState, useEffect, useRef } from "react";
import {
    AlertTriangle,
    Bell,
    Calendar,
    Check,
    CheckCheck,
    Flag,
    Flame,
    PhoneOff,
    ShieldAlert,
    TrendingDown,
    UserCheck,
    Wallet,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    getNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
} from "@/app/actions/sequence-actions";

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string | null;
    priority: string;
    read: boolean;
    created_at: string;
    contacts?: { id: string; name: string | null; phone: string } | null;
    sequence_enrollments?: {
        id: string;
        sequence_id: string;
        sequences?: { name: string } | null;
    } | null;
}

/**
 * Notifications as a floating panel in the bottom right rather than a bell
 * wedged into the sidebar header.
 *
 * The bell used to sit beside the workspace name, which squeezed the name into
 * two lines on any account with a real business name. Moving it out gives the
 * sidebar its width back, and a conversation style list suits the content:
 * these are short, chronological, one sided messages from the system, which is
 * exactly the shape a message thread is built for.
 */
export function NotificationCenter({
    clientId,
    initialUnreadCount,
}: {
    clientId: string;
    initialUnreadCount?: number;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(initialUnreadCount ?? 0);
    const [loading, setLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Skip the initial fetch when the layout already prefetched the count, but
    // keep the poll so a notification arriving mid session still shows up. The
    // cancelled flag stops a late response setting state after unmount.
    useEffect(() => {
        let cancelled = false;
        async function poll() {
            const result = await getUnreadNotificationCount(clientId);
            if (!cancelled && result.success) setUnreadCount(result.count);
        }
        if (initialUnreadCount === undefined) void poll();
        const interval = setInterval(() => void poll(), 30000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [clientId, initialUnreadCount]);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);

    async function handleToggle() {
        const next = !isOpen;
        setIsOpen(next);
        if (!next) return;

        setLoading(true);
        const result = await getNotifications(clientId, 30);
        if (result.success) setNotifications(result.data as Notification[]);
        setLoading(false);
    }

    // Newest sits at the bottom, so open on the newest the way a thread does.
    useEffect(() => {
        if (!isOpen || loading) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [isOpen, loading, notifications.length]);

    async function handleMarkRead(id: string) {
        await markNotificationRead(id);
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    async function handleMarkAllRead() {
        await markAllNotificationsRead(clientId);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
    }

    // Oldest first, so the newest lands at the bottom of the thread.
    const ordered = [...notifications].reverse();
    const groups = groupByDay(ordered);

    return (
        <div ref={panelRef} className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
            {isOpen && (
                <div className="flex h-[560px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                    <div className="flex flex-none items-center gap-2 border-b border-gray-100 px-4 py-3">
                        <span className="text-sm font-semibold text-gray-900">Notifications</span>
                        {unreadCount > 0 && (
                            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold tabular-nums text-emerald-700">
                                {unreadCount}
                            </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllRead}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                                >
                                    <CheckCheck className="h-3 w-3" />
                                    Mark all read
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                aria-label="Close notifications"
                                className="grid h-6 w-6 place-items-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-3 py-4">
                        {loading ? (
                            <div className="flex items-center justify-center py-10">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                            </div>
                        ) : ordered.length === 0 ? (
                            <div className="flex flex-col items-center gap-1.5 py-12 text-center">
                                <Bell className="h-7 w-7 text-gray-300" />
                                <p className="text-[13px] font-medium text-gray-600">
                                    Nothing yet
                                </p>
                                <p className="max-w-[220px] text-[11.5px] leading-relaxed text-gray-500">
                                    Hot leads, bookings and anything needing a human land here.
                                </p>
                            </div>
                        ) : (
                            groups.map((group) => (
                                <div key={group.label}>
                                    <div className="my-2 flex justify-center">
                                        <span className="rounded-full bg-gray-200/70 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                                            {group.label}
                                        </span>
                                    </div>
                                    {group.items.map((n) => (
                                        <Bubble key={n.id} notification={n} onMarkRead={handleMarkRead} />
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            <button
                onClick={handleToggle}
                aria-label={
                    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
                }
                aria-expanded={isOpen}
                className={cn(
                    "relative grid h-12 w-12 place-items-center rounded-full shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2",
                    isOpen
                        ? "bg-gray-900 text-white hover:bg-gray-800"
                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                )}
            >
                {isOpen ? <X className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                {!isOpen && unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold tabular-nums text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </button>
        </div>
    );
}

/**
 * One notification as an incoming message: avatar, bubble, timestamp beneath.
 * Everything here is one sided, so bubbles always sit on the left.
 */
function Bubble({
    notification,
    onMarkRead,
}: {
    notification: Notification;
    onMarkRead: (id: string) => void;
}) {
    const meta = getTypeConfig(notification.type);
    const unread = !notification.read;
    const contextLine =
        notification.contacts?.name ||
        notification.sequence_enrollments?.sequences?.name ||
        null;

    return (
        <div className="mb-2.5 flex items-end gap-2">
            <span
                className={cn(
                    "grid h-7 w-7 flex-none place-items-center rounded-full",
                    meta.bg
                )}
            >
                <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
            </span>

            <div className="flex min-w-0 max-w-[86%] flex-col items-start gap-1">
                <button
                    type="button"
                    onClick={() => unread && onMarkRead(notification.id)}
                    className={cn(
                        // rounded-bl-md gives the bubble its tail corner.
                        "w-full rounded-2xl rounded-bl-md border px-3 py-2 text-left transition-colors",
                        unread
                            ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                    )}
                >
                    <span className="flex items-center gap-1.5">
                        <span
                            className={cn(
                                "text-[13px] font-semibold leading-snug",
                                unread ? "text-gray-900" : "text-gray-700"
                            )}
                        >
                            {notification.title}
                        </span>
                        {notification.priority === "urgent" && (
                            <span className="inline-flex flex-none items-center rounded bg-red-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-700">
                                Urgent
                            </span>
                        )}
                    </span>
                    {notification.body && (
                        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-gray-600">
                            {notification.body}
                        </span>
                    )}
                </button>

                <span className="flex items-center gap-1.5 px-1 text-[10.5px] text-gray-500">
                    <span>{getTimeLabel(notification.created_at)}</span>
                    {contextLine && (
                        <>
                            <span className="text-gray-300">·</span>
                            <span className="truncate">{contextLine}</span>
                        </>
                    )}
                    {unread && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </span>
            </div>
        </div>
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByDay(items: Notification[]): Array<{ label: string; items: Notification[] }> {
    const groups: Array<{ label: string; items: Notification[] }> = [];
    for (const n of items) {
        const label = getDayLabel(n.created_at);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(n);
        else groups.push({ label, items: [n] });
    }
    return groups;
}

function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "Earlier";
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, yesterday)) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getTimeLabel(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getTypeConfig(type: string) {
    const configs: Record<
        string,
        { icon: typeof Bell; bg: string; color: string }
    > = {
        hot_lead: { icon: Flame, bg: "bg-orange-100", color: "text-orange-600" },
        needs_human: { icon: UserCheck, bg: "bg-emerald-100", color: "text-emerald-600" },
        objection_detected: { icon: AlertTriangle, bg: "bg-amber-100", color: "text-amber-600" },
        sentiment_drop: { icon: TrendingDown, bg: "bg-red-100", color: "text-red-600" },
        appointment_booked: { icon: Calendar, bg: "bg-violet-100", color: "text-violet-600" },
        sequence_completed: { icon: Check, bg: "bg-gray-100", color: "text-gray-600" },
        escalation: { icon: Flag, bg: "bg-red-100", color: "text-red-600" },
        at_risk: { icon: TrendingDown, bg: "bg-red-100", color: "text-red-500" },
        // Provider health (sequencer/src/lib/twilio-balance.ts)
        twilio_low_balance: { icon: Wallet, bg: "bg-amber-100", color: "text-amber-600" },
        twilio_auth_failed: { icon: ShieldAlert, bg: "bg-red-100", color: "text-red-600" },
        calls_failing: { icon: PhoneOff, bg: "bg-red-100", color: "text-red-600" },
    };
    return configs[type] || { icon: Bell, bg: "bg-gray-100", color: "text-gray-600" };
}
