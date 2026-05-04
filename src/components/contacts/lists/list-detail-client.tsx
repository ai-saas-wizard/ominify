"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Phone,
    Mail,
    Users,
    Play,
    Archive,
    RotateCcw,
    Trash2,
} from "lucide-react";
import { ContactsShell } from "../contacts-shell";
import {
    archiveContactList,
    restoreContactList,
    removeContactsFromList,
} from "@/app/actions/contact-list-actions";
import { motion, AnimatePresence } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";

interface ContactList {
    id: string;
    name: string;
    description: string | null;
    source: string;
    source_filename: string | null;
    contact_count: number;
    archived_at: string | null;
    created_at: string;
}

interface ListMember {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    custom_fields: Record<string, any> | null;
    total_calls?: number | null;
    last_call_at?: string | null;
    added_at: string;
    source_row?: Record<string, string> | null;
}

interface ListDetailClientProps {
    clientId: string;
    list: ContactList;
    members: ListMember[];
    total: number;
}

export function ListDetailClient({ clientId, list, members, total }: ListDetailClientProps) {
    const router = useRouter();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const isArchived = !!list.archived_at;

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const allSelected = members.length > 0 && selected.size === members.length;
    const toggleAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(members.map((m) => m.id)));
    };

    const handleArchive = async () => {
        setBusy(true);
        await archiveContactList(list.id);
        setBusy(false);
        router.push(`/client/${clientId}/contacts/lists`);
    };
    const handleRestore = async () => {
        setBusy(true);
        await restoreContactList(list.id);
        setBusy(false);
        router.refresh();
    };
    const handleRemove = async () => {
        if (selected.size === 0) return;
        if (!confirm(`Remove ${selected.size} contact(s) from this list?`)) return;
        setBusy(true);
        await removeContactsFromList(list.id, Array.from(selected));
        setSelected(new Set());
        setBusy(false);
        router.refresh();
    };

    return (
        <ContactsShell
            title={
                <span className="inline-flex items-center gap-2">
                    <Link
                        href={`/client/${clientId}/contacts/lists`}
                        className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    {list.name}
                    {isArchived && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                            Archived
                        </span>
                    )}
                </span>
            }
            subtitle={
                <span className="inline-flex items-center gap-3">
                    <span>
                        {total.toLocaleString()} contact{total !== 1 ? "s" : ""}
                    </span>
                    {list.source_filename && (
                        <span className="text-gray-400">· {list.source_filename}</span>
                    )}
                </span>
            }
            actions={
                <>
                    {!isArchived && (
                        <Link
                            href={`/client/${clientId}/sequences?newTask=1&listId=${list.id}`}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                        >
                            <Play className="h-4 w-4" /> Run as task
                        </Link>
                    )}
                    {isArchived ? (
                        <button
                            onClick={handleRestore}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <RotateCcw className="h-4 w-4" /> Restore
                        </button>
                    ) : (
                        <button
                            onClick={handleArchive}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <Archive className="h-4 w-4" /> Archive
                        </button>
                    )}
                </>
            }
        >
            {list.description && (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    {list.description}
                </p>
            )}

            <AnimatePresence>
                {selected.size > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm"
                    >
                        <span className="text-indigo-900">
                            {selected.size} selected
                        </span>
                        <button
                            onClick={handleRemove}
                            className="inline-flex items-center gap-1.5 rounded-md bg-white border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50"
                        >
                            <Trash2 className="h-3.5 w-3.5" /> Remove from list
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="w-10 px-4 py-3">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={toggleAll}
                                    aria-label="Select all"
                                />
                            </th>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Phone</th>
                            <th className="px-4 py-3">Email</th>
                            <th className="px-4 py-3">Calls</th>
                            <th className="px-4 py-3">Added</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {members.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                                    <Users className="mx-auto h-6 w-6 text-gray-300" />
                                    <p className="mt-2">No contacts in this list yet</p>
                                </td>
                            </tr>
                        ) : (
                            members.map((m) => (
                                <tr key={m.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <Checkbox
                                            checked={selected.has(m.id)}
                                            onCheckedChange={() => toggle(m.id)}
                                            aria-label={`Select ${m.name || m.phone}`}
                                        />
                                    </td>
                                    <td className="px-4 py-3 font-medium text-gray-900">
                                        {m.name || <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        <span className="inline-flex items-center gap-1.5">
                                            <Phone className="h-3.5 w-3.5 text-gray-400" />
                                            {m.phone}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        {m.email ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                <Mail className="h-3.5 w-3.5 text-gray-400" />
                                                {m.email}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        {m.total_calls || 0}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {new Date(m.added_at).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </ContactsShell>
    );
}
