"use client";

import { createContext, useContext, useEffect } from "react";
import { useWalkthrough } from "./use-walkthrough";
import { WalkthroughOverlay } from "./walkthrough-overlay";
import { completeWalkthrough as completeWalkthroughAction } from "@/app/actions/walkthrough-actions";
import type { WalkthroughContextType } from "./types";

const WalkthroughContext = createContext<WalkthroughContextType | null>(null);

export function WalkthroughProvider({
    children,
    clientId,
    shouldShowWalkthrough,
}: {
    children: React.ReactNode;
    clientId: string;
    shouldShowWalkthrough: boolean;
}) {
    const walkthrough = useWalkthrough(clientId, async () => {
        await completeWalkthroughAction(clientId);
    });

    useEffect(() => {
        if (shouldShowWalkthrough && !walkthrough.state.isActive) {
            const timer = setTimeout(() => walkthrough.start(), 500);
            return () => clearTimeout(timer);
        }
    }, [shouldShowWalkthrough]);

    return (
        <WalkthroughContext.Provider value={walkthrough}>
            {children}
            {walkthrough.state.isActive && (
                <WalkthroughOverlay
                    state={walkthrough.state}
                    onNext={walkthrough.nextStep}
                    onPrev={walkthrough.prevStep}
                    onSkip={walkthrough.skip}
                    clientId={clientId}
                />
            )}
        </WalkthroughContext.Provider>
    );
}

export function useWalkthroughContext() {
    return useContext(WalkthroughContext);
}
