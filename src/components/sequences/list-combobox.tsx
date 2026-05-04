"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Layers, Check } from "lucide-react";
import { motion } from "framer-motion";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listContactLists } from "@/app/actions/contact-list-actions";
import { cn } from "@/lib/utils";

interface ContactList {
    id: string;
    name: string;
    description: string | null;
    contact_count: number;
    source_filename: string | null;
}

interface ListComboboxProps {
    clientId: string;
    selectedListId: string | null;
    onSelect: (list: ContactList | null) => void;
}

export function ListCombobox({ clientId, selectedListId, onSelect }: ListComboboxProps) {
    const [open, setOpen] = useState(false);
    const [lists, setLists] = useState<ContactList[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const r = await listContactLists(clientId);
            if (r.success) setLists((r.data || []) as ContactList[]);
            setLoading(false);
        })();
    }, [clientId]);

    const selected = lists.find((l) => l.id === selectedListId) || null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-colors",
                        "hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
                    )}
                >
                    <span className="inline-flex items-center gap-2 truncate">
                        <Layers className="h-4 w-4 text-gray-400 shrink-0" />
                        {selected ? (
                            <span className="font-medium text-gray-900 truncate">
                                {selected.name}
                            </span>
                        ) : (
                            <span className="text-gray-500">
                                {loading
                                    ? "Loading lists..."
                                    : lists.length === 0
                                      ? "No lists yet"
                                      : "Choose a list"}
                            </span>
                        )}
                    </span>
                    {selected && (
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 shrink-0">
                            {selected.contact_count.toLocaleString()}
                        </span>
                    )}
                    <ChevronDown className="ml-2 h-4 w-4 text-gray-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
            >
                <Command>
                    <CommandInput placeholder="Search lists..." />
                    <CommandList>
                        <CommandEmpty>No lists match.</CommandEmpty>
                        <CommandGroup>
                            {lists.map((l) => {
                                const isSel = l.id === selectedListId;
                                return (
                                    <CommandItem
                                        key={l.id}
                                        value={l.name}
                                        onSelect={() => {
                                            onSelect(isSel ? null : l);
                                            setOpen(false);
                                        }}
                                    >
                                        <span className="flex-1 truncate">
                                            <span className="font-medium text-gray-900">
                                                {l.name}
                                            </span>
                                            <span className="ml-2 text-xs text-gray-500">
                                                {l.contact_count.toLocaleString()} contact
                                                {l.contact_count !== 1 ? "s" : ""}
                                            </span>
                                        </span>
                                        {isSel && <Check className="h-4 w-4 text-indigo-600" />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
