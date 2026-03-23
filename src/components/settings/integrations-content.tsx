"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Calendar, CheckCircle, XCircle, ExternalLink, Sheet } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem, fadeIn } from "@/lib/settings-animations";

interface IntegrationsContentProps {
    clientId: string;
    isConnected: boolean;
    calendarStatus: any;
    isSheetsConnected: boolean;
    sheetsStatus: any;
    searchParams: { success?: string; error?: string };
    handleDisconnect: () => Promise<void>;
    handleUpdateSettings: (formData: FormData) => Promise<void>;
    handleSheetsDisconnect: () => Promise<void>;
}

export function IntegrationsContent({
    clientId,
    isConnected,
    calendarStatus,
    isSheetsConnected,
    sheetsStatus,
    searchParams,
    handleDisconnect,
    handleUpdateSettings,
    handleSheetsDisconnect,
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
