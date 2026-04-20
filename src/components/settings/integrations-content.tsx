"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, CheckCircle, XCircle, ExternalLink, Sheet, Loader2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem, fadeIn } from "@/lib/settings-animations";
import type { CalendlyEventType } from "@/lib/calendly";

interface CalendlyStatus {
    is_active?: boolean;
    connected_at?: string | null;
    calendly_user_email?: string | null;
    calendly_user_name?: string | null;
    selected_event_type_uri?: string | null;
    selected_event_type_name?: string | null;
    selected_event_type_duration?: number | null;
    booking_window_days?: number | null;
}

interface IntegrationsContentProps {
    clientId: string;
    isConnected: boolean;
    calendarStatus: any;
    isSheetsConnected: boolean;
    sheetsStatus: any;
    isCalendlyConnected: boolean;
    calendlyStatus: CalendlyStatus | null;
    calendlyEventTypes: CalendlyEventType[];
    searchParams: { success?: string; error?: string };
    handleDisconnect: () => Promise<void>;
    handleUpdateSettings: (formData: FormData) => Promise<void>;
    handleSheetsDisconnect: () => Promise<void>;
    handleCalendlyConnect: (formData: FormData) => Promise<
        | { success: true; webhookOk: boolean; webhookError?: string }
        | { success: false; error: string }
    >;
    handleCalendlySetEventType: (formData: FormData) => Promise<void>;
    handleCalendlyDisconnect: () => Promise<void>;
}

export function IntegrationsContent({
    clientId,
    isConnected,
    calendarStatus,
    isSheetsConnected,
    sheetsStatus,
    isCalendlyConnected,
    calendlyStatus,
    calendlyEventTypes,
    searchParams,
    handleDisconnect,
    handleUpdateSettings,
    handleSheetsDisconnect,
    handleCalendlyConnect,
    handleCalendlySetEventType,
    handleCalendlyDisconnect,
}: IntegrationsContentProps) {
    return (
        <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-8"
        >
            {/* Status Messages */}
            <AnimatePresence>
                {searchParams.success === "calendar" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <p className="text-green-800">Google Calendar connected successfully!</p>
                    </motion.div>
                )}
                {searchParams.success === "sheets" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <p className="text-green-800">Google Sheets connected successfully! A lead spreadsheet has been created.</p>
                    </motion.div>
                )}
                {searchParams.error === "denied" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                        <p className="text-yellow-800">Calendar connection was cancelled.</p>
                    </motion.div>
                )}
                {searchParams.error === "sheets_denied" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                        <p className="text-yellow-800">Google Sheets connection was cancelled.</p>
                    </motion.div>
                )}
                {searchParams.error === "failed" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <p className="text-red-800">Failed to connect Google Calendar. Please try again.</p>
                    </motion.div>
                )}
                {searchParams.error === "sheets_failed" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <p className="text-red-800">Failed to connect Google Sheets. Please try again.</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {isConnected && isCalendlyConnected && calendlyStatus?.selected_event_type_uri && (
                <motion.div variants={staggerItem}>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                        Both Google Calendar and Calendly are connected. <strong>Calendly takes priority</strong> for AI bookings while it&apos;s active — disconnect Calendly to use Google Calendar instead.
                    </div>
                </motion.div>
            )}

            {/* Google Calendar Card */}
            <motion.div variants={staggerItem}>
                <Card className="overflow-hidden">
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                        <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-gray-600" />
                            <h2 className="text-lg font-semibold text-gray-900">
                                Google Calendar
                            </h2>
                        </div>
                        {isConnected ? (
                            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1.5">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Connected
                            </Badge>
                        ) : (
                            <Badge variant="secondary">Not connected</Badge>
                        )}
                    </CardHeader>

                    <CardContent className="pt-6">
                        <p className="text-gray-600 mb-6">
                            Connect Google Calendar to let your AI agents check availability and book
                            appointments directly during calls.
                        </p>

                        {isConnected ? (
                            <div className="space-y-6">
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

                                <form action={handleUpdateSettings} className="space-y-4">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                        Booking Settings
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <Label htmlFor="duration" className="mb-1.5 block text-gray-600">
                                                Appointment Duration (min)
                                            </Label>
                                            <Input
                                                id="duration"
                                                type="number"
                                                name="duration"
                                                defaultValue={calendarStatus?.default_duration_minutes || 60}
                                                min={15}
                                                max={480}
                                                step={15}
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="buffer" className="mb-1.5 block text-gray-600">
                                                Buffer Between (min)
                                            </Label>
                                            <Input
                                                id="buffer"
                                                type="number"
                                                name="buffer"
                                                defaultValue={calendarStatus?.buffer_minutes || 15}
                                                min={0}
                                                max={120}
                                                step={5}
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="window" className="mb-1.5 block text-gray-600">
                                                Booking Window (days)
                                            </Label>
                                            <Input
                                                id="window"
                                                type="number"
                                                name="window"
                                                defaultValue={calendarStatus?.booking_window_days || 14}
                                                min={1}
                                                max={90}
                                            />
                                        </div>
                                    </div>
                                    <Button type="submit" variant="secondary">
                                        Save Settings
                                    </Button>
                                </form>

                                <div className="pt-4 border-t border-gray-200">
                                    <form action={handleDisconnect}>
                                        <Button type="submit" variant="link" className="text-red-600 hover:text-red-800 p-0 h-auto">
                                            Disconnect Google Calendar
                                        </Button>
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
                    </CardContent>
                </Card>
            </motion.div>

            {/* Calendly Card */}
            <motion.div variants={staggerItem}>
                <CalendlyCard
                    isConnected={isCalendlyConnected}
                    status={calendlyStatus}
                    eventTypes={calendlyEventTypes}
                    handleConnect={handleCalendlyConnect}
                    handleSetEventType={handleCalendlySetEventType}
                    handleDisconnect={handleCalendlyDisconnect}
                />
            </motion.div>

            {/* Google Sheets Card */}
            <motion.div variants={staggerItem}>
                <Card className="overflow-hidden">
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                        <div className="flex items-center gap-3">
                            <Sheet className="w-5 h-5 text-gray-600" />
                            <h2 className="text-lg font-semibold text-gray-900">
                                Google Sheets
                            </h2>
                        </div>
                        {isSheetsConnected ? (
                            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1.5">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Connected
                            </Badge>
                        ) : (
                            <Badge variant="secondary">Not connected</Badge>
                        )}
                    </CardHeader>

                    <CardContent className="pt-6">
                        <p className="text-gray-600 mb-6">
                            Connect Google Sheets to automatically log call data from your AI agents.
                            A lead spreadsheet is created automatically with all the right columns.
                        </p>

                        {isSheetsConnected ? (
                            <div className="space-y-6">
                                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                    <p className="text-sm text-gray-500">
                                        Connected since:{" "}
                                        <span className="text-gray-900 font-medium">
                                            {sheetsStatus?.connected_at
                                                ? new Date(sheetsStatus.connected_at).toLocaleDateString()
                                                : "Unknown"}
                                        </span>
                                    </p>
                                    {sheetsStatus?.google_sheet_url && (
                                        <p className="text-sm text-gray-500">
                                            Spreadsheet:{" "}
                                            <a
                                                href={sheetsStatus.google_sheet_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
                                            >
                                                Open in Google Sheets
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </p>
                                    )}
                                </div>

                                <div className="bg-emerald-50 rounded-lg p-4">
                                    <p className="text-sm text-emerald-800">
                                        Call data is automatically logged after each qualifying call.
                                        Caller name, property details, situation, appointment status, and more
                                        are extracted and added as a new row.
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <form action={handleSheetsDisconnect}>
                                        <Button type="submit" variant="link" className="text-red-600 hover:text-red-800 p-0 h-auto">
                                            Disconnect Google Sheets
                                        </Button>
                                    </form>
                                </div>
                            </div>
                        ) : (
                            <a
                                href={`/api/integrations/google-sheets/authorize?clientId=${clientId}`}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition shadow-sm"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Connect Google Sheets
                            </a>
                        )}
                    </CardContent>
                </Card>
            </motion.div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════
// Calendly sub-component
// ═══════════════════════════════════════════════════════════

function CalendlyCard({
    isConnected,
    status,
    eventTypes,
    handleConnect,
    handleSetEventType,
    handleDisconnect,
}: {
    isConnected: boolean;
    status: CalendlyStatus | null;
    eventTypes: CalendlyEventType[];
    handleConnect: (formData: FormData) => Promise<
        | { success: true; webhookOk: boolean; webhookError?: string }
        | { success: false; error: string }
    >;
    handleSetEventType: (formData: FormData) => Promise<void>;
    handleDisconnect: () => Promise<void>;
}) {
    const [pat, setPat] = useState("");
    const [connectError, setConnectError] = useState<string | null>(null);
    const [webhookWarning, setWebhookWarning] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const onSubmitConnect = (formData: FormData) => {
        formData.set("pat", pat);
        setConnectError(null);
        setWebhookWarning(null);
        startTransition(async () => {
            const result = await handleConnect(formData);
            if (!result.success) {
                setConnectError(result.error || "Failed to connect");
                return;
            }
            setPat("");
            if (!result.webhookOk) {
                setWebhookWarning(
                    result.webhookError ||
                        "Booking works, but we couldn't register a webhook. Cancellations made in Calendly won't sync back automatically.",
                );
            }
        });
    };

    const hasNoEventType = isConnected && !status?.selected_event_type_uri;

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-[#006BFF]" />
                    <h2 className="text-lg font-semibold text-gray-900">Calendly</h2>
                </div>
                {isConnected ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Connected
                    </Badge>
                ) : (
                    <Badge variant="secondary">Not connected</Badge>
                )}
            </CardHeader>

            <CardContent className="pt-6">
                <p className="text-gray-600 mb-6">
                    Connect Calendly to let your AI agents book appointments on any calendar you&apos;ve
                    already linked to Calendly — Google, Outlook, iCloud, or Office 365.
                </p>

                {isConnected ? (
                    <div className="space-y-6">
                        {hasNoEventType && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                                <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-amber-900">
                                    <p className="font-semibold mb-0.5">Pick an event type to finish setup.</p>
                                    <p>Your AI agent can&apos;t book appointments until you select which Calendly event type to use.</p>
                                </div>
                            </div>
                        )}
                        {webhookWarning && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                                <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-amber-900">
                                    <p className="font-semibold mb-0.5">Webhook not registered.</p>
                                    <p>{webhookWarning}</p>
                                </div>
                            </div>
                        )}
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                            <p className="text-sm text-gray-500">
                                Connected as:{" "}
                                <span className="text-gray-900 font-medium">
                                    {status?.calendly_user_name || status?.calendly_user_email || "Unknown"}
                                </span>
                            </p>
                            <p className="text-sm text-gray-500">
                                Connected since:{" "}
                                <span className="text-gray-900 font-medium">
                                    {status?.connected_at
                                        ? new Date(status.connected_at).toLocaleDateString()
                                        : "Unknown"}
                                </span>
                            </p>
                            {status?.selected_event_type_name && (
                                <p className="text-sm text-gray-500">
                                    Booking into:{" "}
                                    <span className="text-gray-900 font-medium">
                                        {status.selected_event_type_name}
                                        {status.selected_event_type_duration
                                            ? ` (${status.selected_event_type_duration} min)`
                                            : ""}
                                    </span>
                                </p>
                            )}
                        </div>

                        <form action={handleSetEventType} className="space-y-4">
                            <h3 className="text-sm font-semibold text-gray-900">
                                Event Type for AI Bookings
                            </h3>
                            <p className="text-sm text-gray-500">
                                The AI agent will book callers into this Calendly event type.
                                Duration and buffers come from Calendly.
                            </p>
                            {eventTypes.length > 0 ? (
                                <div className="flex flex-col md:flex-row gap-3 items-start md:items-end">
                                    <div className="flex-1 w-full">
                                        <Label htmlFor="eventTypeUri" className="mb-1.5 block text-gray-600">
                                            Event Type
                                        </Label>
                                        <select
                                            id="eventTypeUri"
                                            name="eventTypeUri"
                                            defaultValue={status?.selected_event_type_uri || ""}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="" disabled>
                                                — Select an event type —
                                            </option>
                                            {eventTypes.map((et) => (
                                                <option key={et.uri} value={et.uri}>
                                                    {et.name} ({et.duration} min)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <Button type="submit" variant="secondary">
                                        Save Event Type
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                                    No active event types found on your Calendly account. Create one in
                                    Calendly first, then refresh this page.
                                </p>
                            )}
                        </form>

                        <div className="pt-4 border-t border-gray-200">
                            <form action={handleDisconnect}>
                                <Button
                                    type="submit"
                                    variant="link"
                                    className="text-red-600 hover:text-red-800 p-0 h-auto"
                                >
                                    Disconnect Calendly
                                </Button>
                            </form>
                        </div>
                    </div>
                ) : (
                    <form action={onSubmitConnect} className="space-y-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                            <p className="font-semibold mb-1">Requires a paid Calendly plan.</p>
                            <p>
                                Get your Personal Access Token from{" "}
                                <a
                                    href="https://calendly.com/integrations/api_webhooks"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline font-medium"
                                >
                                    Integrations → API & Webhooks
                                </a>
                                , then paste it below.
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="pat" className="mb-1.5 block text-gray-600">
                                Calendly API Key
                            </Label>
                            <Input
                                id="pat"
                                name="pat"
                                type="password"
                                placeholder="eyJraWQ..."
                                value={pat}
                                onChange={(e) => setPat(e.target.value)}
                                autoComplete="off"
                            />
                        </div>

                        {connectError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-800">{connectError}</p>
                            </div>
                        )}

                        <Button type="submit" disabled={!pat || isPending} className="gap-2">
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    <ExternalLink className="w-4 h-4" />
                                    Connect Calendly
                                </>
                            )}
                        </Button>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
