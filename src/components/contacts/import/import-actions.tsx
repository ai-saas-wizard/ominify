"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useImport } from "./import-context";
import type { StepKey } from "./import-types";
import { MAX_IMPORT_ROWS } from "./import-limits";
import Link from "next/link";

interface ImportActionsProps {
    clientId: string;
    onNext: () => void;
    onBack: () => void;
    onSubmit: () => void;
}

// Sticky footer bar. The label and disabled state of the primary CTA depend
// on the current step + state. The back button is hidden on step 1.
export function ImportActions({ clientId, onNext, onBack, onSubmit }: ImportActionsProps) {
    const { state } = useImport();

    const isLast = state.step === 4;
    const canAdvance = computeCanAdvance(state.step, state);

    return (
        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <div>
                {state.step > 1 ? (
                    <button
                        type="button"
                        onClick={onBack}
                        disabled={state.submitting}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                ) : (
                    <span />
                )}
            </div>
            <div className="flex items-center gap-3">
                <Link
                    href={`/client/${clientId}/contacts`}
                    className="text-sm text-gray-500 hover:text-gray-700"
                >
                    Cancel
                </Link>
                <motion.button
                    type="button"
                    whileHover={canAdvance ? { y: -1 } : undefined}
                    whileTap={canAdvance ? { scale: 0.98 } : undefined}
                    onClick={isLast ? onSubmit : onNext}
                    disabled={!canAdvance || state.submitting}
                    className={
                        "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors " +
                        (canAdvance && !state.submitting
                            ? "bg-indigo-600 hover:bg-indigo-700"
                            : "bg-gray-300 cursor-not-allowed")
                    }
                >
                    {state.submitting ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Importing...
                        </>
                    ) : isLast ? (
                        "Start import"
                    ) : (
                        <>
                            Next
                            <ArrowRight className="h-4 w-4" />
                        </>
                    )}
                </motion.button>
            </div>
        </div>
    );
}

function computeCanAdvance(step: StepKey, state: import("./import-types").ImportState): boolean {
    switch (step) {
        case 1:
            return state.objectType === "contacts";
        case 2:
            return (
                state.parsedRows.length > 0 &&
                state.parsedRows.length <= MAX_IMPORT_ROWS &&
                !!state.storagePath
            );
        case 3:
            return hasRequiredMappings(state.mapping);
        case 4:
            return (
                hasRequiredMappings(state.mapping) &&
                state.consent &&
                (!state.createList || !!state.listName.trim())
            );
        default:
            return false;
    }
}

// Mapping must include both phone (the system identifier) and a name column
// (anti-cold-outreach: a contact without a name shouldn't be messaged).
function hasRequiredMappings(
    mapping: Record<string, import("./import-types").ColumnRole>,
): boolean {
    const roles = Object.values(mapping);
    const hasPhone = roles.includes("phone");
    const hasName = roles.some((r) => r === "first_name" || r === "last_name");
    return hasPhone && hasName;
}
