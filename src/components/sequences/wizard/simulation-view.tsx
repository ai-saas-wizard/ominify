"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Pause,
    SkipForward,
    RefreshCw,
    Loader2,
    User,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SimulationScenario } from "./types";
import { SimulationEntryComponent } from "./simulation-entry";

interface SimulationViewProps {
    scenario: SimulationScenario | null;
    isLoading: boolean;
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
                    <h2 className="text-xl font-semibold text-gray-900">
                        Watch your AI in action
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Generating a simulated lead journey...
                    </p>
                </div>
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    >
                        <Sparkles className="w-8 h-8 text-emerald-500" />
                    </motion.div>
                    <div className="text-center">
                        <p className="text-sm font-medium text-gray-700">
                            Building your simulation...
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                            Creating a realistic lead journey based on your settings
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (!scenario) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                        Watch your AI in action
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        See a simulated lead journey before going live.
                    </p>
                </div>
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <p className="text-sm text-gray-500">
                        No simulation generated yet. Go back and check your settings.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">
                    Watch your AI in action
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                    This is what your leads will experience. The AI adapts in real-time.
                </p>
            </div>

            {/* Scenario Header */}
            <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                        <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-900">
                            {scenario.fake_contact.name}
                        </p>
                        <p className="text-xs text-gray-400">
                            {scenario.fake_contact.source} &middot; {scenario.scenario_name}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>
                        {visibleCount}/{totalEntries} steps
                    </span>
                    {/* Progress bar */}
                    <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-emerald-500 rounded-full"
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors"
                >
                    {isPlaying ? (
                        <>
                            <Pause className="w-3.5 h-3.5" /> Pause
                        </>
                    ) : visibleCount >= totalEntries ? (
                        <>
                            <RefreshCw className="w-3.5 h-3.5" /> Replay
                        </>
                    ) : (
                        <>
                            <Play className="w-3.5 h-3.5" /> Play
                        </>
                    )}
                </button>
                {visibleCount < totalEntries && (
                    <button
                        onClick={handleShowAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition-colors"
                    >
                        <SkipForward className="w-3.5 h-3.5" /> Show all
                    </button>
                )}
            </div>

            {/* Timeline */}
            <div
                ref={scrollRef}
                className="max-h-[400px] overflow-y-auto pr-2 scrollbar-thin"
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
                <p className="text-xs font-medium text-gray-500 mb-2">
                    Simulate another scenario:
                </p>
                <div className="flex flex-wrap gap-2">
                    {SCENARIO_TYPES.map((st) => (
                        <button
                            key={st.type}
                            onClick={() => onRegenerateScenario(st.type)}
                            disabled={isLoading}
                            className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                scenario.scenario_type === st.type
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                            )}
                        >
                            <span className="text-[10px]">{st.emoji}</span>
                            {st.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
