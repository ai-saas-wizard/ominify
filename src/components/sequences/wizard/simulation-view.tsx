"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Pause,
    SkipForward,
    RefreshCw,
    User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { seqOption, seqOptionSelected, seqBtnSecondary, seqBtnPrimary, seqFocusRing } from "@/components/sequences/theme";
import type { SimulationScenario } from "./types";
import { SimulationEntryComponent } from "./simulation-entry";

interface SimulationViewProps {
    scenario: SimulationScenario | null;
    isLoading: boolean;
    error?: string | null;
    onRegenerateScenario: (type?: string) => void;
}

const SCENARIO_TYPES = [
    { type: "positive", label: "Positive engagement", emoji: "+" },
    { type: "neutral", label: "No response", emoji: "~" },
    { type: "negative", label: "Hostile / opt-out", emoji: "-" },
    { type: "handoff", label: "Handoff triggered", emoji: "!" },
];

export function SimulationView({
    scenario,
    isLoading,
    error,
    onRegenerateScenario,
}: SimulationViewProps) {
    const [visibleCount, setVisibleCount] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const totalEntries = scenario?.timeline.length ?? 0;

    // Auto-play logic
    useEffect(() => {
        if (!scenario || !isPlaying) return;

        if (visibleCount >= totalEntries) {
            setIsPlaying(false);
            return;
        }

        intervalRef.current = setTimeout(() => {
            setVisibleCount((prev) => prev + 1);
        }, 1200);

        return () => {
            if (intervalRef.current) clearTimeout(intervalRef.current);
        };
    }, [scenario, isPlaying, visibleCount, totalEntries]);

    // Auto-scroll as entries appear
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [visibleCount]);

    // Reset on new scenario
    useEffect(() => {
        if (scenario) {
            setVisibleCount(0);
            setIsPlaying(true);
        }
    }, [scenario]);

    const handleShowAll = useCallback(() => {
        setVisibleCount(totalEntries);
        setIsPlaying(false);
    }, [totalEntries]);

    const togglePlay = useCallback(() => {
        if (visibleCount >= totalEntries) {
            setVisibleCount(0);
            setIsPlaying(true);
        } else {
            setIsPlaying((p) => !p);
        }
    }, [visibleCount, totalEntries]);

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                        Watch your AI in action
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                        Generating a simulated lead journey...
                    </p>
                </div>
                <div className="space-y-5" aria-busy="true" aria-label="Building your simulation">
                    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="space-y-1.5">
                            <Skeleton className="h-4 w-36" />
                            <Skeleton className="h-3 w-48" />
                        </div>
                    </div>
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="relative pl-8">
                            <Skeleton className="absolute left-0 top-3 h-3 w-3 rounded-full" />
                            <div className="space-y-2">
                                <Skeleton className="h-3 w-32" />
                                <Skeleton
                                    className={cn("h-16 rounded-xl", i === 1 ? "w-3/5" : "w-4/5")}
                                />
                            </div>
                        </div>
                    ))}
                    <p className="text-center text-xs text-gray-400">
                        Creating a realistic lead journey based on your settings
                    </p>
                </div>
            </div>
        );
    }

    if (!scenario) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                        Watch your AI in action
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                        See a simulated lead journey before going live.
                    </p>
                </div>
                <div className="flex flex-col items-center justify-center gap-4 py-16">
                    {error ? (
                        <>
                            <p className="text-sm text-red-600">{error}</p>
                            <button
                                onClick={() => onRegenerateScenario("positive")}
                                className={cn(seqBtnPrimary, "px-4 py-2")}
                            >
                                Try again
                            </button>
                        </>
                    ) : (
                        <p className="text-sm text-gray-500">
                            No simulation generated yet. Go back and check your settings.
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                    Watch your AI in action
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                    This is what your leads will experience. The AI adapts in real-time.
                </p>
            </div>

            {/* Error Banner */}
            {error && scenario && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <span>Failed to generate new scenario. Showing previous result.</span>
                    <button
                        onClick={() => onRegenerateScenario("positive")}
                        className="ml-auto text-xs font-medium text-red-600 underline hover:text-red-800"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Scenario Header */}
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white">
                        <User className="h-4 w-4 text-gray-500" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-900">
                            {scenario.fake_contact.name}
                            <span className="ml-1.5 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                                Lead
                            </span>
                        </p>
                        <p className="text-xs text-gray-400">
                            {scenario.fake_contact.source} &middot; {scenario.scenario_name}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="tabular-nums">
                        {visibleCount}/{totalEntries} steps
                    </span>
                    {/* Progress bar */}
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-gray-200">
                        <motion.div
                            className="h-full rounded-full bg-gray-900"
                            animate={{
                                width: `${totalEntries > 0 ? (visibleCount / totalEntries) * 100 : 0}%`,
                            }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center gap-2">
                <button
                    onClick={togglePlay}
                    className={cn(seqBtnSecondary, "px-3 py-1.5 text-xs")}
                >
                    {isPlaying ? (
                        <>
                            <Pause className="h-3.5 w-3.5 text-gray-400" /> Pause
                        </>
                    ) : visibleCount >= totalEntries ? (
                        <>
                            <RefreshCw className="h-3.5 w-3.5 text-gray-400" /> Replay
                        </>
                    ) : (
                        <>
                            <Play className="h-3.5 w-3.5 text-gray-400" /> Play
                        </>
                    )}
                </button>
                {visibleCount < totalEntries && (
                    <button
                        onClick={handleShowAll}
                        className={cn(seqBtnSecondary, "px-3 py-1.5 text-xs")}
                    >
                        <SkipForward className="h-3.5 w-3.5 text-gray-400" /> Show all
                    </button>
                )}
            </div>

            {/* Timeline */}
            <div
                ref={scrollRef}
                className="max-h-[calc(100vh-360px)] min-h-[480px] overflow-y-auto pr-2 scrollbar-thin"
            >
                <div className="relative">
                    <AnimatePresence>
                        {scenario.timeline.map((entry, i) => (
                            <SimulationEntryComponent
                                key={`${i}-${entry.day}-${entry.time}`}
                                entry={entry}
                                contactName={scenario.fake_contact.name}
                                index={i}
                                isVisible={i < visibleCount}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            </div>

            {/* Scenario Switcher */}
            <div className="border-t border-gray-200 pt-4">
                <p className="mb-2 text-xs font-medium text-gray-500">
                    Simulate another scenario:
                </p>
                <div className="flex flex-wrap gap-2">
                    {SCENARIO_TYPES.map((st) => (
                        <button
                            key={st.type}
                            onClick={() => onRegenerateScenario(st.type)}
                            disabled={isLoading}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50",
                                seqFocusRing,
                                scenario.scenario_type === st.type
                                    ? cn(seqOptionSelected, "text-emerald-800")
                                    : cn(seqOption, "text-gray-600")
                            )}
                        >
                            <span className="font-mono text-xs text-gray-400">{st.emoji}</span>
                            {st.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
