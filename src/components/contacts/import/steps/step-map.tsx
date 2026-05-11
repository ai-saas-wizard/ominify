"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useImport } from "../import-context";
import { MappingRow } from "../mapping-row";
import { Checkbox } from "@/components/ui/checkbox";
import type { ColumnRole } from "../import-types";

const AUTO_DETECT_PATTERNS: [RegExp, ColumnRole][] = [
    [/^(phone|phone_number|phone_no|mobile|cell|cell_phone|telephone|tel)$/i, "phone"],
    [/^(email|email_address|e-mail|e_mail)$/i, "email"],
    [/^(first_name|first|fname|given_name|given)$/i, "first_name"],
    [/^(name|full_name|fullname|contact_name|contact)$/i, "first_name"],
    [/^(last_name|last|lname|surname|family_name|family)$/i, "last_name"],
    [/^(company|organization|org|business|company_name|employer)$/i, "company"],
];

function detectColumnRole(columnName: string): ColumnRole {
    const trimmed = columnName.trim();
    for (const [pattern, role] of AUTO_DETECT_PATTERNS) {
        if (pattern.test(trimmed)) return role;
    }
    return "custom_variable";
}

// Columns whose values average over this many characters are auto-skipped
// rather than imported as custom fields. Keeps payloads small and avoids
// polluting custom_fields with prose like agent bios or product descriptions.
const LONG_TEXT_AVG_THRESHOLD = 200;

function isLongTextColumn(column: string, rows: Record<string, string>[]): boolean {
    const sample = rows.slice(0, 100);
    let totalLength = 0;
    let count = 0;
    for (const row of sample) {
        const v = row[column];
        if (v) {
            totalLength += v.length;
            count++;
        }
    }
    if (count === 0) return false;
    return totalLength / count > LONG_TEXT_AVG_THRESHOLD;
}

export function StepMap() {
    const { state, dispatch } = useImport();
    const [requirementsOpen, setRequirementsOpen] = useState(true);

    // Initialize the mapping once columns are known.
    useEffect(() => {
        if (state.columns.length === 0) return;
        if (Object.keys(state.mapping).length > 0) return;
        const auto: Record<string, ColumnRole> = {};
        for (const c of state.columns) {
            const role = detectColumnRole(c);
            auto[c] =
                role === "custom_variable" && isLongTextColumn(c, state.parsedRows)
                    ? "skip"
                    : role;
        }
        dispatch({ type: "init_mapping", mapping: auto });
    }, [state.columns, state.parsedRows, state.mapping, dispatch]);

    const counts = useMemo(() => {
        let mapped = 0;
        let unmapped = 0;
        for (const c of state.columns) {
            const role = state.mapping[c] || "custom_variable";
            if (role === "skip") unmapped++;
            else mapped++;
        }
        return { mapped, unmapped, total: state.columns.length };
    }, [state.columns, state.mapping]);

    const hasPhone = Object.values(state.mapping).includes("phone");
    const hasName = Object.values(state.mapping).some(
        (r) => r === "first_name" || r === "last_name",
    );

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-base font-semibold text-gray-900">Map columns to fields</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Match each CSV column to a contact field. Custom fields can have
                    descriptions that feed AI prompt context.
                </p>
            </div>

            {/* Mapping requirements panel */}
            <div className="rounded-xl border border-gray-200 bg-white">
                <button
                    type="button"
                    onClick={() => setRequirementsOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                            Mapping requirements
                        </h3>
                        <p className="text-xs text-gray-500">
                            Make sure all required fields are mapped before continuing.
                        </p>
                    </div>
                    <motion.div animate={{ rotate: requirementsOpen ? 180 : 0 }}>
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                    </motion.div>
                </button>
                <AnimatePresence initial={false}>
                    {requirementsOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 280, damping: 28 }}
                            className="overflow-hidden"
                        >
                            <div className="space-y-3 border-t border-gray-100 px-4 py-3 text-sm">
                                <div className="flex items-start gap-2">
                                    {hasPhone ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                    )}
                                    <div>
                                        <p className="font-medium text-gray-800">
                                            Phone column required
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            A phone number is the primary contact identifier and is
                                            used for outbound voice and SMS.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    {hasName ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                    )}
                                    <div>
                                        <p className="font-medium text-gray-800">
                                            Name column required
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            To prevent cold outreach, every contact must have a name
                                            (first or last) — rows missing a name will be skipped.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Mapped columns */}
            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-gray-900">Mapped columns</h3>
                    <p className="text-xs text-gray-500">
                        {counts.mapped} of {counts.total} columns mapped
                        {counts.unmapped > 0 && ` · ${counts.unmapped} not imported`}
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <LayoutGroup>
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <th className="px-4 py-2 w-[160px]">Column in file</th>
                                    <th className="px-4 py-2">Sample values</th>
                                    <th className="px-4 py-2 w-[110px]">Status</th>
                                    <th className="px-4 py-2 w-[100px]">Object</th>
                                    <th className="px-4 py-2 w-[260px]">Field</th>
                                    <th className="px-4 py-2 w-[180px]">Update empty values</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.columns.map((col) => (
                                    <MappingRow key={col} column={col} />
                                ))}
                            </tbody>
                        </table>
                    </LayoutGroup>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                        <Checkbox
                            checked={state.dropUnmapped}
                            onCheckedChange={(v) =>
                                dispatch({ type: "set_drop_unmapped", value: !!v })
                            }
                        />
                        Don&apos;t import data in {counts.unmapped} unmapped column
                        {counts.unmapped !== 1 ? "s" : ""}
                    </label>
                </div>
            </div>
        </div>
    );
}
