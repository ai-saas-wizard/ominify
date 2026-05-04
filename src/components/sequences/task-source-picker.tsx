"use client";

import { ReactNode, useEffect, useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { FileSpreadsheet, Layers } from "lucide-react";
import { ListCombobox } from "./list-combobox";
import { ListPreviewCard } from "./list-preview-card";
import { getListMembers } from "@/app/actions/contact-list-actions";
import { cn } from "@/lib/utils";

type SourceTab = "upload" | "list";

interface TaskSourcePickerProps {
    clientId: string;
    /** Renders the existing CSV upload UI (drop zone + parsed preview). */
    uploadSlot: ReactNode;
    /** When a list is chosen, the parent receives the rows + columns + saved
     *  mapping so the existing enrollment path can be reused unchanged. */
    onListSelected: (payload: {
        listId: string;
        listName: string;
        contactCount: number;
        sourceFilename: string | null;
        rows: Record<string, string>[];
        columns: string[];
        mapping: Record<string, string>;
    }) => void;
    onListCleared: () => void;
    /** Lets the parent pre-select a list (e.g. via ?listId= deep link). */
    initialListId?: string | null;
    selectedListId: string | null;
}

export function TaskSourcePicker({
    clientId,
    uploadSlot,
    onListSelected,
    onListCleared,
    initialListId,
    selectedListId,
}: TaskSourcePickerProps) {
    const [tab, setTab] = useState<SourceTab>(initialListId ? "list" : "upload");
    const [previewName, setPreviewName] = useState<string>("");
    const [previewCount, setPreviewCount] = useState<number>(0);
    const [previewFilename, setPreviewFilename] = useState<string | null>(null);
    const [previewSamples, setPreviewSamples] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    // If parent provides an initialListId on mount, fetch + select.
    useEffect(() => {
        let cancelled = false;
        if (!initialListId) return;
        (async () => {
            setLoading(true);
            await loadAndSelect(initialListId, !cancelled);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialListId]);

    const loadAndSelect = async (listId: string, allow = true) => {
        const r = await getListMembers(listId, { limit: 5000 });
        if (!allow || !r.success || !r.data) return;
        // We also need the list metadata + column_mapping, fetch separately.
        const { getContactList } = await import("@/app/actions/contact-list-actions");
        const meta = await getContactList(listId);
        if (!meta.success || !meta.data) return;
        const list = meta.data as any;
        const mapping = (list.column_mapping || {}) as Record<string, string>;

        // Build rows and column list out of the saved source_row blobs.
        const rows: Record<string, string>[] = (r.data.rows || []).map((row: any) => {
            return (row.source_row || synthesizeRow(row)) as Record<string, string>;
        });
        const columns = inferColumnsFromRows(rows, mapping);

        setPreviewName(list.name);
        setPreviewCount(list.contact_count || rows.length);
        setPreviewFilename(list.source_filename);
        setPreviewSamples(
            (r.data.rows || [])
                .slice(0, 3)
                .map((row: any) => row.name)
                .filter(Boolean),
        );

        onListSelected({
            listId,
            listName: list.name,
            contactCount: list.contact_count || rows.length,
            sourceFilename: list.source_filename,
            rows,
            columns,
            mapping,
        });
    };

    const handleListPick = async (
        list: { id: string; name: string; contact_count: number; source_filename: string | null } | null,
    ) => {
        if (!list) {
            onListCleared();
            setPreviewName("");
            setPreviewCount(0);
            setPreviewFilename(null);
            setPreviewSamples([]);
            return;
        }
        setLoading(true);
        await loadAndSelect(list.id);
        setLoading(false);
    };

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                Contact source
                <span className="text-xs text-gray-400 font-normal">(optional)</span>
            </label>

            <LayoutGroup id="task-source-picker">
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
                    <SourceTabButton
                        active={tab === "upload"}
                        onClick={() => setTab("upload")}
                        icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                        label="Upload CSV"
                    />
                    <SourceTabButton
                        active={tab === "list"}
                        onClick={() => setTab("list")}
                        icon={<Layers className="h-3.5 w-3.5" />}
                        label="Select list"
                    />
                </div>
            </LayoutGroup>

            <div className="pt-1">
                {tab === "upload" ? (
                    <motion.div
                        key="upload"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                    >
                        {uploadSlot}
                    </motion.div>
                ) : (
                    <motion.div
                        key="list"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                    >
                        <ListCombobox
                            clientId={clientId}
                            selectedListId={selectedListId}
                            onSelect={handleListPick}
                        />
                        {selectedListId && previewName && (
                            <ListPreviewCard
                                name={previewName}
                                contactCount={previewCount}
                                sourceFilename={previewFilename}
                                sampleNames={previewSamples}
                            />
                        )}
                        {loading && (
                            <div className="text-xs text-gray-400">Loading list members...</div>
                        )}
                        <p className="text-xs text-gray-500">
                            Lists keep their column mapping, so we&apos;ll skip straight to enrollment when you click Continue.
                        </p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}

function SourceTabButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: ReactNode;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "text-indigo-700" : "text-gray-600 hover:text-gray-900",
            )}
        >
            {active && (
                <motion.div
                    layoutId="task-source-tab-bg"
                    className="absolute inset-0 rounded-md bg-white shadow-sm border border-gray-200"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
                {icon}
                {label}
            </span>
        </button>
    );
}

function synthesizeRow(row: { phone?: string; name?: string | null; email?: string | null; custom_fields?: any }): Record<string, string> {
    const out: Record<string, string> = {};
    if (row.phone) out.phone = row.phone;
    if (row.name) out.name = row.name;
    if (row.email) out.email = row.email;
    if (row.custom_fields) {
        for (const [k, v] of Object.entries(row.custom_fields)) {
            if (v != null) out[k] = String(v);
        }
    }
    return out;
}

function inferColumnsFromRows(
    rows: Record<string, string>[],
    mapping: Record<string, string>,
): string[] {
    const set = new Set<string>(Object.keys(mapping));
    for (const r of rows.slice(0, 50)) {
        for (const k of Object.keys(r)) set.add(k);
    }
    return Array.from(set);
}
