"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export type ListSortKey = "newest" | "oldest" | "size_desc" | "size_asc" | "name_asc";

interface ListsFilterBarProps {
    search: string;
    onSearchChange: (v: string) => void;
    sort: ListSortKey;
    onSortChange: (v: ListSortKey) => void;
    showArchived: boolean;
    onToggleArchived: () => void;
}

export function ListsFilterBar({
    search,
    onSearchChange,
    sort,
    onSortChange,
    showArchived,
    onToggleArchived,
}: ListsFilterBarProps) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search lists..."
                    className="pl-9"
                />
            </div>
            <Select value={sort} onValueChange={(v) => onSortChange(v as ListSortKey)}>
                <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="size_desc">Largest first</SelectItem>
                    <SelectItem value="size_asc">Smallest first</SelectItem>
                    <SelectItem value="name_asc">Name A→Z</SelectItem>
                </SelectContent>
            </Select>
            <button
                type="button"
                onClick={onToggleArchived}
                className={
                    "ml-auto rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                    (showArchived
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50")
                }
            >
                {showArchived ? "Showing archived" : "Show archived"}
            </button>
        </div>
    );
}
