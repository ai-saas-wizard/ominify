"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { ImportProvider, useImport } from "./import-context";
import { ImportStepper } from "./import-stepper";
import { StepStart } from "./steps/step-start";
import { StepUpload } from "./steps/step-upload";
import { StepMap } from "./steps/step-map";
import { StepVerify } from "./steps/step-verify";
import { ImportActions } from "./import-actions";
import {
    createListFromImport,
    importContactsWithoutList,
} from "@/app/actions/contact-list-actions";
import type { ColumnRole } from "./import-types";

interface ImportWizardProps {
    clientId: string;
}

export function ImportWizard({ clientId }: ImportWizardProps) {
    return (
        <ImportProvider>
            <ImportWizardInner clientId={clientId} />
        </ImportProvider>
    );
}

function ImportWizardInner({ clientId }: ImportWizardProps) {
    const router = useRouter();
    const { state, dispatch } = useImport();
    const [result, setResult] = useState<null | {
        success: boolean;
        listId?: string;
        contactsCreated: number;
        contactsUpdated: number;
        enrolledCount?: number;
        errors: string[];
        message?: string;
    }>(null);

    const goNext = useCallback(() => {
        if (state.step >= 4) return;
        dispatch({
            type: "set_step",
            step: ((state.step + 1) as 1 | 2 | 3 | 4),
            direction: 1,
        });
    }, [state.step, dispatch]);

    const goBack = useCallback(() => {
        if (state.step <= 1) return;
        dispatch({
            type: "set_step",
            step: ((state.step - 1) as 1 | 2 | 3 | 4),
            direction: -1,
        });
    }, [state.step, dispatch]);

    const submit = useCallback(async () => {
        dispatch({ type: "set_submitting", value: true });
        dispatch({ type: "set_error", value: null });

        // Filter rows according to mapping. The dropUnmapped flag means we strip
        // unmapped columns from each row before sending so the server doesn't
        // store noise.
        const usedCols = new Set(
            Object.entries(state.mapping)
                .filter(([_, role]) => role !== "skip")
                .map(([col]) => col),
        );
        const cleanedRows: Record<string, string>[] = state.parsedRows.map((r) => {
            if (!state.dropUnmapped) return r;
            const out: Record<string, string> = {};
            for (const c of Array.from(usedCols)) out[c] = r[c] || "";
            return out;
        });

        const cleanedMapping: Record<string, ColumnRole> = {};
        for (const [col, role] of Object.entries(state.mapping)) {
            if (state.dropUnmapped && role === "skip") continue;
            cleanedMapping[col] = role;
        }

        const fieldDescriptions: Record<string, { description: string; dirty: boolean }> = {};
        for (const [col, def] of Object.entries(state.fieldDescriptions)) {
            if (def.text.trim()) {
                fieldDescriptions[col] = { description: def.text.trim(), dirty: def.dirty };
            }
        }

        try {
            if (state.createList) {
                const r = await createListFromImport({
                    clientId,
                    listName: state.listName.trim(),
                    description: state.listDescription.trim() || undefined,
                    sourceFilename: state.fileName,
                    csvRows: cleanedRows,
                    columnMapping: cleanedMapping,
                    customFieldDescriptions: fieldDescriptions,
                    tagIds: state.selectedTagIds,
                    enrollIntoSequenceId: state.enrollIntoSequenceId || undefined,
                });
                if (!r.success || !r.data) {
                    dispatch({ type: "set_error", value: r.error || "Import failed" });
                    setResult({
                        success: false,
                        contactsCreated: 0,
                        contactsUpdated: 0,
                        errors: [r.error || "Import failed"],
                    });
                } else {
                    setResult({
                        success: true,
                        listId: r.data.listId,
                        contactsCreated: r.data.contactsCreated,
                        contactsUpdated: r.data.contactsUpdated,
                        enrolledCount: r.data.enrolledCount,
                        errors: r.data.errors,
                    });
                }
            } else {
                const r = await importContactsWithoutList({
                    clientId,
                    csvRows: cleanedRows,
                    columnMapping: cleanedMapping,
                    customFieldDescriptions: fieldDescriptions,
                    tagIds: state.selectedTagIds,
                    enrollIntoSequenceId: state.enrollIntoSequenceId || undefined,
                });
                if (!r.success || !r.data) {
                    dispatch({ type: "set_error", value: r.error || "Import failed" });
                    setResult({
                        success: false,
                        contactsCreated: 0,
                        contactsUpdated: 0,
                        errors: [r.error || "Import failed"],
                    });
                } else {
                    setResult({
                        success: true,
                        contactsCreated: r.data.contactsCreated,
                        contactsUpdated: r.data.contactsUpdated,
                        enrolledCount: r.data.enrolledCount,
                        errors: r.data.errors,
                    });
                }
            }
        } catch (e: any) {
            dispatch({ type: "set_error", value: e?.message || "Import failed" });
        } finally {
            dispatch({ type: "set_submitting", value: false });
        }
    }, [clientId, dispatch, state]);

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            {/* Header */}
            <div className="border-b border-gray-200 bg-white">
                <div className="mx-auto max-w-6xl px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
                                Imports
                            </h1>
                            <p className="mt-0.5 text-sm text-gray-500">
                                Import contacts, opportunities and custom objects.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                router.push(`/client/${clientId}/contacts`)
                            }
                            className="rounded-md p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="mt-6 mb-2">
                        <ImportStepper current={state.step} />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
                <AnimatePresence mode="wait" custom={state.direction}>
                    <motion.div
                        key={state.step}
                        custom={state.direction}
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                    >
                        {state.step === 1 && <StepStart />}
                        {state.step === 2 && <StepUpload />}
                        {state.step === 3 && <StepMap />}
                        {state.step === 4 && <StepVerify clientId={clientId} />}
                    </motion.div>
                </AnimatePresence>

                {state.error && (
                    <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <p>{state.error}</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="mx-auto w-full max-w-6xl">
                <ImportActions
                    clientId={clientId}
                    onNext={goNext}
                    onBack={goBack}
                    onSubmit={submit}
                />
            </div>

            {/* Result modal */}
            {result && (
                <ImportResultModal
                    clientId={clientId}
                    result={result}
                    onClose={() => setResult(null)}
                />
            )}
        </div>
    );
}

const stepVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0 }),
};

function ImportResultModal({
    clientId,
    result,
    onClose,
}: {
    clientId: string;
    result: {
        success: boolean;
        listId?: string;
        contactsCreated: number;
        contactsUpdated: number;
        enrolledCount?: number;
        errors: string[];
    };
    onClose: () => void;
}) {
    const router = useRouter();

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex items-center gap-3">
                    {result.success ? (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        </div>
                    ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                        </div>
                    )}
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            {result.success ? "Import complete" : "Import failed"}
                        </h2>
                        {result.success && (
                            <p className="text-sm text-gray-500">
                                {result.contactsCreated.toLocaleString()} created ·{" "}
                                {result.contactsUpdated.toLocaleString()} updated
                                {typeof result.enrolledCount === "number" &&
                                    ` · ${result.enrolledCount.toLocaleString()} enrolled`}
                            </p>
                        )}
                    </div>
                </div>

                {result.errors.length > 0 && (
                    <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        <div className="mb-2 font-semibold">
                            {result.errors.length} row
                            {result.errors.length !== 1 ? "s" : ""} skipped
                        </div>
                        <ul className="space-y-1 list-disc pl-4">
                            {result.errors.slice(0, 20).map((e, i) => (
                                <li key={i}>{e}</li>
                            ))}
                            {result.errors.length > 20 && (
                                <li className="text-amber-600">
                                    ...and {result.errors.length - 20} more
                                </li>
                            )}
                        </ul>
                    </div>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                        Close
                    </button>
                    {result.success && result.listId && (
                        <button
                            onClick={() =>
                                router.push(
                                    `/client/${clientId}/contacts/lists/${result.listId}`,
                                )
                            }
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                            View list
                        </button>
                    )}
                    {result.success && !result.listId && (
                        <button
                            onClick={() =>
                                router.push(`/client/${clientId}/contacts`)
                            }
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                            View contacts
                        </button>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
