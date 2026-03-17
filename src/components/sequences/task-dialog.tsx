"use client";

import { useState, useRef, useCallback } from "react";
import * as Papa from "papaparse";
import {
    Loader2,
    X,
    Upload,
    FileSpreadsheet,
    CheckCircle2,
    AlertTriangle,
    Rocket,
    FlaskConical,
    MessageSquare,
    Mail,
    Phone,
    Columns,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { createTaskFromDescription } from "@/app/actions/ai-generate-sequence-actions";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChannelReadiness {
    sms: { ready: boolean; reason?: string };
    email: { ready: boolean; reason?: string };
    voice: { ready: boolean; reason?: string };
}

interface TaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clientId: string;
    channelReadiness: ChannelReadiness;
    onLaunch: (sequenceId: string) => void;
    onTestMode: (sequenceId: string) => void;
}

// ── Channel Config ───────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { icon: typeof MessageSquare; label: string; color: string; bg: string }> = {
    sms: { icon: MessageSquare, label: "SMS", color: "text-blue-600", bg: "bg-blue-50" },
    email: { icon: Mail, label: "Email", color: "text-violet-600", bg: "bg-violet-50" },
    voice: { icon: Phone, label: "Voice", color: "text-emerald-600", bg: "bg-emerald-50" },
};

// ── Component ────────────────────────────────────────────────────────────────

export function TaskDialog({
    open,
    onOpenChange,
    clientId,
    channelReadiness,
    onLaunch,
    onTestMode,
}: TaskDialogProps) {
    const [instruction, setInstruction] = useState("");
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvColumns, setCsvColumns] = useState<string[]>([]);
    const [csvRowCount, setCsvRowCount] = useState(0);
    const [csvSampleData, setCsvSampleData] = useState<Record<string, string>[]>([]);
    const [csvParsedData, setCsvParsedData] = useState<Record<string, string>[]>([]);
    const [loadingAction, setLoadingAction] = useState<"launch" | "test" | null>(null);
    const [error, setError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── CSV Parsing (simple header extraction) ──────────────────────────────

    const handleFileSelect = useCallback((file: File) => {
        if (!file.name.endsWith(".csv")) {
            setError("Please upload a CSV file.");
            return;
        }

        setCsvFile(file);
        setError("");

        // Full parse with PapaParse for accurate header detection and data extraction
        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const headers = results.meta.fields || [];

                if (headers.length === 0) {
                    setError("No columns detected in CSV.");
                    setCsvFile(null);
                    return;
                }

                if (results.data.length === 0) {
                    setError("CSV file appears to be empty.");
                    setCsvFile(null);
                    return;
                }

                setCsvColumns(headers);
                setCsvRowCount(results.data.length);
                setCsvSampleData(results.data.slice(0, 3));
                setCsvParsedData(results.data);
            },
            error: () => {
                setError("Failed to read file.");
                setCsvFile(null);
            },
        });
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelect(file);
        },
        [handleFileSelect]
    );

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
        },
        [handleFileSelect]
    );

    const removeFile = useCallback(() => {
        setCsvFile(null);
        setCsvColumns([]);
        setCsvRowCount(0);
        setCsvSampleData([]);
        setCsvParsedData([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, []);

    // ── Submit Handlers ─────────────────────────────────────────────────────

    const handleSubmit = useCallback(
        async (mode: "launch" | "test") => {
            if (!instruction.trim()) {
                setError("Please describe what you want to do.");
                return;
            }

            setLoadingAction(mode);
            setError("");

            try {
                const result = await createTaskFromDescription(
                    clientId,
                    instruction.trim(),
                    csvColumns.length > 0 ? csvColumns : undefined,
                    channelReadiness
                );

                if (!result.success || !result.sequenceId) {
                    setError(result.error || "Failed to create task. Please try again.");
                    setLoadingAction(null);
                    return;
                }

                // Success — invoke the appropriate callback
                if (mode === "test") {
                    onTestMode(result.sequenceId);
                } else {
                    onLaunch(result.sequenceId);
                }

                // Close dialog on success
                onOpenChange(false);

                // Reset state
                setInstruction("");
                setCsvFile(null);
                setCsvColumns([]);
                setCsvRowCount(0);
                setCsvSampleData([]);
                setCsvParsedData([]);
                setError("");
            } catch (err) {
                setError(err instanceof Error ? err.message : "An unexpected error occurred.");
            } finally {
                setLoadingAction(null);
            }
        },
        [instruction, csvColumns, clientId, channelReadiness, onLaunch, onTestMode, onOpenChange]
    );

    const handleClose = useCallback(() => {
        if (loadingAction !== null) return;
        onOpenChange(false);
        // Reset after animation
        setTimeout(() => {
            setInstruction("");
            setCsvFile(null);
            setCsvColumns([]);
            setCsvRowCount(0);
            setCsvSampleData([]);
            setCsvParsedData([]);
            setError("");
        }, 200);
    }, [loadingAction, onOpenChange]);

    // ── Derived state ───────────────────────────────────────────────────────

    const anyChannelReady =
        channelReadiness.sms.ready ||
        channelReadiness.email.ready ||
        channelReadiness.voice.ready;

    const canSubmit = instruction.trim().length > 0 && anyChannelReady && loadingAction === null;

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col overflow-hidden"
                    >
                        {/* ── Header ─────────────────────────────────────── */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-violet-100 rounded-lg">
                                    <Rocket className="w-4 h-4 text-violet-600" />
                                </div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    New Task
                                </h2>
                            </div>
                            <button
                                onClick={handleClose}
                                disabled={loadingAction !== null}
                                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* ── Body ───────────────────────────────────────── */}
                        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(80vh-140px)]">
                            {/* Instruction Textarea */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    What do you want to do?
                                </label>
                                <Textarea
                                    value={instruction}
                                    onChange={(e) => setInstruction(e.target.value)}
                                    placeholder={'e.g. "Send an SMS to all leads who missed a call this week, then follow up with an email the next day if they don\'t reply"'}
                                    rows={4}
                                    disabled={loadingAction !== null}
                                    className="min-h-[100px]"
                                />
                            </div>

                            {/* CSV Upload Area */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                    <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                                    CSV Contact List
                                    <span className="text-xs text-gray-400 font-normal">(optional)</span>
                                </label>

                                {!csvFile ? (
                                    <div
                                        onDrop={handleDrop}
                                        onDragOver={handleDragOver}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="border-2 border-dashed border-gray-200 hover:border-violet-300 rounded-lg p-6 text-center cursor-pointer transition-colors group"
                                    >
                                        <Upload className="w-6 h-6 text-gray-300 group-hover:text-violet-400 mx-auto mb-2 transition-colors" />
                                        <p className="text-sm text-gray-500">
                                            Drop a CSV file here or{" "}
                                            <span className="text-violet-600 font-medium">browse</span>
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Column headers will be available as template variables
                                        </p>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".csv"
                                            onChange={handleFileInputChange}
                                            className="hidden"
                                        />
                                    </div>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="border border-gray-200 rounded-lg p-4 space-y-3"
                                    >
                                        {/* File info row */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <div className="p-1.5 bg-emerald-50 rounded-md">
                                                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                                                        {csvFile.name}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {csvRowCount} row{csvRowCount !== 1 ? "s" : ""} &middot;{" "}
                                                        {csvColumns.length} column{csvColumns.length !== 1 ? "s" : ""}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={removeFile}
                                                disabled={loadingAction !== null}
                                                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>

                                        {/* Detected columns */}
                                        {csvColumns.length > 0 && (
                                            <div className="space-y-1.5">
                                                <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
                                                    <Columns className="w-3 h-3" />
                                                    Detected Columns
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {csvColumns.map((col) => (
                                                        <span
                                                            key={col}
                                                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-xs font-mono text-violet-700"
                                                        >
                                                            {`{{${col}}}`}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </div>

                            {/* Channel Status */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Channel Status
                                </label>
                                <TooltipProvider delayDuration={200}>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(["sms", "email", "voice"] as const).map((ch) => {
                                            const config = CHANNEL_CONFIG[ch];
                                            const status = channelReadiness[ch];
                                            const Icon = config.icon;

                                            return (
                                                <Tooltip key={ch}>
                                                    <TooltipTrigger asChild>
                                                        <div
                                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${
                                                                status.ready
                                                                    ? "border-gray-200 bg-white"
                                                                    : "border-amber-200 bg-amber-50/50"
                                                            }`}
                                                        >
                                                            <div className={`p-1 rounded-md ${config.bg}`}>
                                                                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                                                            </div>
                                                            <span className="text-sm font-medium text-gray-700 flex-1">
                                                                {config.label}
                                                            </span>
                                                            {status.ready ? (
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                                            ) : (
                                                                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                                            )}
                                                        </div>
                                                    </TooltipTrigger>
                                                    {!status.ready && status.reason && (
                                                        <TooltipContent side="bottom" className="max-w-[220px]">
                                                            <p className="text-xs">
                                                                {status.reason}
                                                            </p>
                                                            <p className="text-xs text-violet-600 mt-1">
                                                                Configure in Settings &rarr; Integrations
                                                            </p>
                                                        </TooltipContent>
                                                    )}
                                                </Tooltip>
                                            );
                                        })}
                                    </div>
                                </TooltipProvider>

                                {!anyChannelReady && (
                                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                                        No channels are configured. Please set up at least one channel in Settings before creating a task.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* ── Error ──────────────────────────────────────── */}
                        {error && (
                            <div className="px-6 pb-2 flex-shrink-0">
                                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                    {error}
                                </p>
                            </div>
                        )}

                        {/* ── Footer Buttons ─────────────────────────────── */}
                        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
                            <Button
                                variant="outline"
                                onClick={() => handleSubmit("test")}
                                disabled={!canSubmit}
                                className="flex-1"
                            >
                                {loadingAction === "test" ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <FlaskConical className="w-4 h-4" />
                                )}
                                Test on Myself
                            </Button>
                            <Button
                                onClick={() => handleSubmit("launch")}
                                disabled={!canSubmit}
                                className="flex-1"
                            >
                                {loadingAction === "launch" ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Rocket className="w-4 h-4" />
                                )}
                                Launch Task
                            </Button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
