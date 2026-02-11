import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft, Calendar, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { getCalendarConnectionStatus, disconnectCalendar, updateCalendarSettings } from "@/lib/google-calendar";
import { revalidatePath } from "next/cache";

export default async function IntegrationsPage(props: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ success?: string; error?: string }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const clientId = params.clientId;

    const calendarStatus = await getCalendarConnectionStatus(clientId);
    const isConnected = calendarStatus?.is_active === true;

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    async function handleDisconnect() {
        "use server";
        await disconnectCalendar(clientId);
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    async function handleUpdateSettings(formData: FormData) {
        "use server";
        const duration = parseInt(formData.get("duration") as string) || 60;
        const buffer = parseInt(formData.get("buffer") as string) || 15;
        const window = parseInt(formData.get("window") as string) || 14;

        await updateCalendarSettings(clientId, {
            default_duration_minutes: duration,
            buffer_minutes: buffer,
            booking_window_days: window,
        });
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <Link
                    href={`/client/${clientId}/settings`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Settings
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
                <p className="mt-1 text-gray-600">
                    Connect external services to enhance your AI agents
                </p>
            </div>

            {/* Status Messages */}
            {searchParams.success === "calendar" && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-green-800">Google Calendar connected successfully!</p>
                </div>
            )}
            {searchParams.error === "denied" && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                    <p className="text-yellow-800">Calendar connection was cancelled.</p>
                </div>
            )}
            {searchParams.error === "failed" && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                    <p className="text-red-800">
                        Failed to connect Google Calendar. Please try again.
                    </p>
                </div>
            )}

            {/* Google Calendar Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-gray-600" />
                            <h2 className="text-lg font-semibold text-gray-900">
                                Google Calendar
                            </h2>
                        </div>
                        {isConnected ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                                <CheckCircle className="w-4 h-4" />
                                Connected
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                                Not connected
                            </span>
                        )}
                    </div>
                </div>

                <div className="p-6">
                    <p className="text-gray-600 mb-6">
                        Connect Google Calendar to let your AI agents check availability and book
                        appointments directly during calls.
                    </p>

                    {isConnected ? (
                        <div className="space-y-6">
                            {/* Connection Info */}
                            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                <p className="text-sm text-gray-500">
                                    Connected since:{" "}
                                    <span className="text-gray-900 font-medium">
                                        {calendarStatus?.connected_at
                                            ? new Date(calendarStatus.connected_at).toLocaleDateString()
                                            : "Unknown"}
                                    </span>
                                </p>
                                <p className="text-sm text-gray-500">
                                    Calendar:{" "}
                                    <span className="text-gray-900 font-medium">
                                        {calendarStatus?.google_calendar_id || "Primary"}
                                    </span>
                                </p>
                            </div>

                            {/* Settings Form */}
                            <form action={handleUpdateSettings} className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-900">
                                    Booking Settings
                                </h3>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm text-gray-600 mb-1">
                                            Appointment Duration (min)
                                        </label>
                                        <input
                                            type="number"
                                            name="duration"
                                            defaultValue={calendarStatus?.default_duration_minutes || 60}
                                            min={15}
                                            max={480}
                                            step={15}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-gray-600 mb-1">
                                            Buffer Between (min)
                                        </label>
                                        <input
                                            type="number"
                                            name="buffer"
                                            defaultValue={calendarStatus?.buffer_minutes || 15}
                                            min={0}
                                            max={120}
                                            step={5}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-gray-600 mb-1">
                                            Booking Window (days)
                                        </label>
                                        <input
                                            type="number"
                                            name="window"
                                            defaultValue={calendarStatus?.booking_window_days || 14}
                                            min={1}
                                            max={90}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition"
                                >
                                    Save Settings
                                </button>
                            </form>

                            {/* Disconnect */}
                            <div className="pt-4 border-t border-gray-200">
                                <form action={handleDisconnect}>
                                    <button
                                        type="submit"
                                        className="text-sm text-red-600 hover:text-red-800 font-medium transition"
                                    >
                                        Disconnect Google Calendar
                                    </button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <a
                            href={`/api/integrations/google-calendar/authorize?clientId=${clientId}`}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition shadow-sm"
                        >
                            <ExternalLink className="w-4 h-4" />
                            Connect Google Calendar
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
