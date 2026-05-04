"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Upload, Plus } from "lucide-react";
import { ContactsShell } from "../contacts-shell";
import { ListsGrid } from "./lists-grid";
import { ListsEmptyState } from "./lists-empty-state";
import { ListsFilterBar, type ListSortKey } from "./lists-filter-bar";
import { RenameListDialog } from "./rename-list-dialog";

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

interface ListsPageClientProps {
    clientId: string;
    initialLists: ContactList[];
}

export function ListsPageClient({ clientId, initialLists }: ListsPageClientProps) {
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<ListSortKey>("newest");
    const [showArchived, setShowArchived] = useState(false);
    const [renameTarget, setRenameTarget] = useState<ContactList | null>(null);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let arr = initialLists.filter((l) =>
            showArchived ? !!l.archived_at : !l.archived_at,
        );
        if (q) {
            arr = arr.filter(
                (l) =>
                    l.name.toLowerCase().includes(q) ||
                    (l.description || "").toLowerCase().includes(q) ||
                    (l.source_filename || "").toLowerCase().includes(q),
            );
        }
        const sorters: Record<ListSortKey, (a: ContactList, b: ContactList) => number> = {
            newest: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
            oldest: (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
            size_desc: (a, b) => b.contact_count - a.contact_count,
            size_asc: (a, b) => a.contact_count - b.contact_count,
            name_asc: (a, b) => a.name.localeCompare(b.name),
        };
        return [...arr].sort(sorters[sort]);
    }, [initialLists, search, sort, showArchived]);

    const activeListsCount = initialLists.filter((l) => !l.archived_at).length;

    return (
        <ContactsShell
            title="Lists"
            subtitle={
                <span>
                    {activeListsCount.toLocaleString()} active list
                    {activeListsCount !== 1 ? "s" : ""}
                </span>
            }
            actions={
                <Link
                    href={`/client/${clientId}/contacts/import`}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
                >
                    <Upload className="h-4 w-4" />
                    New list from CSV
                </Link>
            }
        >
            {activeListsCount === 0 && !showArchived ? (
                <ListsEmptyState clientId={clientId} />
            ) : (
                <>
                    <ListsFilterBar
                        search={search}
                        onSearchChange={setSearch}
                        sort={sort}
                        onSortChange={setSort}
                        showArchived={showArchived}
                        onToggleArchived={() => setShowArchived((s) => !s)}
                    />
                    {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
                            No {showArchived ? "archived " : ""}lists match &quot;{search}&quot;
                        </div>
                    ) : (
                        <ListsGrid
                            lists={filtered}
                            clientId={clientId}
                            onRequestRename={setRenameTarget}
                        />
                    )}
                </>
            )}

            <RenameListDialog
                list={renameTarget}
                open={!!renameTarget}
                onOpenChange={(o) => !o && setRenameTarget(null)}
            />
        </ContactsShell>
    );
}
