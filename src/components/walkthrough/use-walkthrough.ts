"use client";

import { useState, useCallback, useMemo } from "react";
import { WALKTHROUGH_STEPS } from "./constants";
import type { WalkthroughState, WalkthroughContextType } from "./types";

export function useWalkthrough(
    clientId: string,
    onComplete: () => Promise<void>
): WalkthroughContextType {
    const [currentStepIndex, setCurrentStepIndex] = useState(-1);
    const [isActive, setIsActive] = useState(false);

    const state: WalkthroughState = useMemo(
        () => ({
            isActive,
            currentStepIndex,
            steps: WALKTHROUGH_STEPS,
        }),
        [isActive, currentStepIndex]
    );

    const finish = useCallback(async () => {
        setIsActive(false);
        setCurrentStepIndex(-1);
        await onComplete();
    }, [onComplete]);

    const start = useCallback(() => {
        setIsActive(true);
        setCurrentStepIndex(0);
    }, []);

    const nextStep = useCallback(() => {
        setCurrentStepIndex((prev) => {
            const next = prev + 1;
            if (next >= WALKTHROUGH_STEPS.length) {
                finish();
                return prev;
            }
            return next;
        });
    }, [finish]);

    const prevStep = useCallback(() => {
        setCurrentStepIndex((prev) => Math.max(0, prev - 1));
    }, []);

    const skip = useCallback(() => {
        finish();
    }, [finish]);

    return { state, nextStep, prevStep, skip, start };
}
