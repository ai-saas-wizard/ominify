"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TagPicker } from "@/components/contacts/tags/tag-picker";
import { useImport } from "../import-context";
import { getSequences } from "@/app/actions/sequence-actions";

interface StepVerifyProps {
    clientId: string;
}

export function StepVerify({ clientId }: StepVerifyProps) {
    const { state, dispatch } = useImport();
    const [sequences, setSequences] = useState<Array<{ id: string; name: string }>>([]);

    useEffect(() => {
        (async () => {
            const r = await getSequences(clientId);
            if (r.success) setSequences((r.data || []).map((s: any) => ({ id: s.id, name: s.name })));
        })();
    }, [clientId]);

    const mappedCount = Object.values(state.mapping).filter((r) => r !== "skip").length;
    const hasPhone = Object.values(state.mapping).includes("phone");
    const hasName = Object.values(state.mapping).some(
        (r) => r === "first_name" || r === "last_name",
    );
    const customFieldCount = Object.values(state.mapping).filter((r) => r === "custom_variable").length;
    const documentedCount = Object.values(state.fieldDescriptions).filter((d) => d.text.trim()).length;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-base font-semibold text-gray-900">Review and confirm</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Set preferences, then start the import.
                </p>
            </div>

            {/* Preferences */}
            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-gray-900">Preferences</h3>
                    <p className="text-xs text-gray-500">
                        Configure how these contacts are organized after import.
                    </p>
                </div>
                <div className="space-y-1 divide-y divide-gray-100">
                    {/* Create list */}
                    <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <label className="flex items-center gap-3">
                                    <Switch
                                        checked={state.createList}
                                        onCheckedChange={(v) =>
                                            dispatch({ type: "set_create_list", value: !!v })
                                        }
                                    />
                                    <span className="text-sm font-medium text-gray-900">
                                        Create a list for these contacts
                                    </span>
                                </label>
                                <p className="ml-12 mt-1 text-xs text-gray-500">
                                    Saves them as a reusable segment you can run as a sequence later
                                    without re-uploading.
                                </p>
                            </div>
                            <AnimatePresence>
                                {state.createList && (
                                    <motion.div
                                        initial={{ opacity: 0, x: 8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 8 }}
                                        className="w-64 shrink-0"
                                    >
                                        <Input
                                            value={state.listName}
                                            onChange={(e) =>
                                                dispatch({
                                                    type: "set_list_name",
                                                    value: e.target.value,
                                                })
                                            }
                                            placeholder="My import list"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="px-5 py-4">
                        <label className="flex items-center gap-3">
                            <Switch
                                checked={state.selectedTagIds.length > 0}
                                onCheckedChange={(v) =>
                                    !v && dispatch({ type: "set_tag_ids", value: [] })
                                }
                            />
                            <span className="text-sm font-medium text-gray-900">
                                Add tags to imported contacts
                            </span>
                        </label>
                        <div className="ml-12 mt-2">
                            <TagPicker
                                clientId={clientId}
                                selected={state.selectedTagIds}
                                onChange={(ids) => dispatch({ type: "set_tag_ids", value: ids })}
                                placeholder="Pick tags or create one"
                            />
                        </div>
                    </div>

                    {/* Auto-enroll */}
                    <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <label className="flex items-center gap-3">
                                    <Switch
                                        checked={!!state.enrollIntoSequenceId}
                                        onCheckedChange={(v) => {
                                            if (!v)
                                                dispatch({
                                                    type: "set_enroll_sequence",
                                                    value: null,
                                                });
                                        }}
                                    />
                                    <span className="text-sm font-medium text-gray-900">
                                        Auto-enroll into a sequence
                                    </span>
                                </label>
                                <p className="ml-12 mt-1 text-xs text-gray-500">
                                    Start calling/messaging these contacts as soon as the import
                                    finishes.
                                </p>
                            </div>
                            <div className="w-64 shrink-0">
                                <Select
                                    value={state.enrollIntoSequenceId || ""}
                                    onValueChange={(v) =>
                                        dispatch({
                                            type: "set_enroll_sequence",
                                            value: v || null,
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choose sequence..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {sequences.length === 0 ? (
                                            <div className="px-3 py-2 text-xs text-gray-500">
                                                No sequences yet
                                            </div>
                                        ) : (
                                            sequences.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    {s.name}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Review summary */}
            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-gray-900">Review import</h3>
                </div>

                {/* File pill */}
                <div className="px-5 py-4">
                    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                        <FileText className="h-5 w-5 text-gray-400" />
                        <div>
                            <div className="text-sm font-medium text-gray-900">
                                {state.fileName}
                            </div>
                            <div className="text-xs text-gray-500">
                                {state.parsedRows.length.toLocaleString()} rows ·{" "}
                                {state.columns.length} columns · uploaded
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mapping summary */}
                <div className="border-t border-gray-100">
                    <div className="overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <th className="px-5 py-2">Column in file</th>
                                    <th className="px-5 py-2">Sample values</th>
                                    <th className="px-5 py-2">Status</th>
                                    <th className="px-5 py-2">Object</th>
                                    <th className="px-5 py-2">Field</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {state.columns.map((col) => {
                                    const role = state.mapping[col] || "custom_variable";
                                    const sample = state.parsedRows
                                        .slice(0, 3)
                                        .map((r) => r[col])
                                        .filter(Boolean)[0];
                                    return (
                                        <tr key={col}>
                                            <td className="px-5 py-2.5 font-medium text-gray-900">
                                                {col}
                                            </td>
                                            <td className="px-5 py-2.5 text-gray-700">
                                                <span
                                                    className="block max-w-[200px] truncate font-mono text-xs"
                                                    title={sample}
                                                >
                                                    {sample || "—"}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2.5">
                                                {role === "skip" ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                                                        Not imported
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        Mapped
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-5 py-2.5 text-gray-700">Contact</td>
                                            <td className="px-5 py-2.5 text-gray-900">
                                                {prettyRole(role)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Stat strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Total rows" value={state.parsedRows.length.toLocaleString()} />
                <Stat label="Mapped columns" value={`${mappedCount} / ${state.columns.length}`} />
                <Stat
                    label="Custom fields"
                    value={`${customFieldCount}`}
                    sublabel={`${documentedCount} documented`}
                />
                <Stat
                    label="Phone column"
                    value={hasPhone ? "Yes" : "Missing"}
                    accent={hasPhone ? "good" : "warn"}
                />
                <Stat
                    label="Name column"
                    value={hasName ? "Yes" : "Missing"}
                    accent={hasName ? "good" : "warn"}
                />
            </div>

            {(!hasPhone || !hasName) && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-amber-800">
                        Go back to the Map step and set both a Phone and a Name column before
                        importing.
                    </p>
                </div>
            )}

            {/* Consent */}
            <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 cursor-pointer">
                <Checkbox
                    checked={state.consent}
                    onCheckedChange={(v) => dispatch({ type: "set_consent", value: !!v })}
                />
                <span className="text-sm text-gray-700">
                    I confirm all contacts in this import have consented to hear from us. I&apos;ve
                    previously contacted them within the last past year, and this list is not from
                    a third party.
                </span>
            </label>
        </div>
    );
}

function prettyRole(role: string): string {
    switch (role) {
        case "phone":
            return "Phone";
        case "email":
            return "Email";
        case "first_name":
            return "First Name";
        case "last_name":
            return "Last Name";
        case "company":
            return "Company";
        case "custom_variable":
            return "Custom Field";
        default:
            return "—";
    }
}

interface StatProps {
    label: string;
    value: string;
    sublabel?: string;
    accent?: "good" | "warn";
}

function Stat({ label, value, sublabel, accent }: StatProps) {
    return (
        <div
            className={
                "rounded-xl border bg-white px-4 py-3 " +
                (accent === "warn"
                    ? "border-amber-200"
                    : accent === "good"
                      ? "border-emerald-200"
                      : "border-gray-200")
            }
        >
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {label}
            </div>
            <div
                className={
                    "mt-1 text-lg font-semibold " +
                    (accent === "warn"
                        ? "text-amber-700"
                        : accent === "good"
                          ? "text-emerald-700"
                          : "text-gray-900")
                }
            >
                {value}
            </div>
            {sublabel && (
                <div className="mt-0.5 text-xs text-gray-500">{sublabel}</div>
            )}
        </div>
    );
}
