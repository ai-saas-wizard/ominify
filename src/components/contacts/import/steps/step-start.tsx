"use client";

import { Users, Building2, Sparkles, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ObjectCard {
    key: string;
    label: string;
    description: string;
    icon: typeof Users;
    enabled: boolean;
}

const CARDS: ObjectCard[] = [
    {
        key: "contacts",
        label: "Contacts",
        description: "Contains contact records and their associated details.",
        icon: Users,
        enabled: true,
    },
    {
        key: "opportunities",
        label: "Opportunities",
        description: "Includes deals, their stages, statuses, and pipeline progress.",
        icon: Sparkles,
        enabled: false,
    },
    {
        key: "companies",
        label: "Companies",
        description: "Contains businesses, their details, and associated contact information.",
        icon: Building2,
        enabled: false,
    },
];

export function StepStart() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-base font-semibold text-gray-900">Select objects to import</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Pick what you&apos;re bringing in. You can import contacts now and
                    opportunities or companies later.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {CARDS.map((card) => {
                    const Icon = card.icon;
                    return (
                        <motion.div
                            key={card.key}
                            whileHover={card.enabled ? { y: -2 } : undefined}
                            transition={{ type: "spring", stiffness: 320, damping: 28 }}
                            className={cn(
                                "relative flex items-start gap-3 rounded-xl border bg-white p-4 transition-colors",
                                card.enabled
                                    ? "border-indigo-200 ring-1 ring-indigo-200 cursor-default"
                                    : "border-gray-200 opacity-60 cursor-not-allowed",
                            )}
                        >
                            <div
                                className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                    card.enabled ? "bg-indigo-100" : "bg-gray-100",
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "h-5 w-5",
                                        card.enabled ? "text-indigo-600" : "text-gray-400",
                                    )}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                        {card.label}
                                    </h3>
                                    {!card.enabled && (
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                            Soon
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-gray-500">{card.description}</p>
                            </div>
                            {card.enabled && (
                                <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded bg-indigo-600 text-white">
                                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}
