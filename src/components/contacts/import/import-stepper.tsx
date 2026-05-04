"use client";

import { motion, LayoutGroup } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperItem {
    n: number;
    label: string;
    description: string;
}

const ITEMS: StepperItem[] = [
    { n: 1, label: "Start", description: "Select objects to import" },
    { n: 2, label: "Upload", description: "Upload your file and configure settings" },
    { n: 3, label: "Map", description: "Map columns to fields" },
    { n: 4, label: "Verify", description: "Review and confirm import" },
];

interface ImportStepperProps {
    current: 1 | 2 | 3 | 4;
}

export function ImportStepper({ current }: ImportStepperProps) {
    return (
        <LayoutGroup id="import-stepper">
            <ol className="flex items-start gap-0">
                {ITEMS.map((item, i) => {
                    const isCompleted = current > item.n;
                    const isActive = current === item.n;
                    const isLast = i === ITEMS.length - 1;
                    return (
                        <li key={item.n} className="flex flex-1 items-start gap-3">
                            <div className="flex flex-col items-start min-w-0">
                                <div className="flex items-center gap-3">
                                    <motion.div
                                        layoutId={`step-${item.n}-circle`}
                                        className={cn(
                                            "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1",
                                            isActive
                                                ? "bg-indigo-600 text-white ring-indigo-600 shadow-sm shadow-indigo-200"
                                                : isCompleted
                                                  ? "bg-indigo-600 text-white ring-indigo-600"
                                                  : "bg-white text-gray-400 ring-gray-300",
                                        )}
                                        transition={{
                                            type: "spring",
                                            stiffness: 380,
                                            damping: 28,
                                        }}
                                    >
                                        {isCompleted ? (
                                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                        ) : (
                                            item.n
                                        )}
                                    </motion.div>
                                    <div className="min-w-0">
                                        <div
                                            className={cn(
                                                "text-sm font-medium",
                                                isActive
                                                    ? "text-gray-900"
                                                    : isCompleted
                                                      ? "text-gray-700"
                                                      : "text-gray-400",
                                            )}
                                        >
                                            {item.label}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate">
                                            {item.description}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {!isLast && (
                                <div className="relative mx-3 mt-3 hidden h-px flex-1 bg-gray-200 sm:block">
                                    <motion.div
                                        className="absolute inset-y-0 left-0 bg-indigo-600"
                                        initial={false}
                                        animate={{ scaleX: isCompleted ? 1 : 0 }}
                                        style={{ transformOrigin: "left", width: "100%" }}
                                        transition={{ duration: 0.4, ease: "easeOut" }}
                                    />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        </LayoutGroup>
    );
}
