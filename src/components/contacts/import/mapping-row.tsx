"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, Sparkles, Plus } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useImport } from "./import-context";
import type { ColumnRole } from "./import-types";
import { cn } from "@/lib/utils";

interface MappingRowProps {
    column: string;
}

const ROLES: { value: ColumnRole; label: string; group: "core" | "custom" | "skip" }[] = [
    { value: "phone", label: "Phone", group: "core" },
    { value: "email", label: "Email", group: "core" },
    { value: "first_name", label: "First Name", group: "core" },
    { value: "last_name", label: "Last Name", group: "core" },
    { value: "company", label: "Company / Business", group: "core" },
    { value: "custom_variable", label: "Custom Field", group: "custom" },
    { value: "skip", label: "Don't import", group: "skip" },
];

export function MappingRow({ column }: MappingRowProps) {
    const { state, dispatch } = useImport();
    const role = state.mapping[column] || "custom_variable";
    const skipEmpty = state.skipEmpty[column] !== false; // default true
    const description = state.fieldDescriptions[column]?.text || "";
    const hasDescription = description.trim().length > 0;
    const [descOpen, setDescOpen] = useState(false);

    const sample = state.parsedRows
        .slice(0, 3)
        .map((r) => r[column])
        .filter((v) => v && String(v).trim())
        .map((v) => String(v).trim())[0];

    const isMapped = role !== "skip";

    return (
        <motion.tr
            layout
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className={cn(
                "border-t border-gray-100 transition-colors",
                role === "skip" ? "bg-gray-50/40 opacity-70" : "hover:bg-gray-50",
            )}
        >
            <td className="px-4 py-3 align-top">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{column}</span>
                    {hasDescription && (
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-label="Has AI description" />
                    )}
                </div>
            </td>
            <td className="px-4 py-3 align-top">
                <span
                    className="inline-block max-w-[240px] truncate rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700"
                    title={sample}
                >
                    {sample || <span className="italic text-gray-400">—</span>}
                </span>
            </td>
            <td className="px-4 py-3 align-top">
                <AnimatePresence mode="popLayout" initial={false}>
                    {isMapped ? (
                        <motion.span
                            key="mapped"
                            initial={{ scale: 0.8, opacity: 0, rotate: -15 }}
                            animate={{ scale: 1, opacity: 1, rotate: 0 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 22 }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Mapped
                        </motion.span>
                    ) : (
                        <motion.span
                            key="unmapped"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-gray-200"
                        >
                            <AlertCircle className="h-3.5 w-3.5" />
                            Not mapped
                        </motion.span>
                    )}
                </AnimatePresence>
            </td>
            <td className="px-4 py-3 align-top">
                <span className="text-sm text-gray-700">Contact</span>
            </td>
            <td className="px-4 py-3 align-top">
                <Select
                    value={role}
                    onValueChange={(v) =>
                        dispatch({ type: "set_mapping", column, role: v as ColumnRole })
                    }
                >
                    <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                                {r.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <AnimatePresence initial={false}>
                    {role === "custom_variable" && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 280, damping: 28 }}
                            className="overflow-hidden"
                        >
                            <div className="mt-2">
                                {!descOpen && !hasDescription ? (
                                    <button
                                        type="button"
                                        onClick={() => setDescOpen(true)}
                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                                    >
                                        <Plus className="h-3 w-3" />
                                        Add AI description
                                    </button>
                                ) : (
                                    <div className="space-y-1">
                                        <Textarea
                                            value={description}
                                            onChange={(e) =>
                                                dispatch({
                                                    type: "set_field_description",
                                                    column,
                                                    text: e.target.value.slice(0, 240),
                                                })
                                            }
                                            placeholder="Describe this field so the AI understands what it means (e.g. 'preferred showing time, free text from form')"
                                            rows={2}
                                            className="text-xs"
                                        />
                                        <div className="flex items-center justify-between text-[11px] text-gray-400">
                                            <span className="inline-flex items-center gap-1">
                                                <Sparkles className="h-3 w-3" />
                                                Used by AI when crafting messages
                                            </span>
                                            <span>{description.length}/240</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </td>
            <td className="px-4 py-3 align-top">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <Checkbox
                        checked={skipEmpty}
                        onCheckedChange={(v) =>
                            dispatch({ type: "set_skip_empty", column, value: !!v })
                        }
                    />
                    Skip empty values
                </label>
            </td>
        </motion.tr>
    );
}
