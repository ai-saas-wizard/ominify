"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Calendar,
    CheckCircle,
    XCircle,
    ExternalLink,
    Sheet,
    Loader2,
    Target,
    Copy,
    RefreshCw,
    Eye,
    EyeOff,
    AlertTriangle,
    Megaphone,
    Plus,
    Clock,
    X as XIcon,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem, fadeIn } from "@/lib/settings-animations";
import type { CalendlyEventType } from "@/lib/calendly";

// ─── Feature flags ───
// Flip these to false once Google OAuth verification / Meta App Review clears.
// Code, lib functions, OAuth routes, and Supabase migrations all stay shipped —
// only the UI is gated so users see "Coming soon" instead of an unverified flow.
const COMING_SOON_GOOGLE_CALENDAR = true;
const COMING_SOON_META_ADS = true;

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

interface GoogleAdsStatus {
    is_active: boolean;
    connected_at: string | null;
    last_lead_at: string | null;
    last_webhook_at: string | null;
    webhook_signing_key_preview: string | null;
    webhook_url: string;
}

interface MetaSubscribedPageView {
    id: string;
    page_id: string;
    page_name: string | null;
    subscribed_at: string | null;
    last_lead_at: string | null;
    last_webhook_at: string | null;
    subscription_active: boolean;
}

interface MetaAdsStatusView {
    is_active: boolean;
    connected_at: string | null;
    fb_user_name: string | null;
    fb_user_email: string | null;
    user_token_expires_at: string | null;
    subscribed_pages: MetaSubscribedPageView[];
}

interface MetaAvailablePage {
    id: string;
    name: string;
    category?: string;
}

type SubscribeMetaPagesResult =
    | { success: true; subscribedCount: number; failedCount: number }
    | { success: false; error: string };

type GenerateGoogleAdsResult =
    | { success: true; webhookUrl: string; signingKey: string }
    | { success: false; error: string };

type RotateGoogleAdsResult =
    | { success: true; signingKey: string }
    | { success: false; error: string };

interface IntegrationsContentProps {
    clientId: string;
    isConnected: boolean;
    calendarStatus: any;
    isSheetsConnected: boolean;
    sheetsStatus: any;
    isCalendlyConnected: boolean;
    calendlyStatus: CalendlyStatus | null;
    calendlyEventTypes: CalendlyEventType[];
    isGoogleAdsConnected: boolean;
    googleAdsStatus: GoogleAdsStatus | null;
    isMetaAdsConnected: boolean;
    metaAdsStatus: MetaAdsStatusView | null;
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
    handleGenerateGoogleAdsWebhook: () => Promise<GenerateGoogleAdsResult>;
    handleRotateGoogleAdsKey: () => Promise<RotateGoogleAdsResult>;
    handleShowGoogleAdsKey: () => Promise<{ signingKey: string | null }>;
    handleDisconnectGoogleAds: () => Promise<void>;
    handleListMetaPages: () => Promise<MetaAvailablePage[]>;
    handleSubscribeMetaPages: (
        pageIds: string[]
    ) => Promise<SubscribeMetaPagesResult>;
    handleUnsubscribeMetaPage: (pageId: string) => Promise<{ success: boolean }>;
    handleDisconnectMetaAds: () => Promise<void>;
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
    isGoogleAdsConnected,
    googleAdsStatus,
    isMetaAdsConnected,
    metaAdsStatus,
    searchParams,
    handleDisconnect,
    handleUpdateSettings,
    handleSheetsDisconnect,
    handleCalendlyConnect,
    handleCalendlySetEventType,
    handleCalendlyDisconnect,
    handleGenerateGoogleAdsWebhook,
    handleRotateGoogleAdsKey,
    handleShowGoogleAdsKey,
    handleDisconnectGoogleAds,
    handleListMetaPages,
    handleSubscribeMetaPages,
    handleUnsubscribeMetaPage,
    handleDisconnectMetaAds,
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
                {searchParams.success === "meta_ads" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <p className="text-green-800">
                            Meta connected. Now pick which Page(s) should send leads to Omnify.
                        </p>
                    </motion.div>
                )}
                {searchParams.error === "meta_ads_denied" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                        <p className="text-yellow-800">Meta connection was cancelled.</p>
                    </motion.div>
                )}
                {searchParams.error === "meta_ads_failed" && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
                    >
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <p className="text-red-800">
                            Failed to connect Meta Ads. Please try again.
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            {!COMING_SOON_GOOGLE_CALENDAR && isConnected && isCalendlyConnected && calendlyStatus?.selected_event_type_uri && (
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
                        {COMING_SOON_GOOGLE_CALENDAR ? (
                            <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                Coming soon
                            </Badge>
                        ) : isConnected ? (
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

                        {COMING_SOON_GOOGLE_CALENDAR && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-1.5">
                                <p className="font-semibold flex items-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    Verification with Google in progress
                                </p>
                                <p>
                                    We&apos;re in the OAuth verification queue with Google. In the
                                    meantime, use <strong>Calendly</strong> below for AI bookings —
                                    we&apos;ll switch this on the moment Google approves us.
                                </p>
                            </div>
                        )}
                        {!COMING_SOON_GOOGLE_CALENDAR && (
                        <>
                        <span style={{ display: "none" }}>{/* original UI preserved below */}</span>

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
                        </>
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

            {/* Google Ads Card */}
            <motion.div variants={staggerItem}>
                <GoogleAdsCard
                    isConnected={isGoogleAdsConnected}
                    status={googleAdsStatus}
                    onGenerate={handleGenerateGoogleAdsWebhook}
                    onRotate={handleRotateGoogleAdsKey}
                    onShowKey={handleShowGoogleAdsKey}
                    onDisconnect={handleDisconnectGoogleAds}
                />
            </motion.div>

            {/* Meta Ads Card */}
            <motion.div variants={staggerItem}>
                {COMING_SOON_META_ADS ? (
                    <MetaAdsComingSoonCard />
                ) : (
                    <MetaAdsCard
                        clientId={clientId}
                        isConnected={isMetaAdsConnected}
                        status={metaAdsStatus}
                        onListPages={handleListMetaPages}
                        onSubscribe={handleSubscribeMetaPages}
                        onUnsubscribe={handleUnsubscribeMetaPage}
                        onDisconnect={handleDisconnectMetaAds}
                    />
                )}
            </motion.div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════
// Meta Ads "Coming Soon" placeholder
// ═══════════════════════════════════════════════════════════

function MetaAdsComingSoonCard() {
    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div className="flex items-center gap-3">
                    <Megaphone className="w-5 h-5 text-rose-600" />
                    <h2 className="text-lg font-semibold text-gray-900">
                        Meta Ads (Facebook &amp; Instagram)
                    </h2>
                </div>
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Coming soon
                </Badge>
            </CardHeader>
            <CardContent className="pt-6">
                <p className="text-gray-600 mb-4">
                    Auto-enroll new leads from Facebook &amp; Instagram Lead Ads, straight into a
                    sequence.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-1.5">
                    <p className="font-semibold flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Meta App Review in progress
                    </p>
                    <p>
                        Native Meta Lead Ads is coming once Meta approves the app. In the meantime,
                        you can pipe leads into Omnify via the <strong>Google Ads</strong> webhook
                        below or any inbound webhook tool (Zapier / Make).
                    </p>
                </div>
            </CardContent>
        </Card>
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

// ═══════════════════════════════════════════════════════════
// Google Ads sub-component
// ═══════════════════════════════════════════════════════════

function freshnessLabel(timestamp: string | null | undefined): {
    label: string;
    tone: "ok" | "stale" | "never";
} {
    if (!timestamp) return { label: "No leads received yet", tone: "never" };
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    if (days < 1) {
        const hours = Math.max(1, Math.floor(ageMs / (60 * 60 * 1000)));
        return { label: `Last lead ${hours}h ago`, tone: "ok" };
    }
    if (days < 7) return { label: `Last lead ${days}d ago`, tone: "ok" };
    return { label: `Last lead ${days}d ago — check setup`, tone: "stale" };
}

function GoogleAdsCard({
    isConnected,
    status,
    onGenerate,
    onRotate,
    onShowKey,
    onDisconnect,
}: {
    isConnected: boolean;
    status: GoogleAdsStatus | null;
    onGenerate: () => Promise<GenerateGoogleAdsResult>;
    onRotate: () => Promise<RotateGoogleAdsResult>;
    onShowKey: () => Promise<{ signingKey: string | null }>;
    onDisconnect: () => Promise<void>;
}) {
    const [isPending, startTransition] = useTransition();
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<"url" | "key" | null>(null);

    const onGenerateClick = () => {
        setError(null);
        startTransition(async () => {
            const result = await onGenerate();
            if (!result.success) {
                setError(result.error || "Failed to generate webhook");
                return;
            }
            // Reveal the freshly minted key once so the owner can copy it
            // before it's masked.
            setRevealedKey(result.signingKey);
        });
    };

    const onRotateClick = () => {
        if (!confirm("Rotate the signing key? You'll need to update every Google Ads form that uses it.")) return;
        setError(null);
        startTransition(async () => {
            const result = await onRotate();
            if (!result.success) {
                setError(result.error || "Failed to rotate key");
                return;
            }
            setRevealedKey(result.signingKey);
        });
    };

    const onShowKeyClick = () => {
        startTransition(async () => {
            const result = await onShowKey();
            setRevealedKey(result.signingKey);
        });
    };

    const onCopy = (value: string, kind: "url" | "key") => {
        navigator.clipboard.writeText(value).then(() => {
            setCopied(kind);
            setTimeout(() => setCopied(null), 1500);
        });
    };

    const onDisconnectClick = () => {
        if (!confirm("Disconnect Google Ads? Your existing forms will keep sending leads but they'll be rejected.")) return;
        setRevealedKey(null);
        startTransition(async () => {
            await onDisconnect();
        });
    };

    const fresh = isConnected ? freshnessLabel(status?.last_lead_at) : null;

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div className="flex items-center gap-3">
                    <Target className="w-5 h-5 text-sky-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Google Ads</h2>
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
                    Auto-enroll leads from Google Ads Lead Form Assets. Generate a per-account
                    webhook URL + key, then paste both into each form&apos;s &quot;Webhook
                    integration&quot; delivery option in Google Ads.
                </p>

                {!isConnected ? (
                    <div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 mb-4 space-y-1.5">
                            <p className="font-semibold">How it works:</p>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Generate a webhook URL + signing key here.</li>
                                <li>
                                    In Google Ads, open <strong>Tools &amp; Settings → Asset
                                    Library → Lead Forms</strong>, edit each form, scroll to{" "}
                                    <strong>Lead delivery options</strong>, and choose{" "}
                                    <strong>Webhook integration</strong>.
                                </li>
                                <li>Paste the URL and key, click <strong>Send test data</strong>.</li>
                                <li>Confirm the green &quot;Connected&quot; badge appears here.</li>
                            </ol>
                        </div>
                        <Button type="button" onClick={onGenerateClick} disabled={isPending} className="gap-2">
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Target className="w-4 h-4" />
                                    Generate webhook URL
                                </>
                            )}
                        </Button>
                        {error && (
                            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {fresh && (
                            <div
                                className={
                                    fresh.tone === "ok"
                                        ? "bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-800"
                                        : fresh.tone === "stale"
                                        ? "bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-sm text-amber-800"
                                        : "bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2 text-sm text-gray-700"
                                }
                            >
                                {fresh.tone === "ok" ? (
                                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                ) : (
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                )}
                                {fresh.label}
                            </div>
                        )}

                        <div className="space-y-3">
                            <div>
                                <Label className="mb-1.5 block text-gray-600">Webhook URL</Label>
                                <div className="flex gap-2">
                                    <Input readOnly value={status?.webhook_url || ""} className="font-mono text-xs" />
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => onCopy(status?.webhook_url || "", "url")}
                                        className="gap-1.5"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                        {copied === "url" ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-gray-600">Signing key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        readOnly
                                        value={
                                            revealedKey ||
                                            (status?.webhook_signing_key_preview
                                                ? `gak_••••••••••••${status.webhook_signing_key_preview}`
                                                : "")
                                        }
                                        className="font-mono text-xs"
                                    />
                                    {revealedKey ? (
                                        <>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => onCopy(revealedKey, "key")}
                                                className="gap-1.5"
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                                {copied === "key" ? "Copied" : "Copy"}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => setRevealedKey(null)}
                                                className="gap-1.5"
                                            >
                                                <EyeOff className="w-3.5 h-3.5" />
                                                Hide
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={onShowKeyClick}
                                            disabled={isPending}
                                            className="gap-1.5"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Show
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-1">
                            <p>
                                Generated:{" "}
                                <span className="text-gray-900 font-medium">
                                    {status?.connected_at
                                        ? new Date(status.connected_at).toLocaleDateString()
                                        : "—"}
                                </span>
                            </p>
                            <p>
                                Last webhook hit:{" "}
                                <span className="text-gray-900 font-medium">
                                    {status?.last_webhook_at
                                        ? new Date(status.last_webhook_at).toLocaleString()
                                        : "Never"}
                                </span>
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={onRotateClick}
                                disabled={isPending}
                                className="gap-1.5"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Rotate key
                            </Button>
                            <Button
                                type="button"
                                variant="link"
                                onClick={onDisconnectClick}
                                disabled={isPending}
                                className="text-red-600 hover:text-red-800 p-0 h-auto"
                            >
                                Disconnect Google Ads
                            </Button>
                        </div>
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ═══════════════════════════════════════════════════════════
// Meta Ads sub-component
// ═══════════════════════════════════════════════════════════

function MetaAdsCard({
    clientId,
    isConnected,
    status,
    onListPages,
    onSubscribe,
    onUnsubscribe,
    onDisconnect,
}: {
    clientId: string;
    isConnected: boolean;
    status: MetaAdsStatusView | null;
    onListPages: () => Promise<MetaAvailablePage[]>;
    onSubscribe: (pageIds: string[]) => Promise<SubscribeMetaPagesResult>;
    onUnsubscribe: (pageId: string) => Promise<{ success: boolean }>;
    onDisconnect: () => Promise<void>;
}) {
    const [isPending, startTransition] = useTransition();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [availablePages, setAvailablePages] = useState<MetaAvailablePage[] | null>(
        null
    );
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const subscribedIds = new Set(
        (status?.subscribed_pages || [])
            .filter((p) => p.subscription_active)
            .map((p) => p.page_id)
    );

    const togglePage = (pageId: string) => {
        const next = new Set(selected);
        if (next.has(pageId)) next.delete(pageId);
        else next.add(pageId);
        setSelected(next);
    };

    const onOpenPicker = () => {
        setError(null);
        setPickerOpen(true);
        startTransition(async () => {
            const pages = await onListPages();
            // Filter out Pages already subscribed.
            setAvailablePages(pages.filter((p) => !subscribedIds.has(p.id)));
        });
    };

    const onSubscribeClick = () => {
        if (selected.size === 0) {
            setError("Pick at least one Page");
            return;
        }
        setError(null);
        startTransition(async () => {
            const result = await onSubscribe(Array.from(selected));
            if (!result.success) {
                setError(result.error);
                return;
            }
            setPickerOpen(false);
            setSelected(new Set());
            setAvailablePages(null);
        });
    };

    const onUnsubscribeClick = (pageId: string, name: string | null) => {
        if (!confirm(`Stop receiving leads from "${name || pageId}"?`)) return;
        startTransition(async () => {
            await onUnsubscribe(pageId);
        });
    };

    const onDisconnectClick = () => {
        if (
            !confirm(
                "Disconnect Meta? All Page subscriptions will be removed and tokens cleared."
            )
        )
            return;
        startTransition(async () => {
            await onDisconnect();
        });
    };

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div className="flex items-center gap-3">
                    <Megaphone className="w-5 h-5 text-rose-600" />
                    <h2 className="text-lg font-semibold text-gray-900">
                        Meta Ads (Facebook &amp; Instagram)
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
                    Auto-enroll new leads from your Facebook &amp; Instagram Lead Ads.
                    We&apos;ll subscribe to your Pages&apos; lead webhook so every form
                    submission flows straight into your sequence.
                </p>

                {!isConnected ? (
                    <a
                        href={`/api/integrations/meta-ads/authorize?clientId=${clientId}`}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] text-white text-sm font-medium rounded-lg hover:bg-[#0d6ae3] transition shadow-sm"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Connect with Facebook
                    </a>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                            <p className="text-sm text-gray-500">
                                Connected as:{" "}
                                <span className="text-gray-900 font-medium">
                                    {status?.fb_user_name ||
                                        status?.fb_user_email ||
                                        "Unknown"}
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
                            {status?.user_token_expires_at && (
                                <p className="text-sm text-gray-500">
                                    Token expires:{" "}
                                    <span className="text-gray-900 font-medium">
                                        {new Date(
                                            status.user_token_expires_at
                                        ).toLocaleDateString()}
                                    </span>
                                </p>
                            )}
                        </div>

                        {(status?.subscribed_pages || []).length === 0 ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-amber-900">
                                    <p className="font-semibold mb-0.5">Pick a Page to start receiving leads.</p>
                                    <p>Until you subscribe at least one Page, no leads will flow into Omnify.</p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                                    Subscribed Pages
                                </h3>
                                <ul className="space-y-2">
                                    {(status?.subscribed_pages || [])
                                        .filter((p) => p.subscription_active)
                                        .map((p) => (
                                            <li
                                                key={p.page_id}
                                                className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                        {p.page_name || p.page_id}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {p.last_lead_at
                                                            ? `Last lead ${new Date(
                                                                  p.last_lead_at
                                                              ).toLocaleDateString()}`
                                                            : "No leads yet"}
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="link"
                                                    onClick={() =>
                                                        onUnsubscribeClick(p.page_id, p.page_name)
                                                    }
                                                    disabled={isPending}
                                                    className="text-red-600 hover:text-red-800 p-0 h-auto text-xs"
                                                >
                                                    Remove
                                                </Button>
                                            </li>
                                        ))}
                                </ul>
                            </div>
                        )}

                        {pickerOpen ? (
                            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                        Add Pages
                                    </h3>
                                    <Button
                                        type="button"
                                        variant="link"
                                        onClick={() => {
                                            setPickerOpen(false);
                                            setSelected(new Set());
                                        }}
                                        className="text-gray-500 hover:text-gray-700 p-0 h-auto"
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                                {availablePages === null ? (
                                    <div className="flex items-center gap-2 text-sm text-gray-500">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading your Pages...
                                    </div>
                                ) : availablePages.length === 0 ? (
                                    <p className="text-sm text-gray-500">
                                        No additional Pages available. If you expected to see one,
                                        make sure you granted Page access during the Facebook login
                                        flow.
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                                        {availablePages.map((p) => (
                                            <li key={p.id}>
                                                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(p.id)}
                                                        onChange={() => togglePage(p.id)}
                                                        className="w-4 h-4"
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 truncate">
                                                            {p.name}
                                                        </p>
                                                        {p.category && (
                                                            <p className="text-xs text-gray-500">
                                                                {p.category}
                                                            </p>
                                                        )}
                                                    </div>
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {error && (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                        <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                        <p className="text-sm text-red-800">{error}</p>
                                    </div>
                                )}
                                <Button
                                    type="button"
                                    onClick={onSubscribeClick}
                                    disabled={isPending || selected.size === 0}
                                    className="gap-1.5"
                                >
                                    {isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Subscribing...
                                        </>
                                    ) : (
                                        <>Subscribe {selected.size > 0 && `(${selected.size})`}</>
                                    )}
                                </Button>
                            </div>
                        ) : (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={onOpenPicker}
                                disabled={isPending}
                                className="gap-1.5"
                            >
                                <Plus className="w-4 h-4" />
                                Add Page
                            </Button>
                        )}

                        <div className="pt-4 border-t border-gray-200">
                            <Button
                                type="button"
                                variant="link"
                                onClick={onDisconnectClick}
                                disabled={isPending}
                                className="text-red-600 hover:text-red-800 p-0 h-auto"
                            >
                                Disconnect Meta Ads
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
