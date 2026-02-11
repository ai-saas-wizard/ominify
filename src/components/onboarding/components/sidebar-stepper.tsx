"use client";

import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS } from "../constants";
import { Progress } from "@/components/ui/progress";

interface SidebarStepperProps {
    currentStep: number;
    completedSteps: Set<number>;
    onStepClick: (step: number) => void;
    clientName: string;
}

export function SidebarStepper({ currentStep, completedSteps, onStepClick, clientName }: SidebarStepperProps) {
    const progressPercent = Math.round((completedSteps.size / (STEPS.length - 1)) * 100);

    return (
        <div className="flex flex-col h-full">
            {/* Brand Header */}
            <div className="px-6 py-6 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-900 truncate">{clientName}</h2>
                <p className="text-sm text-gray-500 mt-0.5">AI Agent Setup</p>
            </div>

            {/* Steps */}
            <nav className="flex-1 px-4 py-6 overflow-y-auto">
                <div className="space-y-1">
                    {STEPS.map((step, idx) => {
                        const isActive = idx === currentStep;
                        const isCompleted = completedSteps.has(idx);
                        const StepIcon = step.icon;

                        return (
                            <div key={idx}>
                                <button
                                    type="button"
                                    onClick={() => onStepClick(idx)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
                                        isActive
                                            ? "bg-violet-50 text-violet-700"
                                            : isCompleted
                                            ? "text-gray-700 hover:bg-gray-50"
                                            : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                                    )}
                                >
                                    {/* Step indicator */}
                                    <motion.div
                                        animate={{ scale: isActive ? 1.05 : 1 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                        className={cn(
                                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium transition-colors",
                                            isActive
                                                ? "bg-violet-600 text-white shadow-sm"
                                                : isCompleted
                                                ? "bg-emerald-100 text-emerald-600"
                                                : "bg-gray-100 text-gray-400"
                                        )}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle className="w-4 h-4" />
                                        ) : (
                                            <StepIcon className="w-4 h-4" />
                                        )}
                                    </motion.div>

                                    {/* Step text */}
                                    <div className="min-w-0">
                                        <div className={cn(
                                            "text-sm font-medium truncate",
                                            isActive ? "text-violet-700" : isCompleted ? "text-gray-700" : "text-gray-400"
                                        )}>
                                            {step.label}
                                        </div>
                                        <div className="text-xs text-gray-400 truncate">
                                            {step.description}
                                        </div>
                                    </div>
                                </button>

                                {/* Connector line */}
                                {idx < STEPS.length - 1 && (
                                    <div className="ml-[22px] my-0.5">
                                        <div className={cn(
                                            "w-0.5 h-3 rounded-full transition-colors",
                                            isCompleted ? "bg-emerald-300" : "bg-gray-200"
                                        )} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </nav>

            {/* Progress footer */}
            <div className="px-6 py-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500">Progress</span>
                    <span className="text-xs font-medium text-gray-700">{progressPercent}%</span>
                </div>
                <Progress value={progressPercent} />
            </div>
        </div>
    );
}
