"use client";

import { LayoutGroup, motion, AnimatePresence } from "framer-motion";
import { ListCard } from "./list-card";

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

interface ListsGridProps {
    lists: ContactList[];
    clientId: string;
    onRequestRename: (list: ContactList) => void;
}

// Animated grid of list cards. Wrapped in LayoutGroup so filter/sort changes
// animate cards reordering smoothly.
export function ListsGrid({ lists, clientId, onRequestRename }: ListsGridProps) {
    return (
        <LayoutGroup>
            <motion.div
                layout
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
                <AnimatePresence mode="popLayout">
                    {lists.map((list) => (
                        <motion.div
                            key={list.id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        >
                            <ListCard
                                list={list}
                                clientId={clientId}
                                onRequestRename={onRequestRename}
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </motion.div>
        </LayoutGroup>
    );
}
