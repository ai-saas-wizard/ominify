"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import {
    Users,
    FileText,
    MoreHorizontal,
    Archive,
    Pencil,
    Play,
    RotateCcw,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    archiveContactList,
    restoreContactList,
} from "@/app/actions/contact-list-actions";
import { useRouter } from "next/navigation";

interface ContactList {
    id: string;
    name: string;
    description: string | null;
    source: string;
    source_filename: string | null;
    contact_count: number;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

interface ListCardProps {
    list: ContactList;
    clientId: string;
    onRequestRename: (list: ContactList) => void;
}

// Single list card. Clicking the card navigates to the list detail. The "..."
// menu surfaces archive/restore/rename. "Run as task" is a quick deep-link to
// the New Task dialog with this list pre-selected via ?listId=.
export function ListCard({ list, clientId, onRequestRename }: ListCardProps) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const detailHref = `/client/${clientId}/contacts/lists/${list.id}`;
    const isArchived = !!list.archived_at;

    const created = new Date(list.created_at);
    const createdLabel = created.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    const handleArchive = async () => {
        setBusy(true);
        await archiveContactList(list.id);
        setBusy(false);
        router.refresh();
    };
    const handleRestore = async () => {
        setBusy(true);
        await restoreContactList(list.id);
        setBusy(false);
        router.refresh();
    };

    return (
        <motion.div
            layout
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-indigo-200 transition-shadow"
        >
            <Link href={detailHref} className="flex-1 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{list.name}</h3>
                        {list.description && (
                            <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                                {list.description}
                            </p>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-4 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-gray-700">
                        <Users className="h-4 w-4 text-gray-400" />
                        <span className="font-medium">
                            {list.contact_count.toLocaleString()}
                        </span>
                        <span className="text-gray-500">
                            contact{list.contact_count !== 1 ? "s" : ""}
                        </span>
                    </span>
                    {list.source_filename && (
                        <span
                            className="inline-flex items-center gap-1.5 text-gray-500 truncate max-w-[160px]"
                            title={list.source_filename}
                        >
                            <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                            <span className="truncate">{list.source_filename}</span>
                        </span>
                    )}
                </div>
            </Link>

            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-5 py-2.5 text-xs text-gray-500">
                <span>Created {createdLabel}</span>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label="Open list actions"
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => router.push(detailHref)}>
                            <Users className="h-4 w-4" /> View contacts
                        </DropdownMenuItem>
                        {!isArchived && (
                            <DropdownMenuItem onSelect={() => onRequestRename(list)}>
                                <Pencil className="h-4 w-4" /> Rename
                            </DropdownMenuItem>
                        )}
                        {!isArchived && (
                            <DropdownMenuItem
                                onSelect={() =>
                                    router.push(
                                        `/client/${clientId}/sequences?newTask=1&listId=${list.id}`,
                                    )
                                }
                            >
                                <Play className="h-4 w-4" /> Run as task
                            </DropdownMenuItem>
                        )}
                        {!isArchived ? (
                            <DropdownMenuItem
                                onSelect={handleArchive}
                                className="text-red-600 focus:text-red-700 focus:bg-red-50"
                            >
                                <Archive className="h-4 w-4" /> Archive
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem onSelect={handleRestore}>
                                <RotateCcw className="h-4 w-4" /> Restore
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {busy && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm pointer-events-none" />
            )}
            {isArchived && (
                <div className="absolute right-4 top-4 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                    Archived
                </div>
            )}
        </motion.div>
    );
}
