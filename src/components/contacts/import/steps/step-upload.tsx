"use client";

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileText, X, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useImport } from "../import-context";
import { MAX_IMPORT_ROWS } from "../import-limits";
import {
    deleteContactImportUpload,
    getContactImportUploadUrl,
} from "@/app/actions/contact-list-actions";
import { cn } from "@/lib/utils";

// Anon-key client used solely to PUT the CSV with a server-issued upload
// token. No session/auth involved — the signed token IS the authorization.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = "contact-imports";

interface StepUploadProps {
    clientId: string;
}

export function StepUpload({ clientId }: StepUploadProps) {
    const { state, dispatch } = useImport();
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = useState(false);
    const [parsing, setParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    // Upload a parsed CSV file to Supabase Storage via a server-issued signed
    // token. Skipped when the row count exceeds the cap — gating happens here
    // and is re-enforced by the submit-step server action.
    const uploadToStorage = useCallback(
        async (file: File) => {
            dispatch({ type: "set_uploading", value: true });
            dispatch({ type: "set_upload_error", value: null });
            try {
                const r = await getContactImportUploadUrl(clientId, file.name);
                if (!r.success || !r.data) {
                    throw new Error(r.error || "Failed to get upload URL");
                }
                const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                const { error: upErr } = await sb.storage
                    .from(STORAGE_BUCKET)
                    .uploadToSignedUrl(r.data.storagePath, r.data.token, file, {
                        contentType: "text/csv",
                        upsert: false,
                    });
                if (upErr) throw new Error(upErr.message);
                dispatch({ type: "set_storage_path", value: r.data.storagePath });
            } catch (e) {
                const message = e instanceof Error ? e.message : "Upload failed";
                dispatch({ type: "set_upload_error", value: message });
            } finally {
                dispatch({ type: "set_uploading", value: false });
            }
        },
        [clientId, dispatch],
    );

    const handleFile = useCallback(
        (file: File) => {
            setParseError(null);
            if (!file.name.endsWith(".csv")) {
                setParseError("Only .csv files are supported.");
                return;
            }
            // Replacing a previously-uploaded file: drop the old object so it
            // doesn't orphan in Storage. Fire-and-forget — failure to delete
            // shouldn't block the new upload.
            const previousPath = state.storagePath;
            if (previousPath) void deleteContactImportUpload(previousPath);

            setParsing(true);
            Papa.parse<Record<string, string>>(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    setParsing(false);
                    if (results.errors.length > 0) {
                        const first = results.errors[0];
                        setParseError(`Parse error: ${first.message}`);
                        return;
                    }
                    const cols = results.meta.fields || [];
                    const rows = (results.data as Record<string, string>[]).filter((r) =>
                        Object.values(r).some((v) => (v || "").trim()),
                    );
                    dispatch({ type: "set_file", file, columns: cols, rows });
                    if (rows.length > 0 && rows.length <= MAX_IMPORT_ROWS) {
                        void uploadToStorage(file);
                    }
                },
                error: (err) => {
                    setParsing(false);
                    setParseError(err.message);
                },
            });
        },
        [dispatch, uploadToStorage, state.storagePath],
    );

    const handleClear = useCallback(() => {
        const previousPath = state.storagePath;
        if (previousPath) void deleteContactImportUpload(previousPath);
        dispatch({ type: "clear_file" });
    }, [dispatch, state.storagePath]);

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
        },
        [handleFile],
    );

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-base font-semibold text-gray-900">Upload your file</h2>
                <p className="mt-1 text-sm text-gray-500">
                    CSV files only. Headers in the first row. Up to{" "}
                    {MAX_IMPORT_ROWS.toLocaleString()} contacts per import — split larger
                    lists into multiple files.
                </p>
            </div>

            <AnimatePresence mode="wait">
                {!state.file ? (
                    <motion.div
                        key="dropzone"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={onDrop}
                            onClick={() => inputRef.current?.click()}
                            className={cn(
                                "flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white p-10 text-center transition-colors",
                                dragActive
                                    ? "border-indigo-400 bg-indigo-50/50"
                                    : "border-gray-300 hover:border-gray-400 hover:bg-gray-50",
                            )}
                        >
                            <motion.div
                                animate={{
                                    y: dragActive ? -2 : 0,
                                    scale: dragActive ? 1.05 : 1,
                                }}
                                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                                className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100"
                            >
                                <UploadCloud className="h-7 w-7 text-indigo-600" />
                            </motion.div>
                            <h3 className="mt-4 font-semibold text-gray-900">
                                {parsing ? "Parsing..." : "Drag and drop a CSV here"}
                            </h3>
                            <p className="mt-1 text-sm text-gray-500">
                                or <span className="text-indigo-600 font-medium">browse</span> to
                                choose a file
                            </p>
                            <input
                                ref={inputRef}
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleFile(f);
                                    e.target.value = "";
                                }}
                            />
                        </div>
                        {parseError && (
                            <p className="mt-2 text-sm text-red-600">{parseError}</p>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="file-preview"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                        className="rounded-xl border border-gray-200 bg-white p-5"
                    >
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                                <FileText className="h-6 w-6 text-indigo-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="truncate font-semibold text-gray-900">
                                        {state.fileName}
                                    </h3>
                                    <button
                                        onClick={handleClear}
                                        className="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                        aria-label="Remove file"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                    <span>{formatBytes(state.fileSize)}</span>
                                    <span>·</span>
                                    <span>{state.parsedRows.length.toLocaleString()} rows</span>
                                    <span>·</span>
                                    <span>{state.columns.length} columns</span>
                                </div>
                                {state.parsedRows.length > MAX_IMPORT_ROWS ? (
                                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Too many rows — limit is{" "}
                                        {MAX_IMPORT_ROWS.toLocaleString()}
                                    </div>
                                ) : state.uploading ? (
                                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Uploading...
                                    </div>
                                ) : state.uploadError ? (
                                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Upload failed: {state.uploadError}
                                    </div>
                                ) : state.storagePath ? (
                                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        File ready
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {/* First-row preview */}
                        {state.parsedRows.length > 0 && (
                            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
                                <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                                    First row preview
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-3">
                                    {state.columns.slice(0, 9).map((c) => (
                                        <div key={c} className="min-w-0">
                                            <div className="truncate font-medium text-gray-500">
                                                {c}
                                            </div>
                                            <div
                                                className="truncate text-gray-800"
                                                title={state.parsedRows[0]?.[c] || ""}
                                            >
                                                {state.parsedRows[0]?.[c] || (
                                                    <span className="italic text-gray-400">
                                                        empty
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
