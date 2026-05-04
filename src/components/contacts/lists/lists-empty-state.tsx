"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Upload, Layers } from "lucide-react";

interface ListsEmptyStateProps {
    clientId: string;
}

// Empty state for the Lists tab. Shown when no lists exist yet. Links straight
// into the Imports wizard so users can create their first list in one click.
export function ListsEmptyState({ clientId }: ListsEmptyStateProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center"
        >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
                <Layers className="h-6 w-6 text-indigo-600" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-gray-900">No lists yet</h3>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
                Lists are reusable contact segments built from CSV imports. Create one and
                you can enroll the whole list into a sequence later in a single click.
            </p>
            <Link
                href={`/client/${clientId}/contacts/import`}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
                <Upload className="h-4 w-4" />
                Import contacts
            </Link>
        </motion.div>
    );
}
