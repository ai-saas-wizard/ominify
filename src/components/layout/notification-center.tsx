"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, X, Check, CheckCheck, Flame, AlertTriangle, UserCheck, TrendingDown, Calendar, Flag } from "lucide-react";
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

export function NotificationCenter({ clientId }: { clientId: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Fetch unread count on mount and periodically
    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, [clientId]);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const fetchUnreadCount = async () => {
        const result = await getUnreadNotificationCount(clientId);
        if (result.success) {
            setUnreadCount(result.count);
        }
    };

    const fetchNotifications = async () => {
        setLoading(true);
        const result = await getNotifications(clientId, 20);
        if (result.success) {
            setNotifications(result.data as Notification[]);
        }
        setLoading(false);
    };

    const handleToggle = () => {
        if (!isOpen) {
            fetchNotifications();
        }
        setIsOpen(!isOpen);
    };

    const handleMarkRead = async (id: string) => {
        await markNotificationRead(id);
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const handleMarkAllRead = async () => {
        await markAllNotificationsRead(clientId);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
    };

    return (
        <div className="relative" ref={panelRef}>
            {/* Bell Icon */}
            <button
                onClick={handleToggle}
                className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="Notifications"
            >
                <Bell className="w-4 h-4 text-gray-500" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 text-[9px] font-bold text-white bg-red-500 rounded-full">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 max-h-[480px] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllRead}
                                    className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"
                                >
                                    <CheckCheck className="w-3 h-3" />
                                    Mark all read
                                </button>
                            )}
                            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-gray-100 rounded">
                                <X className="w-3.5 h-3.5 text-gray-400" />
                            </button>
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="text-center py-8 text-sm text-gray-400">
                                No notifications yet
                            </div>
                        ) : (
                            notifications.map((notification) => (
                                <NotificationItem
                                    key={notification.id}
                                    notification={notification}
                                    onMarkRead={handleMarkRead}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function NotificationItem({
    notification,
    onMarkRead,
}: {
    notification: Notification;
    onMarkRead: (id: string) => void;
}) {
    const typeConfig = getTypeConfig(notification.type);
    const timeAgo = getTimeAgo(notification.created_at);
    const priorityColor = getPriorityColor(notification.priority);

    return (
        <div
            className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${
                !notification.read ? 'bg-violet-50/30' : ''
            }`}
            onClick={() => !notification.read && onMarkRead(notification.id)}
        >
            <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`mt-0.5 p-1.5 rounded-lg ${typeConfig.bg}`}>
                    <typeConfig.icon className={`w-3.5 h-3.5 ${typeConfig.color}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
                            {notification.title}
                        </p>
                        {!notification.read && (
                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500" />
                        )}
                    </div>

                    {notification.body && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                            {notification.body}
                        </p>
                    )}

                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-400">{timeAgo}</span>
                        {notification.priority !== 'normal' && (
                            <span className={`text-[10px] font-medium px-1 py-0.5 rounded ${priorityColor}`}>
                                {notification.priority}
                            </span>
                        )}
                        {notification.contacts?.name && (
                            <span className="text-[10px] text-gray-400 truncate">
                                {notification.contacts.name}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getTypeConfig(type: string) {
    const configs: Record<string, { icon: any; bg: string; color: string }> = {
        hot_lead: { icon: Flame, bg: 'bg-orange-100', color: 'text-orange-600' },
        needs_human: { icon: UserCheck, bg: 'bg-purple-100', color: 'text-purple-600' },
        objection_detected: { icon: AlertTriangle, bg: 'bg-yellow-100', color: 'text-yellow-600' },
        sentiment_drop: { icon: TrendingDown, bg: 'bg-red-100', color: 'text-red-600' },
        appointment_booked: { icon: Calendar, bg: 'bg-green-100', color: 'text-green-600' },
        sequence_completed: { icon: Check, bg: 'bg-blue-100', color: 'text-blue-600' },
        escalation: { icon: Flag, bg: 'bg-red-100', color: 'text-red-600' },
        at_risk: { icon: TrendingDown, bg: 'bg-red-100', color: 'text-red-500' },
    };
    return configs[type] || { icon: Bell, bg: 'bg-gray-100', color: 'text-gray-600' };
}

function getPriorityColor(priority: string): string {
    switch (priority) {
        case 'urgent': return 'bg-red-100 text-red-600';
        case 'high': return 'bg-orange-100 text-orange-600';
        case 'low': return 'bg-gray-100 text-gray-500';
        default: return 'bg-gray-100 text-gray-500';
    }
}

function getTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
