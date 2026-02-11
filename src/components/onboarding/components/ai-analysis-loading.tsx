"use client";

import { motion } from "framer-motion";
import { Sparkles, CheckCircle, Loader2, Circle } from "lucide-react";
import { ANALYSIS_STAGES } from "../constants";
import { Card, CardContent } from "@/components/ui/card";

interface AIAnalysisLoadingProps {
    currentStage: number;
    websiteUrl: string;
    error?: string | null;
    onRetry?: () => void;
    onSkip?: () => void;
}

export function AIAnalysisLoading({ currentStage, websiteUrl, error, onRetry, onSkip }: AIAnalysisLoadingProps) {
    const progress = Math.min(((currentStage + 1) / ANALYSIS_STAGES.length) * 100, 100);

    // Extract domain for display
    let domain = websiteUrl;
    try {
        domain = new URL(websiteUrl).hostname;
    } catch { /* keep original */ }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-lg"
                >
                    <Card className="border-0 shadow-lg">
                        <CardContent className="pt-8 pb-8 px-8 text-center">
                            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                                <Circle className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Analysis Failed</h3>
                            <p className="text-gray-500 mb-6">{error}</p>
                            <div className="flex gap-3 justify-center">
                                {onRetry && (
                                    <button
                                        onClick={onRetry}
                                        className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition"
                                    >
                                        Try Again
                                    </button>
                                )}
                                {onSkip && (
                                    <button
                                        onClick={onSkip}
                                        className="px-5 py-2 text-gray-600 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition"
                                    >
                                        Continue Manually
                                    </button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-lg"
            >
                <Card className="border-0 shadow-lg">
                    <CardContent className="pt-8 pb-8 px-8">
                        {/* Pulsing Icon */}
                        <motion.div
                            className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-6"
                            animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        >
                            <Sparkles className="w-8 h-8 text-violet-600" />
                        </motion.div>

                        <h3 className="text-lg font-semibold text-gray-900 text-center mb-1">
                            Analyzing {domain}
                        </h3>
                        <p className="text-sm text-gray-400 text-center mb-8">
                            This usually takes 10-15 seconds
                        </p>

                        {/* Stage List */}
                        <div className="space-y-3 mb-8">
                            {ANALYSIS_STAGES.map((stage, idx) => {
                                const isComplete = idx < currentStage;
                                const isActive = idx === currentStage;
                                const isPending = idx > currentStage;

                                return (
                                    <motion.div
                                        key={idx}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.15, duration: 0.3 }}
                                        className="flex items-center gap-3"
                                    >
                                        {isComplete && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: "spring", stiffness: 300 }}
                                            >
                                                <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                            </motion.div>
                                        )}
                                        {isActive && (
                                            <Loader2 className="w-5 h-5 text-violet-600 flex-shrink-0 animate-spin" />
                                        )}
                                        {isPending && (
                                            <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />
                                        )}
                                        <span className={
                                            isComplete
                                                ? "text-sm text-gray-700"
                                                : isActive
                                                ? "text-sm text-violet-700 font-medium"
                                                : "text-sm text-gray-400"
                                        }>
                                            {stage.label}
                                        </span>
                                    </motion.div>
                                );
                            })}
                        </div>

                        {/* Progress Bar */}
                        <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                            <motion.div
                                className="absolute inset-y-0 left-0 bg-violet-600 rounded-full"
                                animate={{ width: `${progress}%` }}
                                transition={{ type: "spring", stiffness: 50, damping: 15 }}
                            />
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
