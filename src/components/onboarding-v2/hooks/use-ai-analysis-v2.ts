"use client";

import { useState, useCallback, useRef } from "react";
import { analyzeBusinessWebsiteV2 } from "@/app/actions/ai-onboarding-v2-actions";
import { ANALYSIS_STAGES } from "../constants";
import type { AIAnalysisV2Result } from "../types";

export function useAIAnalysisV2() {
    const [analyzing, setAnalyzing] = useState(false);
    const [currentStage, setCurrentStage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<AIAnalysisV2Result | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const stageRef = useRef(0);

    const startStageProgression = useCallback(() => {
        stageRef.current = 0;
        setCurrentStage(0);

        const advanceStage = () => {
            if (stageRef.current < ANALYSIS_STAGES.length - 1) {
                stageRef.current += 1;
                setCurrentStage(stageRef.current);
                timerRef.current = setTimeout(
                    advanceStage,
                    ANALYSIS_STAGES[stageRef.current].duration
                );
            }
        };

        timerRef.current = setTimeout(advanceStage, ANALYSIS_STAGES[0].duration);
    }, []);

    const stopStageProgression = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        // Jump to final stage
        stageRef.current = ANALYSIS_STAGES.length - 1;
        setCurrentStage(ANALYSIS_STAGES.length - 1);
    }, []);

    const analyzeWebsite = useCallback(async (url: string) => {
        setAnalyzing(true);
        setError(null);
        setResult(null);

        startStageProgression();

        try {
            const analysisResult = await analyzeBusinessWebsiteV2(url);

            stopStageProgression();

            if (!analysisResult.success) {
                setError(analysisResult.error || "Analysis failed");
                setAnalyzing(false);
                return null;
            }

            setResult(analysisResult);
            setAnalyzing(false);
            return analysisResult;
        } catch (err) {
            stopStageProgression();
            setError(err instanceof Error ? err.message : "Analysis failed");
            setAnalyzing(false);
            return null;
        }
    }, [startStageProgression, stopStageProgression]);

    const resetAnalysis = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setAnalyzing(false);
        setCurrentStage(0);
        setError(null);
        setResult(null);
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
