"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
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
    UserCircle2,
    Zap,
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
import {
    createTaskFromDescription,
    listOutboundAgentsForClient,
} from "@/app/actions/ai-generate-sequence-actions";
import { bulkEnrollFromCSV, enrollListInSequence } from "@/app/actions/sequence-actions";
import { CSVColumnMapper } from "@/components/sequences/csv-column-mapper";
import { TaskSourcePicker } from "@/components/sequences/task-source-picker";

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
    sms: { icon: MessageSquare, label: "SMS", color: "text-gray-500", bg: "bg-gray-50" },
    email: { icon: Mail, label: "Email", color: "text-gray-500", bg: "bg-gray-50" },
    voice: { icon: Phone, label: "Voice", color: "text-gray-500", bg: "bg-gray-50" },
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
    const [taskContext, setTaskContext] = useState("");
    const [pacingPerMinute, setPacingPerMinute] = useState<string>("");
    const taskContextRef = useRef<HTMLTextAreaElement | null>(null);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvColumns, setCsvColumns] = useState<string[]>([]);
    const [csvRowCount, setCsvRowCount] = useState(0);
    const [csvSampleData, setCsvSampleData] = useState<Record<string, string>[]>([]);
    const [csvParsedData, setCsvParsedData] = useState<Record<string, string>[]>([]);
    // Saved-list source: when set, we skip the mapping phase entirely and call
    // enrollListInSequence (which replays the list's saved column_mapping
    // against each member's source_row). Mutually exclusive with csvFile.
    const [selectedListId, setSelectedListId] = useState<string | null>(null);
    const [selectedListName, setSelectedListName] = useState<string>("");
    const [selectedListCount, setSelectedListCount] = useState<number>(0);
    const [loadingAction, setLoadingAction] = useState<"launch" | "test" | null>(null);
    const [error, setError] = useState("");

    // Voice agent picker — fetched once when the dialog opens. Empty list
    // means the client hasn't deployed an outbound agent yet (we surface the
    // existing NO_OUTBOUND_AGENT error so the user gets a configure CTA).
    const [agents, setAgents] = useState<
        { id: string; name: string; vapi_id: string }[]
    >([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string>("");
    const [agentsLoading, setAgentsLoading] = useState(false);

    // Three-phase flow: "brief" (user writes task + uploads CSV) → "mapping"
    // (user maps columns) → "summary" (post-enroll counts + actions).
    const [phase, setPhase] = useState<"brief" | "mapping" | "summary">("brief");
    const [pendingMode, setPendingMode] = useState<"launch" | "test" | null>(null);
    const [enrollmentErrors, setEnrollmentErrors] = useState<string[]>([]);
    const [enrolledCount, setEnrolledCount] = useState(0);
    // Set after a successful bulk enroll so "Retry failed rows" can hit the
    // same sequence with a filtered subset of rows.
    const [lastEnrolledSequenceId, setLastEnrolledSequenceId] = useState<
        string | null
    >(null);
    const [lastMapping, setLastMapping] = useState<Record<string, string> | null>(
        null
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || !channelReadiness.voice.ready) return;
        let cancelled = false;
        setAgentsLoading(true);
        listOutboundAgentsForClient(clientId)
            .then((list) => {
                if (cancelled) return;
                setAgents(list);
                setSelectedAgentId((prev) => prev || list[0]?.id || "");
            })
            .finally(() => {
                if (!cancelled) setAgentsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, clientId, channelReadiness.voice.ready]);

    // ── CSV Parsing (simple header extraction) ──────────────────────────────

    const handleFileSelect = useCallback((file: File) => {
        if (!file.name.endsWith(".csv")) {
            setError("Please upload a CSV file.");
            return;
        }

        // Picking a CSV clears any previously-selected saved list.
        setSelectedListId(null);
        setSelectedListName("");
        setSelectedListCount(0);

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

    const handleListSelected = useCallback(
        (payload: {
            listId: string;
            listName: string;
            contactCount: number;
            sourceFilename: string | null;
            rows: Record<string, string>[];
            columns: string[];
            mapping: Record<string, string>;
        }) => {
            // Selecting a list clears any uploaded CSV. We don't populate
            // csvParsedData — the list path uses enrollListInSequence which
            // pulls members directly server-side.
            setCsvFile(null);
            setCsvColumns([]);
            setCsvRowCount(0);
            setCsvSampleData([]);
            setCsvParsedData([]);
            setSelectedListId(payload.listId);
            setSelectedListName(payload.listName);
            setSelectedListCount(payload.contactCount);
            // Surface the list's saved columns to the prompt-variable chip row
            // so the user can reference {{column_name}} in their instruction.
            setCsvColumns(payload.columns);
            setError("");
        },
        [],
    );

    const handleListCleared = useCallback(() => {
        setSelectedListId(null);
        setSelectedListName("");
        setSelectedListCount(0);
        setCsvColumns([]);
    }, []);

    // ── Submit Handlers ─────────────────────────────────────────────────────

    const resetAll = useCallback(() => {
        setInstruction("");
        setTaskContext("");
        setPacingPerMinute("");
        setCsvFile(null);
        setCsvColumns([]);
        setCsvRowCount(0);
        setCsvSampleData([]);
        setCsvParsedData([]);
        setSelectedListId(null);
        setSelectedListName("");
        setSelectedListCount(0);
        setError("");
        setPhase("brief");
        setPendingMode(null);
        setEnrollmentErrors([]);
        setEnrolledCount(0);
        setLastEnrolledSequenceId(null);
        setLastMapping(null);
        setSelectedAgentId("");
    }, []);

    const handleSummaryAction = useCallback(
        (action: "open" | "close") => {
            if (!lastEnrolledSequenceId) return;
            if (action === "open") {
                if (pendingMode === "test") onTestMode(lastEnrolledSequenceId);
                else onLaunch(lastEnrolledSequenceId);
            }
            onOpenChange(false);
            setTimeout(resetAll, 200);
        },
        [
            lastEnrolledSequenceId,
            pendingMode,
            onTestMode,
            onLaunch,
            onOpenChange,
            resetAll,
        ]
    );

    const finishTaskCreation = useCallback(
        async (mode: "launch" | "test", mapping?: Record<string, string>) => {
            setLoadingAction(mode);
            setError("");
            setEnrollmentErrors([]);

            try {
                const result = await createTaskFromDescription(
                    clientId,
                    instruction.trim(),
                    csvColumns.length > 0 ? csvColumns : undefined,
                    channelReadiness,
                    taskContext.trim() || undefined,
                    pacingPerMinute.trim() ? Math.max(1, parseInt(pacingPerMinute.trim(), 10)) : undefined,
                    selectedAgentId || undefined
                );

                if (!result.success || !result.sequenceId) {
                    setError(result.error || "Failed to create task. Please try again.");
                    setLoadingAction(null);
                    return;
                }

                const sequenceId = result.sequenceId;

                // If CSV + mapping provided, enroll contacts.
                let totalEnrolled = 0;
                if (mapping && csvParsedData.length > 0) {
                    const enrollResult = await bulkEnrollFromCSV(
                        sequenceId,
                        clientId,
                        csvParsedData,
                        mapping as any,
                        { isTest: mode === "test" }
                    );

                    if (!enrollResult.success) {
                        setError(enrollResult.error || "Failed to enroll contacts.");
                        setLoadingAction(null);
                        return;
                    }

                    const { enrolled, errors: enrollErrors } = enrollResult.data!;
                    totalEnrolled = enrolled;
                    setEnrolledCount(enrolled);
                    setEnrollmentErrors(enrollErrors || []);
                    setLastEnrolledSequenceId(sequenceId);
                    setLastMapping(mapping);

                    // Any failures — stay on the mapping screen so the operator
                    // can retry the failed subset or continue anyway.
                    if (enrollErrors && enrollErrors.length > 0) {
                        if (enrolled === 0) {
                            setError(
                                `No contacts enrolled. ${enrollErrors.length} row(s) failed.`
                            );
                        }
                        setLoadingAction(null);
                        return;
                    }
                } else if (selectedListId) {
                    // Saved-list path: skip the mapping phase entirely and let
                    // the server replay the list's stored column_mapping.
                    const enrollResult = await enrollListInSequence(
                        sequenceId,
                        selectedListId,
                        { isTest: mode === "test" },
                    );
                    if (!enrollResult.success) {
                        setError(enrollResult.error || "Failed to enroll list.");
                        setLoadingAction(null);
                        return;
                    }
                    const { enrolled, errors: enrollErrors } = enrollResult.data!;
                    totalEnrolled = enrolled;
                    setEnrolledCount(enrolled);
                    setEnrollmentErrors(enrollErrors || []);
                    setLastEnrolledSequenceId(sequenceId);
                    if (enrollErrors && enrollErrors.length > 0 && enrolled === 0) {
                        setError(
                            `No contacts enrolled. ${enrollErrors.length} row(s) failed.`,
                        );
                        setLoadingAction(null);
                        return;
                    }
                }

                setLastEnrolledSequenceId(sequenceId);
                setEnrolledCount(totalEnrolled);
                setPhase("summary");
            } catch (err) {
                setError(err instanceof Error ? err.message : "An unexpected error occurred.");
            } finally {
                setLoadingAction(null);
            }
        },
        [
            instruction,
            taskContext,
            pacingPerMinute,
            csvColumns,
            csvParsedData,
            selectedListId,
            clientId,
            channelReadiness,
            selectedAgentId,
        ]
    );

    const handleSubmit = useCallback(
        async (mode: "launch" | "test") => {
            if (!instruction.trim()) {
                setError("Please describe what you want to do.");
                return;
            }

            // CSV path: show mapping step first. List path: enroll directly.
            if (csvFile && csvColumns.length > 0 && !selectedListId) {
                setPendingMode(mode);
                setPhase("mapping");
                setError("");
                return;
            }

            try {
                await finishTaskCreation(mode);
            } catch (err) {
                setError(err instanceof Error ? err.message : "An unexpected error occurred.");
            }
        },
        [instruction, csvFile, csvColumns, selectedListId, finishTaskCreation]
    );

    const handleClose = useCallback(() => {
        if (loadingAction !== null) return;
        onOpenChange(false);
        // Reset after animation
        setTimeout(resetAll, 200);
    }, [loadingAction, onOpenChange, resetAll]);

    const handleMappingConfirm = useCallback(
        (mapping: Record<string, string>) => {
            if (!pendingMode) return;
            void finishTaskCreation(pendingMode, mapping);
        },
        [pendingMode, finishTaskCreation]
    );

    const handleMappingCancel = useCallback(() => {
        setPhase("brief");
        setPendingMode(null);
    }, []);

    // Extract 1-based row indexes from error strings of the form "Row N: ..."
    const parseFailedRowIndexes = (errs: string[]): number[] => {
        const idxs = new Set<number>();
        for (const err of errs) {
            const m = err.match(/^Row (\d+):/);
            if (m) idxs.add(parseInt(m[1], 10));
        }
        return [...idxs];
    };

    const handleRetryFailedRows = useCallback(async () => {
        if (!lastEnrolledSequenceId || !lastMapping || enrollmentErrors.length === 0) return;
        const failedIdxs = parseFailedRowIndexes(enrollmentErrors);
        if (failedIdxs.length === 0) return;

        // Rows are 1-indexed in error messages; csvParsedData is 0-indexed.
        const subset = failedIdxs
            .map((i) => csvParsedData[i - 1])
            .filter(Boolean);

        if (subset.length === 0) return;

        setLoadingAction(pendingMode || "launch");
        setError("");
        try {
            const result = await bulkEnrollFromCSV(
                lastEnrolledSequenceId,
                clientId,
                subset,
                lastMapping as any
            );
            if (!result.success) {
                setError(result.error || "Retry failed.");
            } else {
                setEnrollmentErrors(result.data?.errors || []);
            }
        } finally {
            setLoadingAction(null);
        }
    }, [lastEnrolledSequenceId, lastMapping, enrollmentErrors, csvParsedData, clientId, pendingMode]);

    // Available variables to offer as clickable chips under the taskContext
    // field. Built-ins are always shown; CSV columns (if any) append.
    const availableVariables = useMemo(() => {
        const builtins = [
            "first_name",
            "last_name",
            "company",
            "phone",
            "email",
            "currentDate",
            "tenantTimezone",
        ];
        const csvExtras = csvColumns.filter((c) => !builtins.includes(c));
        return [...builtins, ...csvExtras];
    }, [csvColumns]);

    const insertVariableIntoTaskContext = useCallback((varName: string) => {
        const token = `{{${varName}}}`;
        const el = taskContextRef.current;
        if (!el) {
            setTaskContext((prev) => `${prev}${token}`);
            return;
        }
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = el.value.slice(0, start) + token + el.value.slice(end);
        setTaskContext(next);
        // Restore cursor after the inserted token on the next tick.
        requestAnimationFrame(() => {
            if (!taskContextRef.current) return;
            const pos = start + token.length;
            taskContextRef.current.focus();
            taskContextRef.current.setSelectionRange(pos, pos);
        });
    }, []);

    const handleContinueAnyway = useCallback(() => {
        if (!lastEnrolledSequenceId) return;
        if (pendingMode === "test") {
            onTestMode(lastEnrolledSequenceId);
        } else {
            onLaunch(lastEnrolledSequenceId);
        }
        onOpenChange(false);
        resetAll();
    }, [lastEnrolledSequenceId, pendingMode, onLaunch, onTestMode, onOpenChange, resetAll]);

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
                        className={`w-full rounded-xl border border-gray-200 bg-white shadow-lg ${phase === "mapping" ? "max-w-2xl" : "max-w-lg"} flex flex-col overflow-hidden`}
                    >
                        {/* ── Header ─────────────────────────────────────── */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="rounded-md border border-gray-200 bg-gray-50 p-1.5">
                                    <Rocket className="h-4 w-4 text-gray-500" />
                                </div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {phase === "mapping"
                                        ? "Map CSV Columns"
                                        : phase === "summary"
                                          ? "Task Created"
                                          : "New Task"}
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

                        {phase === "summary" ? (
                            <div className="p-6 space-y-5">
                                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-lg">
                                    <div className="p-1.5 bg-emerald-100 rounded-md flex-shrink-0">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-emerald-900">
                                            {enrolledCount} contact{enrolledCount === 1 ? "" : "s"} enrolled
                                        </p>
                                        <p className="text-xs text-emerald-700 mt-0.5">
                                            {pendingMode === "test"
                                                ? "Test mode active — first call dispatches in ~30 seconds, ignoring pacing and quiet-hours."
                                                : pacingPerMinute.trim()
                                                  ? `Calls staggered at ${pacingPerMinute} per minute, respecting business hours.`
                                                  : "First call dispatches now, respecting business hours."}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="rounded-lg border border-gray-200 px-3 py-3">
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Queued</p>
                                        <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{enrolledCount}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-200 px-3 py-3">
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Skipped</p>
                                        <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{enrollmentErrors.length}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-200 px-3 py-3">
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Mode</p>
                                        <p className="text-lg font-semibold text-gray-900 mt-0.5">
                                            {pendingMode === "test" ? "Test" : "Live"}
                                        </p>
                                    </div>
                                </div>

                                {enrollmentErrors.length > 0 && (
                                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                                        <div className="font-medium mb-1">
                                            {enrollmentErrors.length} row{enrollmentErrors.length === 1 ? "" : "s"} skipped:
                                        </div>
                                        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                                            {enrollmentErrors.slice(0, 10).map((err, idx) => (
                                                <li key={idx}>• {err}</li>
                                            ))}
                                            {enrollmentErrors.length > 10 && (
                                                <li className="italic">…and {enrollmentErrors.length - 10} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}

                                <div className="flex items-center gap-3 pt-1">
                                    <Button
                                        variant="outline"
                                        onClick={() => handleSummaryAction("close")}
                                        className="flex-1"
                                    >
                                        Done
                                    </Button>
                                    <Button
                                        onClick={() => handleSummaryAction("open")}
                                        className="flex-1"
                                    >
                                        Open task
                                    </Button>
                                </div>
                            </div>
                        ) : phase === "mapping" ? (
                            <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
                                <p className="text-sm text-gray-500 mb-4">
                                    Tell us which column is the phone number. Everything else becomes a conversation variable the agent can reference like{" "}
                                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{`{{first_name}}`}</code>.
                                </p>
                                <CSVColumnMapper
                                    columns={csvColumns}
                                    sampleData={csvSampleData}
                                    onConfirm={handleMappingConfirm}
                                    onCancel={handleMappingCancel}
                                />
                                {loadingAction !== null && (
                                    <div className="mt-4 text-sm text-gray-500 flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Enrolling {csvRowCount} contacts…
                                    </div>
                                )}
                                {error && (
                                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        <span>{error}</span>
                                    </div>
                                )}
                                {enrollmentErrors.length > 0 && (
                                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                                        <div className="font-medium mb-1">
                                            {enrollmentErrors.length} row(s) skipped:
                                        </div>
                                        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                                            {enrollmentErrors.slice(0, 20).map((err, idx) => (
                                                <li key={idx}>• {err}</li>
                                            ))}
                                            {enrollmentErrors.length > 20 && (
                                                <li className="italic">
                                                    …and {enrollmentErrors.length - 20} more
                                                </li>
                                            )}
                                        </ul>
                                        {lastEnrolledSequenceId && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={handleRetryFailedRows}
                                                    disabled={loadingAction !== null || parseFailedRowIndexes(enrollmentErrors).length === 0}
                                                >
                                                    {loadingAction !== null ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : null}
                                                    Retry failed rows
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    onClick={handleContinueAnyway}
                                                    disabled={loadingAction !== null}
                                                >
                                                    Continue to sequence
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                        <>
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

                            {/* Special Instructions / Campaign Context */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Special instructions for this batch{" "}
                                    <span className="text-xs text-gray-400 font-normal">
                                        (optional)
                                    </span>
                                </label>
                                <Textarea
                                    ref={taskContextRef}
                                    value={taskContext}
                                    onChange={(e) => setTaskContext(e.target.value)}
                                    placeholder={'e.g. "Mention our 24-hour close offer to {{first_name}}. Only book walkthroughs Mon–Fri 1–5 PM."'}
                                    rows={3}
                                    disabled={loadingAction !== null}
                                />
                                {/* Variable chips — click to insert at cursor */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs text-gray-400">Insert variable:</span>
                                    {availableVariables.map((v) => (
                                        <button
                                            key={v}
                                            type="button"
                                            onClick={() => insertVariableIntoTaskContext(v)}
                                            disabled={loadingAction !== null}
                                            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                            title={`Insert {{${v}}} at cursor`}
                                        >
                                            {`{{${v}}}`}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-400">
                                    Injected into the agent's prompt for every call — use <code>{'{{first_name}}'}</code> etc. to personalize.
                                </p>
                            </div>

                            {/* Pacing */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">
                                    Pace{" "}
                                    <span className="text-xs text-gray-400 font-normal">
                                        (optional, applies to bulk CSV)
                                    </span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={1}
                                        max={600}
                                        inputMode="numeric"
                                        value={pacingPerMinute}
                                        onChange={(e) => setPacingPerMinute(e.target.value)}
                                        placeholder="e.g. 20"
                                        disabled={loadingAction !== null}
                                        className="w-28 rounded-md border border-gray-200 px-3 py-2 text-sm outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50"
                                    />
                                    <span className="text-sm text-gray-500">calls per minute</span>
                                </div>
                                <p className="text-xs text-gray-400">
                                    Leave blank to fire everything immediately. Set a number to spread a large batch over time (recommended: 10–30/min).
                                </p>
                            </div>

                            {/* Contact source — Upload CSV | Select List */}
                            <TaskSourcePicker
                                clientId={clientId}
                                selectedListId={selectedListId}
                                onListSelected={handleListSelected}
                                onListCleared={handleListCleared}
                                uploadSlot={
                                    !csvFile ? (
                                        <div
                                            onDrop={handleDrop}
                                            onDragOver={handleDragOver}
                                            onClick={() => fileInputRef.current?.click()}
                                            className="cursor-pointer rounded-lg border border-dashed border-gray-300 p-6 text-center transition-colors hover:border-gray-400 group"
                                        >
                                            <Upload className="w-6 h-6 text-gray-300 group-hover:text-gray-400 mx-auto mb-2 transition-colors" />
                                            <p className="text-sm text-gray-500">
                                                Drop a CSV file here or{" "}
                                                <span className="font-medium text-emerald-600">browse</span>
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
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="rounded-md bg-gray-50 p-1.5">
                                                        <FileSpreadsheet className="h-4 w-4 text-gray-500" />
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
                                                                className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-600"
                                                            >
                                                                {`{{${col}}}`}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    )
                                }
                            />
                            {selectedListId && selectedListCount > 0 && (
                                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                                    <Zap className="h-3 w-3 text-gray-400" />
                                    {selectedListCount.toLocaleString()} contact{selectedListCount !== 1 ? "s" : ""} from <strong>{selectedListName}</strong> will be enrolled when you continue.
                                </p>
                            )}

                            {/* Voice agent picker — shown when voice is ready and agents exist */}
                            {channelReadiness.voice.ready && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                        <UserCircle2 className="w-3.5 h-3.5 text-gray-400" />
                                        Voice agent
                                    </label>
                                    {agentsLoading ? (
                                        <div className="text-xs text-gray-400 flex items-center gap-1.5">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Loading agents…
                                        </div>
                                    ) : agents.length === 0 ? (
                                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                                            No outbound agents deployed yet.{" "}
                                            <a
                                                href={`/client/${clientId}/agents/new`}
                                                className="underline font-medium"
                                            >
                                                Create one →
                                            </a>
                                        </p>
                                    ) : (
                                        <select
                                            value={selectedAgentId}
                                            onChange={(e) => setSelectedAgentId(e.target.value)}
                                            disabled={loadingAction !== null}
                                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50 bg-white"
                                        >
                                            {agents.map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <p className="text-xs text-gray-400">
                                        Picks which voice agent dials enrolled contacts on this task.
                                    </p>
                                </div>
                            )}

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
                                                            <p className="text-xs text-emerald-600 mt-1">
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
                                {error.startsWith("NO_OUTBOUND_AGENT") ? (
                                    <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-amber-900 font-medium">
                                                You need an outbound agent first.
                                            </p>
                                            <p className="text-amber-800 mt-1">
                                                This task wants to place calls, but no outbound agent is configured.{" "}
                                                <a
                                                    href={`/client/${clientId}/agents/new`}
                                                    className="underline font-medium hover:text-amber-900"
                                                >
                                                    Configure outbound agent →
                                                </a>
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                        {error}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* ── Footer Buttons ─────────────────────────────── */}
                        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
                            <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
                                <Zap className="w-3 h-3 text-amber-500" />
                                <span><strong>Test now</strong> bypasses pacing &amp; quiet-hours so you can dial yourself instantly.</span>
                            </p>
                            <div className="flex items-center gap-3">
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
                                    Test now
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
                        </div>
                        </>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
