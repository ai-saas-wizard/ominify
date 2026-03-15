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
    const [retryCount, setRetryCount] = useState(0);
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

    const categorizeError = useCallback((msg: string): string => {
        const lower = msg.toLowerCase();
        if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("took too long")) {
            return "Analysis timed out. The website may be slow to respond. Try again or continue manually.";
        }
        if (lower.includes("429") || lower.includes("rate limit")) {
            return "We're experiencing high demand. Please wait a moment and try again.";
        }
        if (lower.includes("403") || lower.includes("blocked") || lower.includes("bot")) {
            return "This website blocked our analyzer. You can continue manually and fill in your details.";
        }
        if (lower.includes("404") || lower.includes("not found")) {
            return "Website not found. Please check the URL and try again.";
        }
        return "Analysis failed. You can try again or continue manually.";
    }, []);

    const analyzeWebsite = useCallback(async (url: string) => {
        setAnalyzing(true);
        setError(null);
        setResult(null);
        setRetryCount((c) => c + 1);

        startStageProgression();

        try {
            const analysisResult = await analyzeBusinessWebsiteV2(url);

            stopStageProgression();

            if (!analysisResult.success) {
                setError(categorizeError(analysisResult.error || "Analysis failed"));
                setAnalyzing(false);
                return null;
            }

            setResult(analysisResult);
            setAnalyzing(false);
            return analysisResult;
        } catch (err) {
            stopStageProgression();
            const msg = err instanceof Error ? err.message : "Analysis failed";
            setError(categorizeError(msg));
            setAnalyzing(false);
            return null;
        }
    }, [startStageProgression, stopStageProgression, categorizeError]);

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
        retryCount,
        analyzeWebsite,
        resetAnalysis,
    };
}
