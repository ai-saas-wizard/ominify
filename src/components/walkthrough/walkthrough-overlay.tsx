"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Bot,
    Users,
    BarChart3,
    FileText,
    CreditCard,
    GitBranch,
    Phone,
    Settings,
    Calendar,
    Sheet,
    ArrowRight,
    ArrowLeft,
    X,
    Compass,
    CheckCircle2,
    type LucideIcon,
} from "lucide-react";
import type { WalkthroughState, WalkthroughStep } from "./types";

const ICON_MAP: Record<string, LucideIcon> = {
    Bot,
    Users,
    BarChart3,
    FileText,
    CreditCard,
    GitBranch,
    Phone,
    Settings,
    Calendar,
    Sheet,
};

interface WalkthroughOverlayProps {
    state: WalkthroughState;
    onNext: () => void;
    onPrev: () => void;
    onSkip: () => void;
    clientId: string;
}

export function WalkthroughOverlay({
    state,
    onNext,
    onPrev,
    onSkip,
    clientId,
}: WalkthroughOverlayProps) {
    const currentStep = state.steps[state.currentStepIndex];
    if (!currentStep) return null;

    if (currentStep.type === "welcome") {
        return <WelcomeScreen onNext={onNext} onSkip={onSkip} />;
    }

    if (currentStep.type === "action") {
        // Collect all action steps plus complete step
        const actionSteps = state.steps.filter(
            (s) => s.type === "action" || s.type === "complete"
        );
        return (
            <ActionScreen
                steps={actionSteps}
                onSkip={onSkip}
                onFinish={onSkip}
                clientId={clientId}
            />
        );
    }

    if (currentStep.type === "complete") {
        return (
            <ActionScreen
                steps={state.steps.filter(
                    (s) => s.type === "action" || s.type === "complete"
                )}
                onSkip={onSkip}
                onFinish={onSkip}
                clientId={clientId}
            />
        );
    }

    return (
        <SidebarSpotlight
            step={currentStep}
            stepIndex={state.currentStepIndex}
            totalSidebarSteps={
                state.steps.filter((s) => s.type === "sidebar").length
            }
            onNext={onNext}
            onPrev={onPrev}
            onSkip={onSkip}
        />
    );
}

// ─── Welcome Screen ─────────────────────────────────────────────────────────

function WelcomeScreen({
    onNext,
    onSkip,
}: {
    onNext: () => void;
    onSkip: () => void;
}) {
    return (
        <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div
                className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
                {/* Icon */}
                <motion.div
                    className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-200"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.15 }}
                >
                    <Compass className="h-8 w-8 text-emerald-600" />
                </motion.div>

                <h2 className="text-center text-2xl font-bold text-gray-900">
                    Welcome to your dashboard!
                </h2>
                <p className="mt-2 text-center text-gray-500">
                    Let&apos;s take a quick tour of your AI call center. This
                    will only take a minute.
                </p>

                <div className="mt-8 flex flex-col gap-3">
                    <button
                        onClick={onNext}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                    >
                        Start Tour
                        <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onSkip}
                        className="text-sm text-gray-400 transition-colors hover:text-gray-600"
                    >
                        Skip tour
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ─── Sidebar Spotlight ───────────────────────────────────────────────────────

function SidebarSpotlight({
    step,
    stepIndex,
    totalSidebarSteps,
    onNext,
    onPrev,
    onSkip,
}: {
    step: WalkthroughStep;
    stepIndex: number;
    totalSidebarSteps: number;
    onNext: () => void;
    onPrev: () => void;
    onSkip: () => void;
}) {
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [viewportSize, setViewportSize] = useState({
        w: 0,
        h: 0,
    });

    const measure = useCallback(() => {
        setViewportSize({
            w: window.innerWidth,
            h: window.innerHeight,
        });

        if (!step.targetId) {
            setTargetRect(null);
            return;
        }

        const el = document.querySelector(
            `[data-walkthrough-id="${step.targetId}"]`
        );
        if (el) {
            setTargetRect(el.getBoundingClientRect());
        }
    }, [step.targetId]);

    useEffect(() => {
        measure();

        const handleResize = () => measure();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [measure]);

    const Icon = step.icon ? ICON_MAP[step.icon] : null;
    const sidebarStepNumber = stepIndex; // stepIndex 1 = sidebar step 1 (welcome is 0)

    const PAD = 6;

    return (
        <div className="fixed inset-0 z-[60]" style={{ pointerEvents: "auto" }}>
            {/* SVG overlay with spotlight cutout */}
            <svg
                className="absolute inset-0 h-full w-full"
                style={{ pointerEvents: "none" }}
            >
                <defs>
                    <mask id="walkthrough-mask">
                        <rect
                            x="0"
                            y="0"
                            width="100%"
                            height="100%"
                            fill="white"
                        />
                        {targetRect && (
                            <rect
                                x={targetRect.left - PAD}
                                y={targetRect.top - PAD}
                                width={targetRect.width + PAD * 2}
                                height={targetRect.height + PAD * 2}
                                rx="10"
                                fill="black"
                            />
                        )}
                    </mask>
                </defs>
                <rect
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.55)"
                    mask="url(#walkthrough-mask)"
                    style={{ pointerEvents: "auto" }}
                />
            </svg>

            {/* Highlight ring around target */}
            {targetRect && (
                <motion.div
                    key={step.id}
                    className="absolute rounded-lg ring-2 ring-emerald-400 ring-offset-2"
                    style={{
                        left: targetRect.left - PAD,
                        top: targetRect.top - PAD,
                        width: targetRect.width + PAD * 2,
                        height: targetRect.height + PAD * 2,
                        pointerEvents: "none",
                    }}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", damping: 20 }}
                />
            )}

            {/* Tooltip card */}
            <AnimatePresence mode="wait">
                {targetRect && (
                    <motion.div
                        key={step.id}
                        className="absolute w-80 rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
                        style={{
                            left: targetRect.right + 24,
                            top: Math.max(
                                12,
                                Math.min(
                                    targetRect.top - 12,
                                    viewportSize.h - 260
                                )
                            ),
                            pointerEvents: "auto",
                        }}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{
                            type: "spring",
                            damping: 25,
                            stiffness: 300,
                        }}
                    >
                        {/* Header */}
                        <div className="mb-3 flex items-center gap-3">
                            {Icon && (
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                                    <Icon className="h-5 w-5 text-emerald-600" />
                                </div>
                            )}
                            <h3 className="text-lg font-semibold text-gray-900">
                                {step.title}
                            </h3>
                        </div>

                        <p className="text-sm leading-relaxed text-gray-500">
                            {step.description}
                        </p>

                        {/* Progress + navigation */}
                        <div className="mt-5 flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                                {sidebarStepNumber} of {totalSidebarSteps}
                            </span>

                            <div className="flex items-center gap-2">
                                {stepIndex > 1 && (
                                    <button
                                        onClick={onPrev}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </button>
                                )}
                                <button
                                    onClick={onNext}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                                >
                                    Next
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        {/* Skip */}
                        <button
                            onClick={onSkip}
                            className="mt-3 w-full text-center text-xs text-gray-400 transition-colors hover:text-gray-600"
                        >
                            Skip tour
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Action Screen (Setup Steps + Complete) ──────────────────────────────────

function ActionScreen({
    steps,
    onSkip,
    onFinish,
    clientId,
}: {
    steps: WalkthroughStep[];
    onSkip: () => void;
    onFinish: () => void;
    clientId: string;
}) {
    const actionSteps = steps.filter((s) => s.type === "action");

    return (
        <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div
                className="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
                {/* Close button */}
                <button
                    onClick={onSkip}
                    className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                    <X className="h-4 w-4" />
                </button>

                {/* Header */}
                <motion.div
                    className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-200"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                >
                    <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                </motion.div>

                <h2 className="text-center text-xl font-bold text-gray-900">
                    Next steps to go live
                </h2>
                <p className="mt-1 text-center text-sm text-gray-500">
                    Complete these to get the most out of your AI call center.
                </p>

                {/* Action cards */}
                <motion.div
                    className="mt-6 space-y-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    {actionSteps.map((step, i) => {
                        const Icon = step.icon ? ICON_MAP[step.icon] : null;
                        return (
                            <a
                                key={step.id}
                                href={`/client/${clientId}${step.actionUrl}`}
                                onClick={onFinish}
                                className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-emerald-200 hover:bg-emerald-50/50"
                            >
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 transition-colors group-hover:bg-emerald-50">
                                    {Icon && (
                                        <Icon className="h-5 w-5 text-gray-400 transition-colors group-hover:text-emerald-600" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-gray-900">
                                        {step.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-400">
                                        {step.description}
                                    </p>
                                </div>
                                <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-300 transition-colors group-hover:text-emerald-500" />
                            </a>
                        );
                    })}
                </motion.div>

                {/* Finish */}
                <div className="mt-6 flex flex-col items-center gap-2">
                    <button
                        onClick={onFinish}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-8 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                    >
                        Got it, let&apos;s go!
                    </button>
                    <span className="text-xs text-gray-400">
                        You can access these from the sidebar anytime.
                    </span>
                </div>
            </motion.div>
        </motion.div>
    );
}
