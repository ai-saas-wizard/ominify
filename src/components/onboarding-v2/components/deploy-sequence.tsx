"use client";

import { motion } from "framer-motion";
import { Check, Loader2, AlertCircle, Rocket } from "lucide-react";
import type { DeploymentProgress } from "../types";

interface DeploySequenceProps {
    progress: DeploymentProgress;
}

export function DeploySequence({ progress }: DeploySequenceProps) {
    const percentage = progress.totalAgents > 0
        ? Math.round((progress.completedAgents / progress.totalAgents) * 100)
        : 0;

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
            <motion.div
                className="flex w-full max-w-lg flex-col items-center gap-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                {/* Header */}
                <div className="text-center">
                    <motion.div
                        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 ring-1 ring-violet-200"
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    >
                        <Rocket className="h-8 w-8 text-violet-600" />
                    </motion.div>
                    <h2 className="text-2xl font-bold text-gray-900">Deploying Your Agents</h2>
                    <p className="mt-2 text-sm text-gray-500">
                        {progress.completedAgents} of {progress.totalAgents} agents deployed
                    </p>
                </div>

                {/* Progress bar */}
                <div className="w-full">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                        <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400"
                            initial={{ width: "0%" }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                    <p className="mt-1 text-right text-xs text-gray-400">{percentage}%</p>
                </div>

                {/* Deployment steps */}
                <div className="w-full space-y-3">
                    {progress.steps.map((step, idx) => (
                        <motion.div
                            key={step.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="rounded-lg border border-gray-200 bg-white p-3"
                        >
                            <div className="flex items-center gap-3">
                                <StepIcon status={step.status} />
                                <span
                                    className={`text-sm font-medium ${
                                        step.status === "in_progress"
                                            ? "text-gray-900"
                                            : step.status === "completed"
                                              ? "text-gray-500"
                                              : step.status === "failed"
                                                ? "text-red-500"
                                                : "text-gray-400"
                                    }`}
                                >
                                    {step.label}
                                </span>
                            </div>

                            {/* Substeps */}
                            {step.substeps.length > 0 && step.status !== "pending" && (
                                <div className="ml-9 mt-2 space-y-1.5">
                                    {step.substeps.map((sub, subIdx) => (
                                        <div
                                            key={subIdx}
                                            className="flex items-center gap-2"
                                        >
                                            <SubstepIcon status={sub.status} />
                                            <span
                                                className={`text-xs ${
                                                    sub.status === "completed"
                                                        ? "text-gray-400"
                                                        : sub.status === "in_progress"
                                                          ? "text-gray-700"
                                                          : sub.status === "failed"
                                                            ? "text-red-500"
                                                            : "text-gray-400"
                                                }`}
                                            >
                                                {sub.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>

                {/* Error */}
                {progress.error && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600"
                    >
                        {progress.error}
                    </motion.div>
                )}
            </motion.div>
        </div>
    );
}

function StepIcon({ status }: { status: string }) {
    switch (status) {
        case "completed":
            return (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50"
                >
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                </motion.div>
            );
        case "in_progress":
            return (
                <div className="flex h-6 w-6 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                </div>
            );
        case "failed":
            return (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-50">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                </div>
            );
        default:
            return (
                <div className="flex h-6 w-6 items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-gray-300" />
                </div>
            );
    }
}

function SubstepIcon({ status }: { status: string }) {
    switch (status) {
        case "completed":
            return <Check className="h-3 w-3 text-emerald-600" />;
        case "in_progress":
            return <Loader2 className="h-3 w-3 animate-spin text-violet-600" />;
        case "failed":
            return <AlertCircle className="h-3 w-3 text-red-500" />;
        default:
            return <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />;
    }
}
