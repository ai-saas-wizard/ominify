"use client";

import { useState, useEffect } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagPill } from "./tag-pill";
import {
    listContactTags,
    createContactTag,
} from "@/app/actions/contact-tag-actions";
import { cn } from "@/lib/utils";

interface Tag {
    id: string;
    name: string;
    color: string | null;
}

interface TagPickerProps {
    clientId: string;
    selected: string[];
    onChange: (tagIds: string[]) => void;
    placeholder?: string;
}

const PRESET_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

// Combobox tag picker with create-on-the-fly. Loads tags lazily on first open
// to avoid blocking initial render. Selected tags are displayed as pills above
// the trigger.
export function TagPicker({ clientId, selected, onChange, placeholder = "Select tags" }: TagPickerProps) {
    const [open, setOpen] = useState(false);
    const [tags, setTags] = useState<Tag[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [search, setSearch] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (open && !loaded) {
            (async () => {
                const r = await listContactTags(clientId);
                if (r.success) setTags(r.data || []);
                setLoaded(true);
            })();
        }
    }, [open, loaded, clientId]);

    const selectedTags = tags.filter((t) => selected.includes(t.id));
    const filtered = tags.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()),
    );
    const exactMatch = filtered.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

    const handleToggle = (tagId: string) => {
        if (selected.includes(tagId)) {
            onChange(selected.filter((id) => id !== tagId));
        } else {
            onChange([...selected, tagId]);
        }
    };

    const handleCreate = async () => {
        const name = search.trim();
        if (!name || creating) return;
        setCreating(true);
        const color = PRESET_COLORS[tags.length % PRESET_COLORS.length];
        const r = await createContactTag(clientId, name, color);
        if (r.success && r.data) {
            const newTag = r.data as Tag;
            setTags((prev) => [...prev, newTag]);
            onChange([...selected, newTag.id]);
            setSearch("");
        }
        setCreating(false);
    };

    return (
        <div className="space-y-2">
            <AnimatePresence mode="popLayout">
                {selectedTags.length > 0 && (
                    <motion.div
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-1.5 overflow-hidden"
                    >
                        {selectedTags.map((tag) => (
                            <TagPill
                                key={tag.id}
                                tag={tag}
                                onRemove={() => handleToggle(tag.id)}
                            />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            "flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700",
                            "hover:bg-gray-50 transition-colors",
                            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
                        )}
                    >
                        <span className="inline-flex items-center gap-2 text-gray-500">
                            <TagIcon className="h-4 w-4" />
                            {selectedTags.length > 0
                                ? `${selectedTags.length} tag${selectedTags.length > 1 ? "s" : ""} selected`
                                : placeholder}
                        </span>
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                        <CommandInput
                            placeholder="Search or create tag..."
                            value={search}
                            onValueChange={setSearch}
                        />
                        <CommandList>
                            <CommandEmpty>
                                {search.trim() ? (
                                    <button
                                        type="button"
                                        onClick={handleCreate}
                                        disabled={creating}
                                        className="mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Create tag &quot;{search.trim()}&quot;
                                    </button>
                                ) : (
                                    "No tags yet"
                                )}
                            </CommandEmpty>
                            {filtered.length > 0 && (
                                <CommandGroup>
                                    {filtered.map((tag) => (
                                        <CommandItem
                                            key={tag.id}
                                            value={tag.name}
                                            onSelect={() => handleToggle(tag.id)}
                                        >
                                            <span
                                                className="h-2 w-2 rounded-full"
                                                style={{ backgroundColor: tag.color || "#6366f1" }}
                                            />
                                            <span className="flex-1">{tag.name}</span>
                                            {selected.includes(tag.id) && (
                                                <span className="text-xs text-indigo-600">✓</span>
                                            )}
                                        </CommandItem>
                                    ))}
                                    {!exactMatch && search.trim() && (
                                        <CommandItem
                                            value={`__create_${search}`}
                                            onSelect={handleCreate}
                                            className="text-indigo-600"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Create &quot;{search.trim()}&quot;
                                        </CommandItem>
                                    )}
                                </CommandGroup>
                            )}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
