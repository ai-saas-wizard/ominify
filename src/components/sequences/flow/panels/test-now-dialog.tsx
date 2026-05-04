"use client";

import { useState, useCallback, useId } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { enrollTestPhones } from "@/app/actions/sequence-actions";

interface TestNowDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sequenceId: string;
    clientId: string;
}

interface TestRow {
    id: string;
    phone: string;
    name: string;
}

const SPRING: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 };
const SPRING_FAST: Transition = { type: "spring", stiffness: 600, damping: 38, mass: 0.5 };

export function TestNowDialog({ open, onOpenChange, sequenceId, clientId }: TestNowDialogProps) {
    const reactId = useId();
    const [rows, setRows] = useState<TestRow[]>([
        { id: `${reactId}-0`, phone: "", name: "" },
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{
        enrolled: number;
        errors: string[];
    } | null>(null);

    const reset = useCallback(() => {
        setRows([{ id: `${reactId}-0`, phone: "", name: "" }]);
        setResult(null);
        setSubmitting(false);
    }, [reactId]);

    const handleClose = useCallback(() => {
        if (submitting) return;
        onOpenChange(false);
        setTimeout(reset, 200);
    }, [submitting, onOpenChange, reset]);

    const addRow = useCallback(() => {
        setRows((prev) => [
            ...prev,
            { id: `${reactId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, phone: "", name: "" },
        ]);
    }, [reactId]);

    const removeRow = useCallback((id: string) => {
        setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
    }, []);

    const updateRow = useCallback(
        (id: string, patch: Partial<TestRow>) => {
            setRows((prev) =>
                prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
            );
        },
        []
    );

    const validRows = rows.filter((r) => r.phone.trim().length >= 5);
    const canSubmit = validRows.length > 0 && !submitting;

    const handleFire = useCallback(async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setResult(null);
        try {
            const res = await enrollTestPhones(
                sequenceId,
                clientId,
                validRows.map((r) => ({
                    phone: r.phone.trim(),
                    name: r.name.trim() || undefined,
                }))
            );
            if (!res.success) {
                setResult({ enrolled: 0, errors: [res.error || "Failed to enroll"] });
            } else {
                setResult(res.data!);
            }
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, validRows, sequenceId, clientId]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    onClick={handleClose}
                >
                    <motion.div
                        layout
                        initial={{ opacity: 0, scale: 0.92, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: 8 }}
                        transition={SPRING}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
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
                                    className="p-1.5 bg-amber-100 rounded-lg"
                                >
                                    <Zap className="w-4 h-4 text-amber-600" />
                                </motion.div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    Test now
                                </h2>
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
                                <motion.div
                                    key="result"
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
                                            result.enrolled > 0
                                                ? "bg-emerald-50 border-emerald-100"
                                                : "bg-red-50 border-red-100"
                                        }`}
                                    >
                                        <div
                                            className={`p-1.5 rounded-md flex-shrink-0 ${
                                                result.enrolled > 0
                                                    ? "bg-emerald-100"
                                                    : "bg-red-100"
                                            }`}
                                        >
                                            {result.enrolled > 0 ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                            ) : (
                                                <AlertTriangle className="w-4 h-4 text-red-600" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <p
                                                className={`text-sm font-semibold ${
                                                    result.enrolled > 0
                                                        ? "text-emerald-900"
                                                        : "text-red-900"
                                                }`}
                                            >
                                                {result.enrolled > 0
                                                    ? `${result.enrolled} test enrollment${result.enrolled === 1 ? "" : "s"} fired`
                                                    : "No enrollments fired"}
                                            </p>
                                            <p
                                                className={`text-xs mt-0.5 ${
                                                    result.enrolled > 0
                                                        ? "text-emerald-700"
                                                        : "text-red-700"
                                                }`}
                                            >
                                                {result.enrolled > 0
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
                                            <p className="font-medium mb-1">
                                                {result.errors.length} skipped:
                                            </p>
                                            <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                                                {result.errors.slice(0, 6).map((err, i) => (
                                                    <li key={i}>• {err}</li>
                                                ))}
                                            </ul>
                                        </motion.div>
                                    )}

                                    <div className="flex gap-2 pt-1">
                                        <Button
                                            variant="outline"
                                            onClick={reset}
                                            className="flex-1"
                                        >
                                            Send more
                                        </Button>
                                        <Button onClick={handleClose} className="flex-1">
                                            Done
                                        </Button>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="form"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="p-5 space-y-4"
                                >
                                    <p className="text-sm text-gray-500">
                                        Drop one or more phone numbers — they enroll instantly,
                                        bypass pacing and quiet-hours, and the first call
                                        dispatches in ~30 seconds.
                                    </p>

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
                                                        className="flex items-center gap-2"
                                                    >
                                                        <div className="flex-1 relative">
                                                            <Phone className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                                                            <input
                                                                value={row.phone}
                                                                onChange={(e) =>
                                                                    updateRow(row.id, {
                                                                        phone: e.target.value,
                                                                    })
                                                                }
                                                                placeholder="+1 555 123 4567"
                                                                disabled={submitting}
                                                                autoFocus={idx === 0}
                                                                className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 disabled:opacity-50"
                                                            />
                                                        </div>
                                                        <input
                                                            value={row.name}
                                                            onChange={(e) =>
                                                                updateRow(row.id, {
                                                                    name: e.target.value,
                                                                })
                                                            }
                                                            placeholder="Name (optional)"
                                                            disabled={submitting}
                                                            className="w-32 px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 disabled:opacity-50"
                                                        />
                                                        <motion.button
                                                            whileHover={{ scale: rows.length === 1 ? 1 : 1.08 }}
                                                            whileTap={{ scale: 0.92 }}
                                                            onClick={() => removeRow(row.id)}
                                                            disabled={submitting || rows.length === 1}
                                                            aria-label="Remove row"
                                                            className="p-1.5 text-gray-300 hover:text-red-500 disabled:hover:text-gray-200 disabled:opacity-40 transition-colors"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </motion.button>
                                                    </motion.div>
                                                ))}
                                            </AnimatePresence>
                                        </div>

                                        <motion.button
                                            layout
                                            whileHover={{ x: 2 }}
                                            whileTap={{ scale: 0.97 }}
                                            transition={SPRING_FAST}
                                            onClick={addRow}
                                            disabled={submitting}
                                            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <Plus className="w-3 h-3" />
                                            Add another
                                        </motion.button>
                                    </LayoutGroup>

                                    <motion.div
                                        layout
                                        className="flex gap-2 pt-1"
                                    >
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
                                                Fire {validRows.length || ""} test{validRows.length === 1 ? "" : "s"}
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
