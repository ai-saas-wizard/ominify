"use client";

import { useState, useCallback, useRef } from "react";
import type { AIAnalysisResult } from "../types";
import { ANALYSIS_STAGES } from "../constants";
import { analyzeBusinessWebsite } from "@/app/actions/ai-onboarding-actions";

export function useAIAnalysis() {
    const [analyzing, setAnalyzing] = useState(false);
    const [currentStage, setCurrentStage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<AIAnalysisResult | null>(null);
    const stageTimerRef = useRef<NodeJS.Timeout | null>(null);

    const startStageProgression = useCallback(() => {
        let stage = 0;
        setCurrentStage(0);

        const advanceStage = () => {
            stage++;
            if (stage < ANALYSIS_STAGES.length) {
                setCurrentStage(stage);
                stageTimerRef.current = setTimeout(advanceStage, ANALYSIS_STAGES[stage].duration);
            }
        };

        stageTimerRef.current = setTimeout(advanceStage, ANALYSIS_STAGES[0].duration);
    }, []);

    const stopStageProgression = useCallback(() => {
        if (stageTimerRef.current) {
            clearTimeout(stageTimerRef.current);
            stageTimerRef.current = null;
        }
        // Jump to last stage to show completion
        setCurrentStage(ANALYSIS_STAGES.length - 1);
    }, []);

    const analyzeWebsite = useCallback(async (url: string): Promise<AIAnalysisResult | null> => {
        setAnalyzing(true);
        setError(null);
        setResult(null);

        // Start stage progression animation (for UX)
        startStageProgression();

        try {
            // Single call — GPT-5.3 searches the web and analyzes in one shot
            const analysisResult = await analyzeBusinessWebsite(url);

            stopStageProgression();
            setAnalyzing(false);

            if (!analysisResult.success) {
                setError(analysisResult.error || "AI analysis failed");
                return null;
            }

            setResult(analysisResult);
            return analysisResult;
        } catch (err) {
            stopStageProgression();
            setAnalyzing(false);
            console.error("[AI ANALYSIS HOOK] Error:", err);
            setError("An unexpected error occurred. You can continue manually.");
            return null;
        }
    }, [startStageProgression, stopStageProgression]);

    const resetAnalysis = useCallback(() => {
        setAnalyzing(false);
        setCurrentStage(0);
        setError(null);
        setResult(null);
        if (stageTimerRef.current) {
            clearTimeout(stageTimerRef.current);
            stageTimerRef.current = null;
        }
    }, []);

    return {
        analyzing,
        currentStage,
        error,
        result,
        analyzeWebsite,
        resetAnalysis,
    };
}
