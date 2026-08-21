"use client";

import { useState, useCallback, useId, useMemo, useEffect } from "react";
import {
    motion,
    AnimatePresence,
    LayoutGroup,
    type Transition,
} from "framer-motion";
import {
    Zap,
    X,
    Plus,
    Phone,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    Trash2,
    UserCheck,
    Search,
    Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    enrollTestPhones,
    convertEnrollmentsToTest,
    getSequenceTestPreflight,
} from "@/app/actions/sequence-actions";
import type { TestPreflight } from "@/lib/sequences/test-run-types";
import { TestPreflightPanel } from "./test-preflight";
import { TestRunPanel } from "./test-run-panel";

interface EnrollmentRow {
    id: string;
    status: string;
    is_test: boolean;
    contacts?: {
        id: string;
        name?: string | null;
        phone?: string | null;
        email?: string | null;
    } | null;
}

interface TestNowDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sequenceId: string;
    clientId: string;
    enrollments: EnrollmentRow[];
}

interface TestRow {
    id: string;
    phone: string;
    name: string;
    /** Optional — without it, email steps are silently skipped at dispatch. */
    email: string;
}

type Mode = "existing" | "manual";

const SPRING: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 };
const SPRING_FAST: Transition = { type: "spring", stiffness: 600, damping: 38, mass: 0.5 };

export function TestNowDialog({
    open,
    onOpenChange,
    sequenceId,
    clientId,
    enrollments,
}: TestNowDialogProps) {
    const reactId = useId();

    // Eligible existing enrollments — only active/paused ones can be flipped
    // to test in place, and ONLY ones that are already test enrollments.
    // is_test is permanent and strips every safety gate for that lead
    // (business hours, TCPA, calling window/days, daily cap, fatigue guard,
    // the dial-time gate) while compressing delays to 30s. Listing real leads
    // here — previously sorted live-first, so they appeared at the top — put a
    // "call this stranger repeatedly at any hour" button one click away. The
    // server refuses them too (convertEnrollmentsToTest); this keeps the UI
    // honest about what can be selected.
    const eligibleEnrollments = useMemo(
        () =>
            enrollments
                .filter((e) => ["active", "paused"].includes(e.status) && e.is_test)
                .sort((a, b) =>
                    (a.contacts?.name || "").localeCompare(b.contacts?.name || "")
                ),
        [enrollments]
    );

    const [mode, setMode] = useState<Mode>(
        eligibleEnrollments.length > 0 ? "existing" : "manual"
    );
    const [search, setSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [rows, setRows] = useState<TestRow[]>([
        { id: `${reactId}-0`, phone: "", name: "", email: "" },
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{
        fired: number;
        errors: string[];
        /** Enrollments to poll in the post-flight panel. */
        enrollmentIds: string[];
    } | null>(null);
    const [preflight, setPreflight] = useState<TestPreflight | null>(null);
    const [preflightLoading, setPreflightLoading] = useState(false);

    const reset = useCallback(() => {
        setMode(eligibleEnrollments.length > 0 ? "existing" : "manual");
        setSearch("");
        setSelectedIds(new Set());
        setRows([{ id: `${reactId}-0`, phone: "", name: "", email: "" }]);
        setResult(null);
        setSubmitting(false);
    }, [reactId, eligibleEnrollments.length]);

    const handleClose = useCallback(() => {
        if (submitting) return;
        onOpenChange(false);
        setTimeout(reset, 200);
    }, [submitting, onOpenChange, reset]);

    // Pre-flight: what will actually happen if they fire. Fetched on open so a
    // dead channel (no Twilio, no minutes, no verified email) is visible BEFORE
    // they wait 90s for nothing to arrive.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setPreflightLoading(true);
        getSequenceTestPreflight(sequenceId, clientId)
            .then((res) => {
                if (cancelled) return;
                setPreflight(res.success && res.data ? res.data : null);
            })
            .catch(() => {
                if (!cancelled) setPreflight(null);
            })
            .finally(() => {
                if (!cancelled) setPreflightLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, sequenceId, clientId]);

    // ── Manual mode helpers ────────────────────────────────────────────────
    const addRow = useCallback(() => {
        setRows((prev) => [
            ...prev,
            {
                id: `${reactId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                phone: "",
                name: "",
                email: "",
            },
        ]);
    }, [reactId]);

    const removeRow = useCallback((id: string) => {
        setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
    }, []);

    const updateRow = useCallback((id: string, patch: Partial<TestRow>) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    }, []);

    // ── Existing mode helpers ──────────────────────────────────────────────
    const toggleSelected = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const filteredEnrollments = useMemo(() => {
        if (!search.trim()) return eligibleEnrollments;
        const q = search.trim().toLowerCase();
        return eligibleEnrollments.filter((e) => {
            const name = (e.contacts?.name || "").toLowerCase();
            const phone = (e.contacts?.phone || "").toLowerCase();
            const email = (e.contacts?.email || "").toLowerCase();
            return name.includes(q) || phone.includes(q) || email.includes(q);
        });
    }, [search, eligibleEnrollments]);

    // ── Submit ─────────────────────────────────────────────────────────────
    const validRows = rows.filter((r) => r.phone.trim().length >= 5);
    const canSubmit = !submitting && (
        mode === "manual" ? validRows.length > 0 : selectedIds.size > 0
    );
    const submitCount = mode === "manual" ? validRows.length : selectedIds.size;

    const handleFire = useCallback(async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setResult(null);
        try {
            if (mode === "manual") {
                const res = await enrollTestPhones(
                    sequenceId,
                    clientId,
                    validRows.map((r) => ({
                        phone: r.phone.trim(),
                        name: r.name.trim() || undefined,
                        email: r.email.trim() || undefined,
                    }))
                );
                if (!res.success) {
                    setResult({
                        fired: 0,
                        errors: [res.error || "Failed to enroll"],
                        enrollmentIds: [],
                    });
                } else {
                    setResult({
                        fired: res.data!.enrolled,
                        errors: res.data!.errors,
                        enrollmentIds: res.data!.enrollments.map((e) => e.enrollmentId),
                    });
                }
            } else {
                const res = await convertEnrollmentsToTest(
                    Array.from(selectedIds),
                    clientId
                );
                if (!res.success) {
                    setResult({
                        fired: 0,
                        errors: [res.error || "Failed to convert"],
                        enrollmentIds: [],
                    });
                } else {
                    setResult({
                        fired: res.data!.converted,
                        errors: res.data!.skipped.map(
                            (s) => `enrollment ${s.id.slice(0, 8)}…: ${s.reason}`
                        ),
                        enrollmentIds: res.data!.enrollmentIds,
                    });
                }
            }
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, mode, validRows, selectedIds, sequenceId, clientId]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={handleClose}
                >
                    <motion.div
                        layout
                        initial={{ opacity: 0, scale: 0.92, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: 8 }}
                        transition={SPRING}
                        onClick={(e) => e.stopPropagation()}
                        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
                    >
                        {/* Header */}
                        <motion.div
                            layout="position"
                            className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
                        >
                            <div className="flex items-center gap-2.5">
                                <motion.div
                                    initial={{ rotate: -12, scale: 0.8 }}
                                    animate={{ rotate: 0, scale: 1 }}
                                    transition={{ ...SPRING_FAST, delay: 0.05 }}
                                    className="rounded-md border border-amber-200 bg-amber-50 p-1.5"
                                >
                                    <Zap className="w-4 h-4 text-amber-600" />
                                </motion.div>
                                <h2 className="text-lg font-semibold text-gray-900">Test now</h2>
                            </div>
                            <button
                                onClick={handleClose}
                                disabled={submitting}
                                className="text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </motion.div>

                        {/* Body */}
                        <AnimatePresence mode="popLayout" initial={false}>
                            {result ? (
                                <ResultView
                                    key="result"
                                    result={result}
                                    mode={mode}
                                    clientId={clientId}
                                    onReset={reset}
                                    onClose={handleClose}
                                />
                            ) : (
                                <motion.div
                                    key="form"
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="p-5 space-y-4"
                                >
                                    {/* Mode switcher (only when there are selectable enrollments) */}
                                    {eligibleEnrollments.length > 0 && (
                                        <ModeSwitcher
                                            mode={mode}
                                            onChange={(m) => {
                                                setMode(m);
                                                setSelectedIds(new Set());
                                            }}
                                            existingCount={eligibleEnrollments.length}
                                        />
                                    )}

                                    <p className="text-sm text-gray-500">
                                        {mode === "existing"
                                            ? "Pick contacts already enrolled in this sequence — they'll flip to test mode and dispatch in ~30s, bypassing pacing and quiet-hours."
                                            : "Drop one or more phone numbers — they enroll instantly, bypass pacing and quiet-hours, and the first call dispatches in ~30 seconds."}
                                    </p>

                                    <TestPreflightPanel
                                        preflight={preflight}
                                        loading={preflightLoading}
                                        missingEmailWarning={
                                            mode === "manual" &&
                                            !rows.some((r) => r.email.trim())
                                        }
                                    />

                                    <AnimatePresence mode="popLayout" initial={false}>
                                        {mode === "existing" ? (
                                            <ExistingMode
                                                key="existing"
                                                rows={filteredEnrollments}
                                                selectedIds={selectedIds}
                                                onToggle={toggleSelected}
                                                search={search}
                                                onSearchChange={setSearch}
                                                disabled={submitting}
                                            />
                                        ) : (
                                            <ManualMode
                                                key="manual"
                                                rows={rows}
                                                onAdd={addRow}
                                                onRemove={removeRow}
                                                onUpdate={updateRow}
                                                disabled={submitting}
                                            />
                                        )}
                                    </AnimatePresence>

                                    <motion.div layout className="flex gap-2 pt-1">
                                        <Button
                                            variant="outline"
                                            onClick={handleClose}
                                            disabled={submitting}
                                            className="flex-1"
                                        >
                                            Cancel
                                        </Button>
                                        <motion.div
                                            whileHover={canSubmit ? { scale: 1.02 } : undefined}
                                            whileTap={canSubmit ? { scale: 0.98 } : undefined}
                                            transition={SPRING_FAST}
                                            className="flex-1"
                                        >
                                            <Button
                                                onClick={handleFire}
                                                disabled={!canSubmit}
                                                className="w-full"
                                            >
                                                {submitting ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Zap className="w-4 h-4" />
                                                )}
                                                Fire {submitCount || ""} test{submitCount === 1 ? "" : "s"}
                                            </Button>
                                        </motion.div>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ── Mode Switcher ──────────────────────────────────────────────────────────

function ModeSwitcher({
    mode,
    onChange,
    existingCount,
}: {
    mode: Mode;
    onChange: (m: Mode) => void;
    existingCount: number;
}) {
    return (
        <LayoutGroup id="test-mode-switcher">
            <div className="relative inline-flex bg-gray-100 rounded-lg p-1 text-xs font-medium w-full">
                {(["existing", "manual"] as const).map((m) => {
                    const active = mode === m;
                    return (
                        <button
                            key={m}
                            type="button"
                            onClick={() => onChange(m)}
                            className={`relative flex-1 px-3 py-1.5 rounded-md transition-colors ${
                                active ? "text-gray-900" : "text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {active && (
                                <motion.span
                                    layoutId="mode-pill"
                                    className="absolute inset-0 bg-white shadow-sm rounded-md"
                                    transition={SPRING_FAST}
                                />
                            )}
                            <span className="relative">
                                {m === "existing"
                                    ? `From sequence (${existingCount})`
                                    : "Manual entry"}
                            </span>
                        </button>
                    );
                })}
            </div>
        </LayoutGroup>
    );
}

// ── Existing Mode ──────────────────────────────────────────────────────────

function ExistingMode({
    rows,
    selectedIds,
    onToggle,
    search,
    onSearchChange,
    disabled,
}: {
    rows: EnrollmentRow[];
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    search: string;
    onSearchChange: (s: string) => void;
    disabled: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={SPRING_FAST}
            className="space-y-2"
        >
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search by name, phone, or email…"
                    disabled={disabled}
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-gray-200 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50"
                />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                {rows.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-6 text-center">
                        No matching enrollments.
                    </p>
                ) : (
                    <LayoutGroup>
                        <ul className="divide-y divide-gray-100">
                            <AnimatePresence mode="popLayout" initial={false}>
                                {rows.map((row) => {
                                    const selected = selectedIds.has(row.id);
                                    const name = row.contacts?.name || "(unnamed)";
                                    const phone = row.contacts?.phone || "—";
                                    return (
                                        <motion.li
                                            key={row.id}
                                            layout
                                            initial={{ opacity: 0, y: -4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0 }}
                                            transition={SPRING_FAST}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onToggle(row.id)}
                                                disabled={disabled}
                                                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                                                    selected
                                                        ? "bg-emerald-50/60 hover:bg-emerald-50"
                                                        : "hover:bg-gray-50"
                                                } disabled:opacity-50`}
                                            >
                                                <span
                                                    className={`flex items-center justify-center w-4 h-4 rounded border transition-colors flex-shrink-0 ${
                                                        selected
                                                            ? "bg-emerald-600 border-emerald-600"
                                                            : "border-gray-300 bg-white"
                                                    }`}
                                                >
                                                    <AnimatePresence>
                                                        {selected && (
                                                            <motion.span
                                                                key="check"
                                                                initial={{ scale: 0 }}
                                                                animate={{ scale: 1 }}
                                                                exit={{ scale: 0 }}
                                                                transition={SPRING_FAST}
                                                            >
                                                                <CheckCircle2 className="w-3 h-3 text-white" />
                                                            </motion.span>
                                                        )}
                                                    </AnimatePresence>
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                        {name}
                                                    </p>
                                                    <p className="text-xs text-gray-500 truncate">
                                                        {phone}
                                                    </p>
                                                </div>
                                                {row.is_test && (
                                                    <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-xs uppercase text-amber-700">
                                                        test
                                                    </span>
                                                )}
                                            </button>
                                        </motion.li>
                                    );
                                })}
                            </AnimatePresence>
                        </ul>
                    </LayoutGroup>
                )}
            </div>
        </motion.div>
    );
}

// ── Manual Mode ────────────────────────────────────────────────────────────

function ManualMode({
    rows,
    onAdd,
    onRemove,
    onUpdate,
    disabled,
}: {
    rows: TestRow[];
    onAdd: () => void;
    onRemove: (id: string) => void;
    onUpdate: (id: string, patch: Partial<TestRow>) => void;
    disabled: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={SPRING_FAST}
        >
            <LayoutGroup>
                <div className="space-y-2">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {rows.map((row, idx) => (
                            <motion.div
                                key={row.id}
                                layout
                                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.94, x: 20 }}
                                transition={SPRING_FAST}
                                className="space-y-1.5"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 relative">
                                        <Phone className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                                        <input
                                            value={row.phone}
                                            onChange={(e) =>
                                                onUpdate(row.id, { phone: e.target.value })
                                            }
                                            placeholder="+1 555 123 4567"
                                            disabled={disabled}
                                            autoFocus={idx === 0}
                                            className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-gray-200 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50"
                                        />
                                    </div>
                                    <input
                                        value={row.name}
                                        onChange={(e) =>
                                            onUpdate(row.id, { name: e.target.value })
                                        }
                                        placeholder="Name (optional)"
                                        disabled={disabled}
                                        className="w-32 px-3 py-2 text-sm rounded-md border border-gray-200 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50"
                                    />
                                    <motion.button
                                        whileHover={{ scale: rows.length === 1 ? 1 : 1.08 }}
                                        whileTap={{ scale: 0.92 }}
                                        onClick={() => onRemove(row.id)}
                                        disabled={disabled || rows.length === 1}
                                        aria-label="Remove row"
                                        className="p-1.5 text-gray-300 hover:text-red-500 disabled:hover:text-gray-200 disabled:opacity-40 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </motion.button>
                                </div>
                                {/* Email steps are skipped at dispatch when the
                                    contact has no email — and nothing is logged. */}
                                <div className="relative pr-8">
                                    <Mail className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                                    <input
                                        type="email"
                                        value={row.email}
                                        onChange={(e) =>
                                            onUpdate(row.id, { email: e.target.value })
                                        }
                                        placeholder="Email (optional — needed for email steps)"
                                        disabled={disabled}
                                        className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-gray-200 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-50"
                                    />
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                <motion.button
                    layout
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.97 }}
                    transition={SPRING_FAST}
                    onClick={onAdd}
                    disabled={disabled}
                    className="mt-2 text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50"
                >
                    <Plus className="w-3 h-3" />
                    Add another
                </motion.button>
            </LayoutGroup>
        </motion.div>
    );
}

// ── Result View ────────────────────────────────────────────────────────────

function ResultView({
    result,
    mode,
    clientId,
    onReset,
    onClose,
}: {
    result: { fired: number; errors: string[]; enrollmentIds: string[] };
    mode: Mode;
    clientId: string;
    onReset: () => void;
    onClose: () => void;
}) {
    const success = result.fired > 0;
    const verb = mode === "manual" ? "enrolled" : "flipped to test";
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={SPRING}
            className="p-5 space-y-4"
        >
            <motion.div
                layout
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={SPRING_FAST}
                className={`flex items-start gap-3 p-4 rounded-xl border ${
                    success ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"
                }`}
            >
                <div
                    className={`p-1.5 rounded-md flex-shrink-0 ${
                        success ? "bg-emerald-100" : "bg-red-100"
                    }`}
                >
                    {success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                </div>
                <div className="flex-1">
                    <p
                        className={`text-sm font-semibold ${
                            success ? "text-emerald-900" : "text-red-900"
                        }`}
                    >
                        {success
                            ? `${result.fired} contact${result.fired === 1 ? "" : "s"} ${verb}`
                            : "Nothing fired"}
                    </p>
                    <p
                        className={`text-xs mt-0.5 ${
                            success ? "text-emerald-700" : "text-red-700"
                        }`}
                    >
                        {success
                            ? "First call dispatches in ~30s, ignoring pacing and quiet-hours."
                            : "Check the errors below and try again."}
                    </p>
                </div>
            </motion.div>

            {result.errors.length > 0 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900"
                >
                    <p className="font-medium mb-1">{result.errors.length} skipped:</p>
                    <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                        {result.errors.slice(0, 6).map((err, i) => (
                            <li key={i}>• {err}</li>
                        ))}
                    </ul>
                </motion.div>
            )}

            {/* What the sequencer ACTUALLY did — polls the execution log so a
                silent failure (no Twilio config, no minutes, no VAPI slot) is
                visible instead of the dialog just saying "enrolled". */}
            {result.enrollmentIds.length > 0 && (
                <TestRunPanel
                    enrollmentIds={result.enrollmentIds}
                    clientId={clientId}
                />
            )}

            <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={onReset} className="flex-1">
                    Send more
                </Button>
                <Button onClick={onClose} className="flex-1">
                    Done
                </Button>
            </div>
        </motion.div>
    );
}

// Wraps a non-motion component so it can participate in AnimatePresence.
ResultView.displayName = "ResultView";
