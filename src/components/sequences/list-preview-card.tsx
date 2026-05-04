"use client";

import { motion } from "framer-motion";
import { Users, FileText } from "lucide-react";

interface ListPreviewProps {
    name: string;
    contactCount: number;
    sourceFilename: string | null;
    sampleNames?: string[];
}

export function ListPreviewCard({
    name,
    contactCount,
    sourceFilename,
    sampleNames,
}: ListPreviewProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
                    <Users className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-gray-900 truncate">{name}</h4>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
                        <span>
                            <strong>{contactCount.toLocaleString()}</strong> contact
                            {contactCount !== 1 ? "s" : ""}
                        </span>
                        {sourceFilename && (
                            <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
                                <FileText className="h-3 w-3" />
                                <span className="truncate">{sourceFilename}</span>
                            </span>
                        )}
                    </div>
                    {sampleNames && sampleNames.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {sampleNames.slice(0, 3).map((n, i) => (
                                <span
                                    key={i}
                                    className="rounded-md bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
                                >
                                    {n}
                                </span>
                            ))}
                            {contactCount > 3 && (
                                <span className="text-xs text-gray-500">
                                    +{contactCount - 3} more
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
