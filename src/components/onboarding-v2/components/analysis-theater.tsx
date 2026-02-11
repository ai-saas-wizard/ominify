"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
    Globe, Building2, Route, Bot, Workflow,
    Check, Loader2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ANALYSIS_STAGES } from "../constants";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    Globe, Building2, Route, Bot, Workflow,
};

interface AnalysisTheaterProps {
    websiteUrl: string;
    currentStage: number;
    error: string | null;
    onRetry: () => void;
    onSkip: () => void;
}

export function AnalysisTheater({
    websiteUrl,
    currentStage,
    error,
    onRetry,
    onSkip,
}: AnalysisTheaterProps) {
    const domain = (() => {
        try {
            return new URL(websiteUrl).hostname;
        } catch {
            return websiteUrl;
        }
    })();

    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
                <motion.div
                    className="flex w-full max-w-md flex-col items-center gap-6 text-center"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                >
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-200">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Analysis Failed</h2>
                        <p className="mt-2 text-sm text-gray-500">{error}</p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            onClick={onRetry}
                            className="bg-violet-600 text-white hover:bg-violet-500"
                        >
                            Try Again
                        </Button>
                        <Button
                            onClick={onSkip}
                            variant="outline"
                            className="border-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                            Continue Manually
                        </Button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
            <motion.div
                className="flex w-full max-w-lg flex-col items-center gap-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                {/* Pulsing center icon */}
                <motion.div
                    className="relative flex h-24 w-24 items-center justify-center"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                >
                    <div className="absolute inset-0 rounded-full bg-violet-100 blur-xl" />
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-50 ring-1 ring-violet-200">
                        <AnimatePresence mode="wait">
                            {ANALYSIS_STAGES.map((stage, idx) => {
                                if (idx !== currentStage) return null;
                                const Icon = ICONS[stage.icon] || Globe;
                                return (
                                    <motion.div
                                        key={stage.icon}
                                        initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
                                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                        exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <Icon className="h-10 w-10 text-violet-600" />
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </motion.div>

                {/* Domain badge */}
                <div className="rounded-full bg-white px-4 py-1.5 text-sm text-gray-500 ring-1 ring-gray-200">
                    {domain}
                </div>

                {/* Stage list */}
                <div className="w-full space-y-3">
                    {ANALYSIS_STAGES.map((stage, idx) => {
                        const isComplete = idx < currentStage;
                        const isActive = idx === currentStage;

                        return (
                            <motion.div
                                key={idx}
                                className="flex items-center gap-3"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{
                                    opacity: isComplete || isActive ? 1 : 0.3,
                                    x: 0,
                                }}
                                transition={{ delay: idx * 0.1 }}
                            >
                                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
                                    {isComplete ? (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50"
                                        >
                                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                                        </motion.div>
                                    ) : isActive ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                                    ) : (
                                        <div className="h-2 w-2 rounded-full bg-gray-300" />
                                    )}
                                </div>
                                <span
                                    className={`text-sm ${
                                        isActive
                                            ? "font-medium text-gray-900"
                                            : isComplete
                                              ? "text-gray-500"
                                              : "text-gray-400"
                                    }`}
                                >
                                    {stage.label}
                                </span>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Progress bar */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                    <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400"
                        initial={{ width: "0%" }}
                        animate={{
                            width: `${((currentStage + 1) / ANALYSIS_STAGES.length) * 100}%`,
                        }}
                        transition={{ duration: 0.5 }}
                    />
                </div>
            </motion.div>
        </div>
    );
}
