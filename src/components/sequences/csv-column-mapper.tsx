"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type ColumnRole =
    | "phone"
    | "email"
    | "first_name"
    | "last_name"
    | "company"
    | "custom_variable"
    | "skip";

interface CSVColumnMapperProps {
    columns: string[];
    sampleData: Record<string, string>[];
    onConfirm: (mapping: Record<string, string>) => void;
    onCancel: () => void;
}

const ROLE_LABELS: Record<ColumnRole, string> = {
    phone: "Phone",
    email: "Email",
    first_name: "First Name",
    last_name: "Last Name",
    company: "Company",
    custom_variable: "Custom Variable",
    skip: "Skip",
};

const ROLE_COLORS: Record<ColumnRole, string> = {
    phone: "bg-emerald-100 text-emerald-700",
    email: "bg-blue-100 text-blue-700",
    first_name: "bg-emerald-100 text-emerald-700",
    last_name: "bg-emerald-100 text-emerald-700",
    company: "bg-amber-100 text-amber-700",
    custom_variable: "bg-gray-100 text-gray-600",
    skip: "bg-gray-50 text-gray-400",
};

// Auto-detection patterns for common column names
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
        if (pattern.test(trimmed)) {
            return role;
        }
    }
    return "custom_variable";
}

export function CSVColumnMapper({
    columns,
    sampleData,
    onConfirm,
    onCancel,
}: CSVColumnMapperProps) {
    const [mapping, setMapping] = useState<Record<string, ColumnRole>>({});

    // Auto-detect on mount
    useEffect(() => {
        const autoMapping: Record<string, ColumnRole> = {};
        for (const col of columns) {
            autoMapping[col] = detectColumnRole(col);
        }
        setMapping(autoMapping);
    }, [columns]);

    const handleRoleChange = useCallback((column: string, role: ColumnRole) => {
        setMapping((prev) => ({ ...prev, [column]: role }));
    }, []);

    const hasPhoneMapping = Object.values(mapping).includes("phone");

    const handleConfirm = useCallback(() => {
        onConfirm(mapping as Record<string, string>);
    }, [mapping, onConfirm]);

    const mappedCount = Object.values(mapping).filter((r) => r !== "skip").length;
    const totalColumns = columns.length;

    return (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900">
                            Map CSV Columns
                        </h3>
                        <p className="text-sm text-gray-500">
                            {mappedCount} of {totalColumns} columns mapped
                        </p>
                    </div>
                </div>
                <button
                    onClick={onCancel}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Warning banner if no phone mapping */}
            {!hasPhoneMapping && (
                <div className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-amber-800">
                            Phone column required
                        </p>
                        <p className="text-sm text-amber-700 mt-0.5">
                            A phone number is required to create contacts and enroll them in the sequence. Please map at least one column to "Phone".
                        </p>
                    </div>
                </div>
            )}

            {/* Column mapping table */}
            <div className="p-6">
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                <th className="px-4 py-3 text-left font-medium w-[180px]">
                                    CSV Column
                                </th>
                                <th className="px-4 py-3 text-left font-medium">
                                    Sample Values
                                </th>
                                <th className="px-4 py-3 text-left font-medium w-[200px]">
                                    Map To
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {columns.map((col) => {
                                const role = mapping[col] || "custom_variable";
                                const samples = sampleData
                                    .map((row) => row[col])
                                    .filter(Boolean)
                                    .slice(0, 3);

                                return (
                                    <tr
                                        key={col}
                                        className={`transition-colors ${
                                            role === "skip"
                                                ? "bg-gray-50/50 opacity-60"
                                                : "hover:bg-gray-50"
                                        }`}
                                    >
                                        <td className="px-4 py-3">
                                            <span className="text-sm font-medium text-gray-900">
                                                {col}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {samples.length > 0 ? (
                                                    samples.map((val, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-md font-mono truncate max-w-[180px]"
                                                            title={val}
                                                        >
                                                            {val}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-xs text-gray-400 italic">
                                                        No data
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Select
                                                value={role}
                                                onValueChange={(val) =>
                                                    handleRoleChange(
                                                        col,
                                                        val as ColumnRole
                                                    )
                                                }
                                            >
                                                <SelectTrigger className="h-9 text-sm">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="phone">
                                                        Phone
                                                    </SelectItem>
                                                    <SelectItem value="email">
                                                        Email
                                                    </SelectItem>
                                                    <SelectItem value="first_name">
                                                        First Name
                                                    </SelectItem>
                                                    <SelectItem value="last_name">
                                                        Last Name
                                                    </SelectItem>
                                                    <SelectItem value="company">
                                                        Company
                                                    </SelectItem>
                                                    <SelectItem value="custom_variable">
                                                        Custom Variable
                                                    </SelectItem>
                                                    <SelectItem value="skip">
                                                        Skip
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Mapping summary */}
            <div className="px-6 pb-4">
                <div className="flex flex-wrap gap-2">
                    {Object.entries(mapping)
                        .filter(([, role]) => role !== "skip" && role !== "custom_variable")
                        .map(([col, role]) => (
                            <Badge
                                key={col}
                                className={ROLE_COLORS[role as ColumnRole]}
                            >
                                {ROLE_LABELS[role as ColumnRole]}: {col}
                            </Badge>
                        ))}
                </div>
            </div>

            {/* Live preview — what row 1 looks like after mapping */}
            {sampleData.length > 0 && hasPhoneMapping && (
                <div className="mx-6 mb-4 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                    <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Preview: Row 1
                        </span>
                        <span className="text-xs text-gray-400">
                            What the agent will know about this contact
                        </span>
                    </div>
                    <div className="p-4 space-y-1.5 text-sm">
                        {Object.entries(mapping)
                            .filter(([, role]) => role !== "skip")
                            .map(([col, role]) => {
                                const raw = sampleData[0]?.[col] || "";
                                return (
                                    <div
                                        key={col}
                                        className="flex items-start gap-3 font-mono text-xs"
                                    >
                                        <code className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap">
                                            {role === "phone" ||
                                            role === "email" ||
                                            role === "first_name" ||
                                            role === "last_name" ||
                                            role === "company"
                                                ? `{{${role}}}`
                                                : `{{${col}}}`}
                                        </code>
                                        <span className="text-gray-400">→</span>
                                        <span className="text-gray-800 break-all">
                                            {raw || (
                                                <span className="italic text-gray-400">
                                                    (empty)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                    </div>
                    <div className="px-4 py-2 border-t border-gray-200 bg-white text-xs text-gray-500">
                        Reference these in your agent prompt or special instructions — they substitute at call time.
                    </div>
                </div>
            )}

            {/* Footer actions */}
            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                    {hasPhoneMapping ? (
                        <span className="flex items-center gap-1.5 text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                            Ready to import
                        </span>
                    ) : (
                        <span className="text-amber-600">
                            Map a phone column to continue
                        </span>
                    )}
                </p>
                <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!hasPhoneMapping}
                    >
                        Confirm Mapping
                    </Button>
                </div>
            </div>
        </div>
    );
}
